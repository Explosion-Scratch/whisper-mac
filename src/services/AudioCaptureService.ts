import { EventEmitter } from "events";
import { AudioCaptureNative } from "../native/AudioCaptureBindings";
import { AppConfig } from "../config/AppConfig";
import { AUDIO_CAPTURE_CONFIG } from "../config/Constants";
import { AudioBufferManager } from "../helpers/AudioBufferManager";
import { appStore, selectors } from "../core/AppStore";
import * as fs from "fs/promises";
import * as path from "path";
import * as ort from "onnxruntime-node";

const { FrameProcessor, Message } = require("@ricky0123/vad-node");
const { Silero } = require("@ricky0123/vad-node/dist/_common/models");

export interface ChunkReadyEvent {
  audio: Float32Array;
  isPartialChunk: boolean;
  accumulateOnly: boolean;
}

export class AudioCaptureService extends EventEmitter {
  private nativeAudio: AudioCaptureNative;
  private vadModel: any = null;
  private frameProcessor: any = null;
  private isInitializing = false;
  private bufferManager = new AudioBufferManager();
  private audioBuffer: Float32Array[] = [];
  private lastProcessPromise: Promise<void> = Promise.resolve();
  private unsubscribeVadReady: (() => void) | null = null;

  private vadOptions = {
    positiveSpeechThreshold: AUDIO_CAPTURE_CONFIG.VAD_POSITIVE_SPEECH_THRESHOLD,
    negativeSpeechThreshold: AUDIO_CAPTURE_CONFIG.VAD_NEGATIVE_SPEECH_THRESHOLD,
    minSpeechFrames: AUDIO_CAPTURE_CONFIG.VAD_MIN_SPEECH_FRAMES,
    preSpeechPadFrames: AUDIO_CAPTURE_CONFIG.VAD_PRE_SPEECH_PAD_FRAMES,
    redemptionFrames: AUDIO_CAPTURE_CONFIG.VAD_REDEMPTION_FRAMES,
    sampleRate: AUDIO_CAPTURE_CONFIG.SAMPLE_RATE,
    frameSamples: AUDIO_CAPTURE_CONFIG.BUFFER_SIZE,
  };

  constructor(private config: AppConfig) {
    super();
    this.nativeAudio = new AudioCaptureNative();
  }

  async initialize(): Promise<void> {
    if (this.isInitializing || this.vadModel) return;
    this.isInitializing = true;

    console.log("Initializing AudioCaptureService...");
    try {
      const vadPackagePath =
        require.resolve("@ricky0123/vad-node/package.json");
      const modelPath = path.join(
        path.dirname(vadPackagePath),
        "dist",
        "silero_vad.onnx",
      );

      const modelFetcher = async () => {
        const contents = await fs.readFile(modelPath);
        return contents.buffer;
      };

      this.vadModel = await Silero.new(ort, modelFetcher);
      this.frameProcessor = new FrameProcessor(
        this.vadModel.process,
        this.vadModel.reset_state,
        this.vadOptions,
      );
      this.frameProcessor.resume();

      appStore.setAudioCaptureState({ vadReady: true });
      console.log("VAD Initialized with custom FrameProcessor");

      if (this.audioBuffer.length > 0) {
        console.log(
          `Processing ${this.audioBuffer.length} buffered audio chunks...`,
        );
        for (const chunk of this.audioBuffer) {
          await this.handleAudioData(chunk);
        }
        this.audioBuffer = [];
        console.log("Buffered audio processed");
      }
    } catch (e) {
      console.error("Failed to initialize VAD:", e);
      appStore.setAudioCaptureState({ vadReady: false });
    } finally {
      this.isInitializing = false;
    }
  }

  async startCapture(): Promise<boolean> {
    const isCapturing = appStore.select(selectors.isCapturing);
    if (isCapturing) return true;

    console.log("Starting native audio capture...");

    this.audioBuffer = [];
    this.bufferManager.reset();

    appStore.setAudioCaptureState({
      isCapturing: true,
      chunkStartTime: Date.now(),
      processedSampleCount: 0,
      lastSegmentEndSample: 0,
    });

    if (!this.frameProcessor) {
      this.initialize();
    } else {
      this.frameProcessor.resume();
      try {
        this.vadModel?.reset_state?.();
      } catch {}
      this.frameProcessor.reset();
      appStore.setAudioCaptureState({ vadReady: true });
    }

    const success = this.nativeAudio.start(
      {
        sampleRate: AUDIO_CAPTURE_CONFIG.SAMPLE_RATE,
        bufferSize: AUDIO_CAPTURE_CONFIG.BUFFER_SIZE,
      },
      (data: Float32Array) => this.handleAudioData(data),
    );

    if (success) {
      this.emit("recording-started");
    } else {
      appStore.setAudioCaptureState({ isCapturing: false });
      if (this.nativeAudio.isFallback()) {
        console.error(
          "Failed to start native audio capture: Native module not loaded",
        );
      } else {
        console.error(
          "Failed to start native audio capture: start() returned false",
        );
      }
    }

    return success;
  }

  async stopCapture(): Promise<Float32Array | null> {
    const isCapturing = appStore.select(selectors.isCapturing);
    if (!isCapturing) return null;

    console.log(`[AudioCaptureService] Stopping capture. State:`, {
      segmentCount: this.bufferManager.getSegmentCount(),
      processedSampleCount: this.bufferManager.getProcessedSampleCount(),
      lastSegmentEndSample: this.bufferManager.getLastSegmentEndSample(),
    });

    this.nativeAudio.stop();
    appStore.setAudioCaptureState({ isCapturing: false });
    this.emit("recording-stopped");

    try {
      await this.lastProcessPromise;
    } catch (e) {
      console.error("Error waiting for VAD processing during stop:", e);
    }

    if (this.frameProcessor) {
      const res = this.frameProcessor.pause();
      if (res.msg === Message.SpeechEnd && res.audio) {
        console.log(
          "VAD Capture: Retrieved final segment from pause() of length:",
          res.audio.length,
        );

        this.bufferManager.incrementSegmentCount();
        let audioToEmit = res.audio;

        if (this.bufferManager.getSegmentCount() === 1) {
          audioToEmit = this.bufferManager.getFullAudioSinceLast();
        }

        this.emitVadSegment(audioToEmit, false);
      } else {
        console.log(
          "VAD Capture: pause() did not return SpeechEnd. Msg:",
          res.msg,
        );
      }
    }

    let fallbackAudio: Float32Array | null = null;

    if (this.bufferManager.hasNoSegments()) {
      if (this.bufferManager.hasAudioData()) {
        console.log(
          `[AudioCaptureService] No VAD segments detected. Emitting full recording buffer`,
        );
        const fullAudio = this.bufferManager.getFullAudioSinceLast();
        this.emitVadSegment(fullAudio, false);
        fallbackAudio = fullAudio;
      } else {
        console.log(
          `[AudioCaptureService] No VAD segments and no audio samples processed`,
        );
      }
    } else {
      const tailAudio = this.bufferManager.getTailAudio();
      if (tailAudio) {
        console.log(
          `[AudioCaptureService] Emitting tail segment (${tailAudio.length} samples)`,
        );
        this.emitVadSegment(tailAudio, false);
      }
    }

    return fallbackAudio;
  }

  private emitVadSegment(audio: Float32Array, accumulateOnly: boolean): void {
    this.bufferManager.setLastSegmentEndSample(
      this.bufferManager.getProcessedSampleCount(),
    );

    appStore.setAudioCaptureState({
      processedSampleCount: this.bufferManager.getProcessedSampleCount(),
      lastSegmentEndSample: this.bufferManager.getLastSegmentEndSample(),
    });

    const isAtSoftLimit = this.bufferManager.isAtSoftLimit();

    this.emit("vad-segment", audio, {
      isPartialChunk: isAtSoftLimit,
      accumulateOnly,
    } as Partial<ChunkReadyEvent>);
  }

  private async handleAudioData(data: Float32Array): Promise<void> {
    const isCapturing = appStore.select(selectors.isCapturing);
    if (!isCapturing) return;

    const level = this.nativeAudio.getAudioLevel();
    this.emit("audio-level", level);

    this.lastProcessPromise = this.lastProcessPromise.then(async () => {
      if (!this.frameProcessor) {
        this.audioBuffer.push(data);
        return;
      }

      this.bufferManager.addChunk(data);

      if (this.bufferManager.isAtHardLimit()) {
        console.log(
          "[AudioCaptureService] Hit hard limit - forcing chunk emission",
        );
        const chunkAudio = this.bufferManager.getCurrentChunkAudio();
        this.emit("chunk-ready", {
          audio: chunkAudio,
          isPartialChunk: true,
          accumulateOnly: true,
        } as ChunkReadyEvent);
        this.bufferManager.advanceChunk();
        appStore.setAudioCaptureState({
          chunkStartTime: Date.now(),
        });
      }

      try {
        const vadEvent = await this.frameProcessor.process(data);

        if (vadEvent.msg === Message.SpeechEnd && vadEvent.audio) {
          this.bufferManager.incrementSegmentCount();
          console.log(
            `VAD Speech End Detected (Segment ${this.bufferManager.getSegmentCount()})`,
          );
          this.emit("speech-end");

          const isAtSoftLimit = this.bufferManager.isAtSoftLimit();
          let audioToEmit = vadEvent.audio;

          if (this.bufferManager.getSegmentCount() === 1 && !isAtSoftLimit) {
            audioToEmit = this.bufferManager.getAudioSlice(
              this.bufferManager.getChunkStartSample(),
              this.bufferManager.getProcessedSampleCount(),
            );
          }

          if (isAtSoftLimit) {
            console.log(
              "[AudioCaptureService] At soft limit - emitting accumulated chunk",
            );
            const chunkAudio = this.bufferManager.getCurrentChunkAudio();
            this.emit("chunk-ready", {
              audio: chunkAudio,
              isPartialChunk: true,
              accumulateOnly: true,
            } as ChunkReadyEvent);
            this.bufferManager.advanceChunk();
            appStore.setAudioCaptureState({
              chunkStartTime: Date.now(),
            });
          } else {
            this.emitVadSegment(audioToEmit, false);
          }
        } else if (vadEvent.msg === Message.SpeechStart) {
          console.log("VAD Speech Start Detected");
          this.emit("speech-start");
        }
      } catch (e) {
        console.error("VAD processing error:", e);
      }
    });
  }

  isVadReady(): boolean {
    return appStore.select(selectors.vadReady);
  }

  waitForVadReady(): Promise<void> {
    return new Promise((resolve) => {
      if (appStore.select(selectors.vadReady)) {
        resolve();
        return;
      }

      const unsub = appStore.subscribe(selectors.vadReady, (ready) => {
        if (ready) {
          unsub();
          resolve();
        }
      });
    });
  }

  cleanup(): void {
    if (this.unsubscribeVadReady) {
      this.unsubscribeVadReady();
      this.unsubscribeVadReady = null;
    }
    this.removeAllListeners();
    appStore.clearAudioCaptureState();
  }
}
