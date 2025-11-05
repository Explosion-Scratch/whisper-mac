import { TranscriptionPluginManager } from "../plugins";
import { DictationWindowService } from "../services/DictationWindowService";
import { SegmentManager } from "../services/SegmentManager";
import { TrayService } from "../services/TrayService";
import { SegmentUpdate } from "../types/SegmentTypes";
import { ErrorManager } from "./ErrorManager";
import { promiseManager } from "./PromiseManager";

export type DictationState = "idle" | "recording" | "finishing";

export class DictationFlowManager {
  private state: DictationState = "idle";
  private finishingTimeout: NodeJS.Timeout | null = null;
  private currentSessionId: string | null = null;

  constructor(
    private transcriptionPluginManager: TranscriptionPluginManager,
    private dictationWindowService: DictationWindowService,
    private segmentManager: SegmentManager,
    private trayService: TrayService | null,
    private errorManager: ErrorManager,
  ) {
    this.dictationWindowService.on(
      "vad-audio-segment",
      this.processVadAudioSegment.bind(this),
    );
  }

  setTrayService(trayService: TrayService | null): void {
    this.trayService = trayService;
  }

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

    this.currentSessionId = `dictation-${Date.now()}`;
    promiseManager.start(`dictation:init:${this.currentSessionId}`);
    this.state = "recording";
    const startTime = Date.now();
    try {
      console.log("=== Starting dictation process ===");

      this.clearState();
      this.setupAccumulatingMode();

      // Coordinate window show
      promiseManager.start(`dictation:window:show:${this.currentSessionId}`);
      const windowStartTime = Date.now();
      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      const runOnAllSession =
        !!criteria?.runOnAll ||
        this.transcriptionPluginManager.willBufferNextSession();
      await this.dictationWindowService.showDictationWindow(runOnAllSession);
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);
      promiseManager.resolve(`dictation:window:show:${this.currentSessionId}`);

      // Coordinate transcription start
      promiseManager.start(`dictation:transcription:start:${this.currentSessionId}`);
      await this.startTranscription();
      this.startRecording();
      promiseManager.resolve(`dictation:transcription:start:${this.currentSessionId}`);

      // Mark initialization complete
      promiseManager.resolve(`dictation:init:${this.currentSessionId}`);

      const totalTime = Date.now() - startTime;
      console.log(`=== Dictation started successfully in ${totalTime}ms ===`);
    } catch (error) {
      console.error("Failed to start dictation:", error);
      if (this.currentSessionId) {
        promiseManager.reject(`dictation:init:${this.currentSessionId}`, error);
      }
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

  async finishCurrentDictation(options: { skipTransformation?: boolean } = {}): Promise<void> {
    if (this.state !== "recording") return;

    try {
      this.state = "finishing";
const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      const bufferingEnabled =
        this.transcriptionPluginManager.isBufferingEnabledForActivePlugin();
      const skipAllTransforms = !!criteria?.skipAllTransforms;
      const skipTransformation =
        !!options.skipTransformation || !!criteria?.skipTransformation;

      console.log(
        `=== Finishing current dictation with ${skipTransformation ? "raw injection" : "transform+inject"} ===`,
      );
      this.dictationWindowService.stopRecording(); // Stop VAD audio processing
      
      // Coordinate audio stop
      if (this.currentSessionId) {
        promiseManager.start(`dictation:audio:stop:${this.currentSessionId}`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        promiseManager.resolve(`dictation:audio:stop:${this.currentSessionId}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (!this.hasSegmentsToProcess()) {
        if (
          !(
            bufferingEnabled &&
            this.transcriptionPluginManager.hasBufferedAudio()
          )
        ) {
          console.log("No segments found, cancelling dictation immediately");
          await this.cancelDictationFlow();
          return;
        }
      }

      console.log(
        `Found ${this.segmentManager.getAllSegments().length
        } segments to transform and inject`,
      );

      this.dictationWindowService.setStatus("transcribing");
      this.segmentManager.setAccumulatingMode(false);

      console.log("Criteria:", criteria);

      if (bufferingEnabled) {
        console.log(
          "=== Active plugin runOnAll enabled: finalizing buffered audio ===",
        );
        try {
          await this.transcriptionPluginManager.finalizeBufferedAudio();
        } catch (e) {
          console.error("Failed to finalize buffered audio:", e);
        }
      }

      // Wait briefly for any in-flight transcription to complete so we don't inject placeholders
      const waitSucceeded = await this.waitForCompletedSegments(8000);
      console.log("Wait for completed segments:", waitSucceeded);

console.log(
        "=== Transforming and injecting all accumulated segments ===",
      );
      this.dictationWindowService.setStatus("transforming");
      const transformResult =
        await this.segmentManager.transformAndInjectAllSegmentsInternal({
          skipTransformation: skipAllTransforms || skipTransformation,
          skipAllTransforms: skipAllTransforms,
          onInjecting: () => this.dictationWindowService.setStatus("injecting"),
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
      // Coordinate window hide
      if (this.currentSessionId) {
        promiseManager.start(`dictation:window:hide:${this.currentSessionId}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.dictationWindowService.hideWindow();
        promiseManager.resolve(`dictation:window:hide:${this.currentSessionId}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.dictationWindowService.hideWindow();
      }

      // Final cleanup
      promiseManager.start(`dictation:cleanup:${this.currentSessionId}`);
      await this.transcriptionPluginManager.stopTranscription();
      this.segmentManager.clearAllSegments();
      this.dictationWindowService.clearTranscription();
      this.updateTrayIcon("idle");
      this.state = "idle";
      if (this.currentSessionId) {
        promiseManager.resolve(`dictation:cleanup:${this.currentSessionId}`);
        this.currentSessionId = null;
      }
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

  async flushSegmentsWhileContinuing(options: { skipTransformation?: boolean } = {}): Promise<void> {
    try {
      console.log("=== Flushing segments while continuing recording ===");

      this.dictationWindowService.showWindow();
      this.dictationWindowService.setStatus("transforming");

      const hadInProgress =
        this.segmentManager.getInProgressTranscribedSegments().length > 0;

      const skipTransformation = !!options.skipTransformation;
      if (skipTransformation) {
        console.log("[DictationFlowManager] Skipping transformation during flush");
      }

      const result = await this.segmentManager.transformAndInjectAllSegmentsInternal({
        skipTransformation,
      });

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

    if (this.currentSessionId) {
      promiseManager.cancel(`dictation:init:${this.currentSessionId}`);
    }

    if (wasRecording) {
      await this.transcriptionPluginManager.stopTranscription();
    }

    this.dictationWindowService.hideWindow();
    this.segmentManager.clearAllSegments();
    this.dictationWindowService.setStatus("idle");

    if (this.currentSessionId) {
      promiseManager.start(`dictation:cleanup:${this.currentSessionId}`);
      promiseManager.resolve(`dictation:cleanup:${this.currentSessionId}`);
      this.currentSessionId = null;
    }

    console.log("=== Dictation flow cancelled and cleaned up ===");
  }

  private clearState(): void {
    this.segmentManager.clearAllSegments();
    this.segmentManager.resetIgnoreNextCompleted();
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
        `Transcription setup: ${transcriptionEndTime - transcriptionStartTime
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

  private async processVadAudioSegment(audioData: Float32Array): Promise<void> {
    if (this.state !== "recording" && this.state !== "finishing") {
      return;
    }

    try {
      this.dictationWindowService.setStatus("transcribing");
      console.log("Processing VAD audio segment:", audioData.length, "samples");
      await this.transcriptionPluginManager.processAudioSegment(audioData);
    } catch (error) {
      console.error("Error processing audio segment:", error);
    } finally {
      if (this.state === "recording") {
        this.dictationWindowService.setStatus("recording");
      }
    }
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

  private async waitForCompletedSegments(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const completed = this.segmentManager.getCompletedTranscribedSegments();
      if (completed.length > 0) {
        return true;
      }
      const inProgress = this.segmentManager.getInProgressTranscribedSegments();
      if (inProgress.length === 0) {
        return false;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }
}
