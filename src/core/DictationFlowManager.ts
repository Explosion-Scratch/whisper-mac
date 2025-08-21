import { TranscriptionPluginManager } from "../plugins";
import { DictationWindowService } from "../services/DictationWindowService";
import { SegmentManager } from "../services/SegmentManager";
import { TrayService } from "../services/TrayService";
import { SegmentUpdate } from "../types/SegmentTypes";
import { ErrorManager } from "./ErrorManager";

export type DictationState = "idle" | "recording" | "finishing";

export class DictationFlowManager {
  private state: DictationState = "idle";
  private finishingTimeout: NodeJS.Timeout | null = null;
  private vadAudioBuffer: Float32Array[] = [];
  private vadSampleRate: number = 16000;

  constructor(
    private transcriptionPluginManager: TranscriptionPluginManager,
    private dictationWindowService: DictationWindowService,
    private segmentManager: SegmentManager,
    private trayService: TrayService | null,
    private errorManager: ErrorManager,
  ) {}

  // Public methods to check state
  isRecording(): boolean {
    return this.state === "recording";
  }

  isFinishing(): boolean {
    return this.state === "finishing";
  }

  setFinishingTimeout(timeout: NodeJS.Timeout | null): NodeJS.Timeout | null {
    const currentTimeout = this.finishingTimeout;
    this.finishingTimeout = timeout;
    return currentTimeout;
  }

  async startDictation(): Promise<void> {
    if (this.state !== "idle") return;

    this.state = "recording";
    const startTime = Date.now();
    try {
      console.log("=== Starting dictation process ===");

      this.clearState();
      this.setupAccumulatingMode();

      const windowStartTime = Date.now();
      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      await this.dictationWindowService.showDictationWindow(
        criteria?.runOnAll || false,
      );
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);

      await this.startTranscription();
      this.startRecording();

      const totalTime = Date.now() - startTime;
      console.log(`=== Dictation started successfully in ${totalTime}ms ===`);
    } catch (error) {
      console.error("Failed to start dictation:", error);
      await this.cancelDictationFlow();
      await this.errorManager.showError({
        title: "Could not start dictation",
        description:
          error instanceof Error ? error.message : "Unknown error occurred.",
        actions: ["ok"],
      });
    }
  }

  async stopDictation(): Promise<void> {
    if (this.state !== "recording") return;

    // The old stopDictation had a brittle timeout and was meant to be rare.
    // A clean cancellation is a more robust action.
    console.log(
      "=== stopDictation called, redirecting to cancelDictationFlow for a clean exit ===",
    );
    await this.cancelDictationFlow();
  }

  async finishCurrentDictation(): Promise<void> {
    if (this.state !== "recording") return;

    try {
      this.state = "finishing";
      console.log("=== Finishing current dictation with transform+inject ===");

      if (!this.hasSegmentsToProcess()) {
        const criteria =
          this.transcriptionPluginManager.getActivePluginActivationCriteria();
        if (
          !(
            criteria?.runOnAll &&
            this.transcriptionPluginManager.hasBufferedAudio()
          )
        ) {
          console.log("No segments found, cancelling dictation immediately");
          await this.cancelDictationFlow();
          return;
        }
      }

      console.log(
        `Found ${
          this.segmentManager.getAllSegments().length
        } segments to transform and inject`,
      );

      this.dictationWindowService.setProcessingStatus();
      this.segmentManager.setAccumulatingMode(false);

      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      console.log("Criteria:", criteria);

      if (criteria?.runOnAll) {
        console.log(
          "=== Active plugin runOnAll enabled: finalizing buffered audio ===",
        );
        try {
          await this.transcriptionPluginManager.finalizeBufferedAudio();
        } catch (e) {
          console.error("Failed to finalize buffered audio:", e);
        }
      }

      console.log(
        "=== Transforming and injecting all accumulated segments ===",
      );
      const transformResult =
        await this.segmentManager.transformAndInjectAllSegmentsInternal({
          skipTransformation: !!criteria?.skipTransformation,
        });

      if (transformResult.success) {
        console.log(
          `Successfully transformed and injected ${transformResult.segmentsProcessed} segments`,
        );
        this.dictationWindowService.completeDictation(
          transformResult.transformedText,
        );
      } else {
        console.error("Transform and inject failed:", transformResult.error);
        // Fallback text was already injected by SegmentManager, just update window
        this.dictationWindowService.completeDictation(
          transformResult.transformedText,
        );
      }

      // The window should hide after a brief moment to show the "complete" checkmark.
      // This is one place a small, deliberate delay is acceptable for UX.
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.dictationWindowService.hideWindow();

      // Final cleanup
      await this.transcriptionPluginManager.stopTranscription();
      this.segmentManager.clearAllSegments();
      this.dictationWindowService.clearTranscription();
      this.updateTrayIcon("idle");
      this.state = "idle";
      console.log("=== Dictation completed and cleaned up successfully ===");
    } catch (error) {
      console.error("Failed to finish current dictation:", error);
      await this.cancelDictationFlow();
    } finally {
      this.clearFinishingTimeout();
      if (this.state === "finishing") {
        // Ensure state is reset even if something unexpected happens
        this.state = "idle";
      }
    }
  }

  async flushSegmentsWhileContinuing(): Promise<void> {
    try {
      console.log("=== Flushing segments while continuing recording ===");

      this.dictationWindowService.showWindow();
      this.dictationWindowService.setTransformingStatus();

      const hadInProgress =
        this.segmentManager.getInProgressTranscribedSegments().length > 0;

      const result = await this.segmentManager.transformAndInjectAllSegments();

      if (result.success) {
        console.log(
          `Flushed and injected ${result.segmentsProcessed} segments (continuing)`,
        );
      } else {
        console.error("Flush while continuing failed:", result.error);
      }

      this.dictationWindowService.clearTranscription();
      this.segmentManager.setAccumulatingMode(true);

      if (hadInProgress) {
        this.segmentManager.ignoreNextCompletedSegment();
      }

      this.state = "recording";
      this.updateTrayIcon("recording");

      // Properly reset the window state for continuing recording
      this.dictationWindowService.startRecording();
    } catch (error) {
      console.error("Failed to flush segments while continuing:", error);
    }
  }

  async cancelDictationFlow(): Promise<void> {
    console.log("=== Cancelling dictation flow ===");

    this.clearFinishingTimeout();
    const wasRecording = this.state !== "idle";
    this.state = "idle";
    this.updateTrayIcon("idle");

    if (wasRecording) {
      await this.transcriptionPluginManager.stopTranscription();
    }

    this.dictationWindowService.hideWindow();
    this.segmentManager.clearAllSegments();

    console.log("=== Dictation flow cancelled and cleaned up ===");
  }

  private clearState(): void {
    this.segmentManager.clearAllSegments();
    this.segmentManager.resetIgnoreNextCompleted();
    this.vadAudioBuffer = [];
  }

  private setupAccumulatingMode(): void {
    this.segmentManager.setAccumulatingMode(true);
  }

  private async startTranscription(): Promise<void> {
    const transcriptionStartTime = Date.now();
    try {
      await this.transcriptionPluginManager.startTranscription(
        async (update: SegmentUpdate) => {
          this.dictationWindowService.updateTranscription(update);
          await this.processSegments(update);
        },
      );

      const transcriptionEndTime = Date.now();
      console.log(
        `Transcription setup: ${
          transcriptionEndTime - transcriptionStartTime
        }ms`,
      );
    } catch (error: any) {
      console.error("Failed to start transcription:", error);
      await this.cancelDictationFlow();
      await this.errorManager.showError({
        title: "Transcription failed",
        description: error.message || "Unknown error starting transcription",
        actions: ["ok"],
      });
      throw error;
    }
  }

  private startRecording(): void {
    this.trayService?.updateTrayIcon("recording");
    this.dictationWindowService.startRecording();
  }

  private async processSegments(update: SegmentUpdate): Promise<void> {
    const transcribedSegments = update.segments.filter(
      (s) => s.type === "transcribed",
    );
    const inProgressSegments = update.segments.filter(
      (s) => s.type === "inprogress",
    );

    for (const segment of transcribedSegments) {
      if (segment.type === "transcribed") {
        this.segmentManager.addTranscribedSegment(
          segment.text,
          segment.completed,
          segment.start,
          segment.end,
          segment.confidence,
        );
      }
    }

    for (const segment of inProgressSegments) {
      if (segment.type === "inprogress") {
        this.segmentManager.addTranscribedSegment(
          segment.text,
          false,
          segment.start,
          segment.end,
          segment.confidence,
        );
      }
    }

    const allSegments = this.segmentManager.getAllSegments();
    const displayInProgressSegments = update.segments.filter(
      (s) => s.type === "inprogress",
    );
    const displaySegments = [...allSegments, ...displayInProgressSegments];

    this.dictationWindowService.updateTranscription({
      segments: displaySegments,
    });

    console.log("Segments displayed in accumulating mode - no auto-flush");
  }

  private hasSegmentsToProcess(): boolean {
    const allSegments = this.segmentManager.getAllSegments();
    const selectedText = (this.segmentManager as any).initialSelectedText;
    return !!(selectedText || allSegments.length > 0);
  }

  private clearFinishingTimeout(): void {
    if (this.finishingTimeout) {
      clearTimeout(this.finishingTimeout);
      this.finishingTimeout = null;
    }
  }

  private updateTrayIcon(state: "idle" | "recording"): void {
    this.trayService?.updateTrayIcon(state);
  }
}
