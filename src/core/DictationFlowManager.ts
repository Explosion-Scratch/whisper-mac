import { TranscriptionPluginManager } from "../plugins";
import { DictationWindowService } from "../services/DictationWindowService";
import { SegmentManager } from "../services/SegmentManager";
import { TrayService } from "../services/TrayService";
import { SegmentUpdate } from "../types/SegmentTypes";
import { ErrorManager } from "./ErrorManager";

export class DictationFlowManager {
  private _isRecording = false;
  private _isFinishing = false;
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
    return this._isRecording;
  }

  isFinishing(): boolean {
    return this._isFinishing;
  }

  setFinishingTimeout(timeout: NodeJS.Timeout | null): NodeJS.Timeout | null {
    const currentTimeout = this.finishingTimeout;
    this.finishingTimeout = timeout;
    return currentTimeout;
  }

  async startDictation(): Promise<void> {
    if (this._isRecording) return;

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
    if (!this._isRecording) return;

    try {
      console.log("=== Stopping dictation process ===");

      this.clearFinishingTimeout();
      this.resetRecordingState();
      this.dictationWindowService.stopRecording();

      await new Promise((r) => setTimeout(r, 250));

      console.log(
        "=== stopDictation called - this should be rare with new flow ===",
      );

      this.segmentManager.clearAllSegments();
      await this.transcriptionPluginManager.stopTranscription();

      setTimeout(() => {
        this.dictationWindowService.closeDictationWindow();
      }, 1000);

      console.log("=== Dictation stopped successfully ===");
    } catch (error) {
      console.error("Failed to stop dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  async finishCurrentDictation(): Promise<void> {
    if (!this._isRecording || this._isFinishing) return;

    try {
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
          console.log("No segments found, stopping dictation immediately");
          await this.stopDictation();
          return;
        }
      }

      console.log(
        `Found ${
          this.segmentManager.getAllSegments().length
        } segments to transform and inject`,
      );

      this.setFinishingState();
      this.dictationWindowService.setProcessingStatus();

      await new Promise((r) => setTimeout(r, 1000));

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

      this.dictationWindowService.completeDictation(
        this.dictationWindowService.getCurrentTranscription(),
      );

      await new Promise((r) => setTimeout(r, 500));
      this.dictationWindowService.hideWindow();

      if (transformResult.success) {
        console.log(
          `Successfully transformed and injected ${transformResult.segmentsProcessed} segments`,
        );
      } else {
        console.error("Transform and inject failed:", transformResult.error);
      }

      await this.completeDictationAfterFinishing();
    } catch (error) {
      console.error("Failed to finish current dictation:", error);
      await this.cancelDictationFlow();
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

      this._isRecording = true;
      this._isFinishing = false;
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
    const wasRecording = this._isRecording;
    this.resetRecordingState();
    this.updateTrayIcon("idle");

    if (wasRecording) {
      await this.transcriptionPluginManager.stopTranscription();
    }

    this.dictationWindowService.closeDictationWindow();
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
    this._isRecording = true;
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

  private setFinishingState(): void {
    this._isFinishing = true;
  }

  private async completeDictationAfterFinishing(): Promise<void> {
    try {
      console.log("=== Completing dictation after finishing ===");

      this.clearFinishingTimeout();
      this.resetRecordingState();
      this.trayService?.updateTrayIcon("idle");

      await this.transcriptionPluginManager.stopTranscription();
      this.segmentManager.clearAllSegments();
      this.dictationWindowService.clearTranscription();

      console.log("=== Dictation completed successfully after finishing ===");
    } catch (error) {
      console.error("Failed to complete dictation after finishing:", error);
      await this.cancelDictationFlow();
    }
  }

  private clearFinishingTimeout(): void {
    if (this.finishingTimeout) {
      clearTimeout(this.finishingTimeout);
      this.finishingTimeout = null;
    }
  }

  private resetRecordingState(): void {
    this._isRecording = false;
    this._isFinishing = false;
  }

  private updateTrayIcon(state: "idle" | "recording"): void {
    this.trayService?.updateTrayIcon(state);
  }
}
