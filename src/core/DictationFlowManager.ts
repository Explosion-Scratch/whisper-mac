import { TranscriptionPluginManager } from "../plugins";
import { DictationWindowService } from "../services/DictationWindowService";
import {
  AudioCaptureService,
  ChunkReadyEvent,
} from "../services/AudioCaptureService";
import { SoundService } from "../services/SoundService";
import { SegmentManager } from "../services/SegmentManager";
import { TrayService } from "../services/TrayService";
import { SegmentUpdate } from "../types/SegmentTypes";
import { ErrorManager } from "./ErrorManager";
import { promiseManager } from "./PromiseManager";
import { appStore, DictationState, selectors } from "./AppStore";
import { DICTATION_CONFIG } from "../config/Constants";

export { DictationState } from "./AppStore";

export class DictationFlowManager {
  private finishingTimeout: NodeJS.Timeout | null = null;
  private eventCleanupFns: Array<() => void> = [];
  private soundService: SoundService | null = null;

  private get state(): DictationState {
    return appStore.select((s) => s.dictation.state);
  }

  private get currentSessionId(): string | null {
    return appStore.select((s) => s.dictation.sessionId);
  }

  constructor(
    private transcriptionPluginManager: TranscriptionPluginManager,
    private dictationWindowService: DictationWindowService,
    private segmentManager: SegmentManager,
    private trayService: TrayService | null,
    private errorManager: ErrorManager,
    private audioCaptureService: AudioCaptureService,
  ) {
    this.setupEventListeners();
  }

  setSoundService(soundService: SoundService | null): void {
    this.soundService = soundService;
  }


  private setupEventListeners(): void {
    const onVadSegment = (
      audio: Float32Array,
      meta?: Partial<ChunkReadyEvent>,
    ) => {
      console.log(
        `[DictationFlowManager] Received vad-segment event (${audio.length} samples), state=${this.state}`,
      );
      this.processVadAudioSegment(audio);
    };

    const onChunkReady = async (event: ChunkReadyEvent) => {
      console.log(
        `[DictationFlowManager] Chunk ready (${event.audio.length} samples, accumulateOnly=${event.accumulateOnly})`,
      );
      await this.handleChunkReady(event);
    };

    const onAudioLevel = (level: number) => {
      this.dictationWindowService.sendAudioLevel(level);
    };

    const onSpeechStart = () => {
      this.dictationWindowService.sendSpeechStart();
    };

    const onSpeechEnd = () => {
      this.dictationWindowService.sendSpeechEnd();
    };

    const onWindowHidden = async () => {
      if (this.state === "recording") {
        console.log("Window hidden while recording - cancelling dictation");
        await this.cancelDictationFlow();
      }
    };

    this.audioCaptureService.on("vad-segment", onVadSegment);
    this.audioCaptureService.on("chunk-ready", onChunkReady);
    this.audioCaptureService.on("audio-level", onAudioLevel);
    this.audioCaptureService.on("speech-start", onSpeechStart);
    this.audioCaptureService.on("speech-end", onSpeechEnd);
    this.dictationWindowService.on("window-hidden", onWindowHidden);

    this.eventCleanupFns.push(
      () => this.audioCaptureService.off("vad-segment", onVadSegment),
      () => this.audioCaptureService.off("chunk-ready", onChunkReady),
      () => this.audioCaptureService.off("audio-level", onAudioLevel),
      () => this.audioCaptureService.off("speech-start", onSpeechStart),
      () => this.audioCaptureService.off("speech-end", onSpeechEnd),
      () => this.dictationWindowService.off("window-hidden", onWindowHidden),
    );
  }

  private async handleChunkReady(event: ChunkReadyEvent): Promise<void> {
    if (this.state !== "recording") return;

    try {
      console.log(
        `[DictationFlowManager] Processing chunk for accumulation (${event.audio.length} samples)`,
      );
      await this.transcriptionPluginManager.processAudioSegment(event.audio);

      const waitSucceeded = await this.waitForCompletedSegmentsStateOnly(
        DICTATION_CONFIG.SEGMENT_COMPLETION_TIMEOUT_MS,
      );
      if (!waitSucceeded) {
        console.log(
          "[DictationFlowManager] Chunk transcription timed out, storing partial",
        );
      }

      const completedSegments =
        this.segmentManager.getCompletedTranscribedSegments();
      if (completedSegments.length > 0) {
        const chunkText = completedSegments
          .map((s) => s.text.trim())
          .filter((t) => t.length)
          .join(" ");
        if (chunkText) {
          appStore.addAccumulatedChunk(chunkText);
          console.log(
            `[DictationFlowManager] Accumulated chunk: "${chunkText.substring(0, 50)}..."`,
          );
        }
        this.segmentManager.clearCompletedSegmentsOnly();
      }
    } catch (error) {
      console.error("[DictationFlowManager] Failed to process chunk:", error);
    }
  }

  setTrayService(trayService: TrayService | null): void {
    this.trayService = trayService;
  }

  isRecording(): boolean {
    return appStore.select((s) => s.dictation.state) === "recording";
  }

  isFinishing(): boolean {
    return appStore.select((s) => s.dictation.state) === "finishing";
  }

  setFinishingTimeout(timeout: NodeJS.Timeout | null): NodeJS.Timeout | null {
    const currentTimeout = this.finishingTimeout;
    this.finishingTimeout = timeout;
    return currentTimeout;
  }

  async startDictation(): Promise<void> {
    if (this.state !== "idle") return;

    const sessionId = `dictation-${Date.now()}`;
    appStore.setDictationState("recording", sessionId);
    promiseManager.start(`dictation:init:${sessionId}`);
    const startTime = Date.now();
    try {
      console.log(`[Perf] Sending start recording command at ${Date.now()}`);
      console.log("=== Starting dictation process ===");

      this.clearState();
      this.setupAccumulatingMode();

      promiseManager.start(`dictation:transcription:start:${sessionId}`);
      await this.startTranscription();
      promiseManager.resolve(`dictation:transcription:start:${sessionId}`);

      promiseManager.start(`dictation:window:show:${sessionId}`);
      const windowStartTime = Date.now();
      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      const runOnAllSession =
        !!criteria?.runOnAll ||
        this.transcriptionPluginManager.willBufferNextSession();

      // Start recording immediately
      await this.startRecording();

      await this.dictationWindowService.showDictationWindow(runOnAllSession);
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);
      promiseManager.resolve(`dictation:window:show:${sessionId}`);

      promiseManager.resolve(`dictation:init:${sessionId}`);

      const totalTime = Date.now() - startTime;
      console.log(`=== Dictation started successfully in ${totalTime}ms ===`);
    } catch (error) {
      console.error("Failed to start dictation:", error);
      promiseManager.reject(`dictation:init:${sessionId}`, error);
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

    console.log(
      "=== stopDictation called, redirecting to cancelDictationFlow for a clean exit ===",
    );
    await this.cancelDictationFlow();
  }

  async finishCurrentDictation(
    options: { skipTransformation?: boolean } = {},
  ): Promise<void> {
    if (this.state !== "recording") return;

    try {
      appStore.setDictationState("finishing");

      const pendingSkipTransformation = appStore.select(
        (s) => s.dictation.pendingSkipTransformation,
      );
      if (pendingSkipTransformation) {
        appStore.setState({
          dictation: {
            ...appStore.getState().dictation,
            pendingSkipTransformation: false,
          },
        });
        console.log(
          "Using pending skipTransformation flag from paste raw dictation",
        );
      }

      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      const bufferingEnabled =
        this.transcriptionPluginManager.isBufferingEnabledForActivePlugin();
      const hasBufferedAudio =
        this.transcriptionPluginManager.hasBufferedAudio();
      const skipAllTransforms = !!criteria?.skipAllTransforms;
      const skipTransformation =
        !!options.skipTransformation ||
        pendingSkipTransformation ||
        !!criteria?.skipTransformation;

      // Diagnostic logging for intermittent no-transcription bug
      console.log(`[DictationFlowManager] finishCurrentDictation state:`, {
        bufferingEnabled,
        hasBufferedAudio,
        segmentsCount: this.segmentManager.getAllSegments().length,
        hasSegmentsToProcess: this.hasSegmentsToProcess(),
        criteria,
      });

      console.log(
        `=== Finishing current dictation with ${skipTransformation ? "raw injection" : "transform+inject"} ===`,
      );
      this.soundService?.playSound("stop");
      this.dictationWindowService.stopRecording(); // UI update

      // Stop audio capture - fallback audio is already emitted as vad-segment event
      // and processed by the event listener, so we don't need to process the return value
      await this.audioCaptureService.stopCapture();

      // Wait for any in-flight processing using state-based approach
      const audioStopWait = this.waitForAudioProcessingComplete();
      if (this.currentSessionId) {
        promiseManager.start(`dictation:audio:stop:${this.currentSessionId}`);
        await audioStopWait;
        promiseManager.resolve(`dictation:audio:stop:${this.currentSessionId}`);
      } else {
        await audioStopWait;
      }

      // Re-check buffered audio state after 300ms wait (it may have changed)
      const hasBufferedAudioAfterWait =
        this.transcriptionPluginManager.hasBufferedAudio();
      const segmentsAfterWait = this.segmentManager.getAllSegments().length;
      console.log(`[DictationFlowManager] After 300ms wait:`, {
        hasBufferedAudioAfterWait,
        segmentsAfterWait,
        hasSegmentsToProcess: this.hasSegmentsToProcess(),
      });

      if (!this.hasSegmentsToProcess()) {
        if (
          !(
            bufferingEnabled &&
            this.transcriptionPluginManager.hasBufferedAudio()
          )
        ) {
          console.log(
            `[DictationFlowManager] CANCELLING: No segments found. bufferingEnabled=${bufferingEnabled}, hasBufferedAudio=${this.transcriptionPluginManager.hasBufferedAudio()}`,
          );
          await this.cancelDictationFlow();
          return;
        }
      }

      console.log(
        `Found ${
          this.segmentManager.getAllSegments().length
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
        // Play transform complete sound if transformation was actually performed
        if (!skipTransformation && !skipAllTransforms) {
          this.soundService?.playSound("transformComplete");
        }
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
        promiseManager.resolve(
          `dictation:window:hide:${this.currentSessionId}`,
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.dictationWindowService.hideWindow();
      }

      promiseManager.start(`dictation:cleanup:${this.currentSessionId}`);
      await this.transcriptionPluginManager.stopTranscription();
      this.segmentManager.clearAllSegments();
      this.dictationWindowService.clearTranscription();
      this.updateTrayIcon("idle");
      appStore.setDictationState("idle", null);
      if (this.currentSessionId) {
        promiseManager.resolve(`dictation:cleanup:${this.currentSessionId}`);
      }
      console.log("=== Dictation completed and cleaned up successfully ===");
    } catch (error) {
      console.error("Failed to finish current dictation:", error);
      await this.cancelDictationFlow();
    } finally {
      this.clearFinishingTimeout();
      if (appStore.select((s) => s.dictation.state) === "finishing") {
        appStore.setDictationState("idle", null);
      }
    }
  }

  async flushSegmentsWhileContinuing(
    options: { skipTransformation?: boolean } = {},
  ): Promise<void> {
    const flushId = `flush:${Date.now()}`;
    promiseManager.start(flushId);

    try {
      console.log("=== Flushing segments while continuing recording ===");

      this.dictationWindowService.showWindow();
      this.dictationWindowService.setStatus("transcribing");

      await this.dictationWindowService.flushPendingAudio();

      const bufferingEnabled =
        this.transcriptionPluginManager.isBufferingEnabledForActivePlugin();

      if (
        bufferingEnabled &&
        this.transcriptionPluginManager.hasBufferedAudio()
      ) {
        console.log("=== Finalizing buffered audio before flush ===");
        try {
          await this.transcriptionPluginManager.finalizeBufferedAudio();
        } catch (e) {
          console.error("Failed to finalize buffered audio:", e);
        }
      }

      const completedSegments =
        this.segmentManager.getCompletedTranscribedSegments();
      const inProgressSegments =
        this.segmentManager.getInProgressTranscribedSegments();

      if (completedSegments.length === 0 && inProgressSegments.length === 0) {
        console.log(
          "No segments to inject - user pressed before any speech detected, continuing recording",
        );
        this.dictationWindowService.setStatus("recording");
        promiseManager.resolve(flushId, {
          skipped: true,
          reason: "no-segments",
        });
        return;
      }

      if (completedSegments.length === 0 && inProgressSegments.length > 0) {
        console.log(
          `Found ${inProgressSegments.length} in-progress segments - waiting for transcription completion via state`,
        );

        const gotCompleted = await this.waitForSegmentCompletion();

        if (!gotCompleted) {
          console.log(
            "No segments completed after waiting - continuing recording",
          );
          this.dictationWindowService.setStatus("recording");
          promiseManager.resolve(flushId, {
            skipped: true,
            reason: "no-completed-segments",
          });
          return;
        }
      }

      const finalCompletedSegments =
        this.segmentManager.getCompletedTranscribedSegments();

      if (finalCompletedSegments.length === 0) {
        console.log("Still no completed segments - continuing recording");
        this.dictationWindowService.setStatus("recording");
        promiseManager.resolve(flushId, {
          skipped: true,
          reason: "no-completed-segments",
        });
        return;
      }

      const hadInProgress =
        this.segmentManager.getInProgressTranscribedSegments().length > 0;

      this.dictationWindowService.setStatus("transforming");

      const skipTransformation = !!options.skipTransformation;
      if (skipTransformation) {
        console.log(
          "[DictationFlowManager] Skipping transformation during flush",
        );
      }

      const result =
        await this.segmentManager.transformAndInjectCompletedSegments({
          skipTransformation,
          onInjecting: () => this.dictationWindowService.setStatus("injecting"),
        });

      if (result.success) {
        console.log(
          `Flushed and injected ${result.segmentsProcessed} segments (continuing)`,
        );
      } else {
        console.error("Flush while continuing failed:", result.error);
      }

      this.dictationWindowService.clearTranscriptionDisplay();
      this.segmentManager.setAccumulatingMode(true);

      if (hadInProgress) {
        this.segmentManager.ignoreNextCompletedSegment();
      }

      appStore.setDictationState("recording");
      this.updateTrayIcon("recording");
      this.dictationWindowService.setStatus("recording");
      this.dictationWindowService.setStatus("recording");
      this.dictationWindowService.startRecording();
      await this.audioCaptureService.startCapture();

      promiseManager.resolve(flushId, result);
    } catch (error) {
      console.error("Failed to flush segments while continuing:", error);
      this.dictationWindowService.setStatus("recording");
      promiseManager.reject(flushId, error);
    }
  }

  private waitForSegmentCompletion(): Promise<boolean> {
    return new Promise((resolve) => {
      const completed = this.segmentManager.getCompletedTranscribedSegments();
      if (completed.length > 0) {
        resolve(true);
        return;
      }

      const inProgress = this.segmentManager.getInProgressTranscribedSegments();
      if (inProgress.length === 0) {
        resolve(false);
        return;
      }

      let resolved = false;
      const unsubscribe = appStore.subscribe(
        (state) => state.segments.items,
        (segments) => {
          if (resolved) return;

          const nowCompleted = segments.filter(
            (s) => s.type === "transcribed" && (s as any).completed === true,
          );
          if (nowCompleted.length > 0) {
            resolved = true;
            unsubscribe();
            resolve(true);
          }
        },
      );

      const checkDictationState = appStore.subscribe(
        (state) => state.dictation.state,
        (dictationState) => {
          if (resolved) return;

          if (dictationState === "idle") {
            resolved = true;
            unsubscribe();
            checkDictationState();
            resolve(false);
          }
        },
      );
    });
  }

  async cancelDictationFlow(): Promise<void> {
    console.log("=== Cancelling dictation flow ===");

    this.clearFinishingTimeout();
    const wasRecording = this.state !== "idle";
    const sessionId = this.currentSessionId;

    appStore.setState({
      dictation: {
        ...appStore.getState().dictation,
        state: "idle",
        sessionId: null,
        pendingSkipTransformation: false,
      },
    });
    this.updateTrayIcon("idle");

    if (sessionId) {
      promiseManager.cancel(`dictation:init:${sessionId}`);
    }

    if (wasRecording) {
      await this.transcriptionPluginManager.stopTranscription();
      await this.audioCaptureService.stopCapture();
    }

    this.dictationWindowService.hideWindow();
    this.segmentManager.clearAllSegments();
    this.dictationWindowService.setStatus("idle");

    if (sessionId) {
      promiseManager.start(`dictation:cleanup:${sessionId}`);
      promiseManager.resolve(`dictation:cleanup:${sessionId}`);
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

  private async startRecording(): Promise<void> {
    this.soundService?.playSound("start");
    this.trayService?.updateTrayIcon("recording");
    this.dictationWindowService.startRecording();
    await this.audioCaptureService.startCapture();
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
        const result = this.segmentManager.addTranscribedSegment(
          segment.text,
          segment.completed,
          segment.start,
          segment.end,
          segment.confidence,
        );
        if (result.closesTranscription) {
          await this.stopDictation();
          return;
        }
      }
    }

    for (const segment of inProgressSegments) {
      if (segment.type === "inprogress") {
        const result = this.segmentManager.addTranscribedSegment(
          segment.text,
          false,
          segment.start,
          segment.end,
          segment.confidence,
        );
        if (result.closesTranscription) {
          await this.stopDictation();
          return;
        }
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
    appStore.setUIState({ trayIconState: state });
  }

  private async waitForCompletedSegments(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const completed = this.segmentManager.getCompletedTranscribedSegments();
      if (completed.length > 0) {
        resolve(true);
        return;
      }

      const inProgress = this.segmentManager.getInProgressTranscribedSegments();
      if (inProgress.length === 0 && completed.length === 0) {
        const bufferingEnabled =
          this.transcriptionPluginManager.isBufferingEnabledForActivePlugin();
        const hasBuffered = this.transcriptionPluginManager.hasBufferedAudio();
        if (!bufferingEnabled || !hasBuffered) {
          resolve(false);
          return;
        }
      }

      let unsubscribe: (() => void) | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (unsubscribe) unsubscribe();
        if (timeoutId) clearTimeout(timeoutId);
      };

      unsubscribe = appStore.subscribe(
        (state) => state.segments.items,
        (segments) => {
          const nowCompleted = segments.filter(
            (s) => s.type === "transcribed" && (s as any).completed === true,
          );
          if (nowCompleted.length > 0) {
            cleanup();
            resolve(true);
          }
        },
      );

      timeoutId = setTimeout(() => {
        cleanup();
        const finalCompleted =
          this.segmentManager.getCompletedTranscribedSegments();
        resolve(finalCompleted.length > 0);
      }, timeoutMs);
    });
  }

  private waitForCompletedSegmentsStateOnly(
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const completed = this.segmentManager.getCompletedTranscribedSegments();
      if (completed.length > 0) {
        resolve(true);
        return;
      }

      let resolved = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const unsubscribe = appStore.subscribe(
        selectors.completedSegments,
        (segments) => {
          if (resolved) return;
          if (segments.length > 0) {
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            unsubscribe();
            resolve(true);
          }
        },
      );

      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        unsubscribe();
        resolve(
          this.segmentManager.getCompletedTranscribedSegments().length > 0,
        );
      }, timeoutMs);
    });
  }

  private waitForAudioProcessingComplete(): Promise<void> {
    return new Promise((resolve) => {
      const isCapturing = appStore.select(selectors.isCapturing);
      if (!isCapturing) {
        resolve();
        return;
      }

      let resolved = false;
      const unsubscribe = appStore.subscribe(
        selectors.isCapturing,
        (capturing) => {
          if (resolved) return;
          if (!capturing) {
            resolved = true;
            unsubscribe();
            resolve();
          }
        },
      );

      const checkNow = appStore.select(selectors.isCapturing);
      if (!checkNow && !resolved) {
        resolved = true;
        unsubscribe();
        resolve();
      }
    });
  }

  cleanup(): void {
    this.eventCleanupFns.forEach((fn) => fn());
    this.eventCleanupFns = [];
    this.clearFinishingTimeout();
  }
}
