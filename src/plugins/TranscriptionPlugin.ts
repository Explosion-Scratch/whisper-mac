import { EventEmitter } from "events";
import { SegmentUpdate } from "../types/SegmentTypes";

export interface TranscriptionSetupProgress {
  status: "starting" | "complete" | "error";
  message: string;
}

export interface ModelDownloadProgress {
  status: "starting" | "downloading" | "extracting" | "complete" | "error";
  progress: number;
  message: string;
  modelName?: string;
}

export interface PluginOption {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "model-select";
  label: string;
  description: string;
  default: any;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
    size?: string;
  }>;
  min?: number;
  max?: number;
  required?: boolean;
  category?: "basic" | "advanced" | "model";
}

export interface PluginState {
  isLoading: boolean;
  loadingMessage?: string;
  downloadProgress?: ModelDownloadProgress;
  error?: string;
}

export interface PluginUIFunctions {
  showProgress: (message: string, percent: number) => void;
  hideProgress: () => void;
  showDownloadProgress: (progress: ModelDownloadProgress) => void;
  showError: (error: string) => void;
  showSuccess: (message: string) => void;
  confirmAction: (message: string) => Promise<boolean>;
}

export interface TranscriptionPluginConfigSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "select";
    label: string;
    description: string;
    default: any;
    options?: string[];
    min?: number;
    max?: number;
  };
}

export interface PostProcessedTranscription {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
}

/**
 * Base class for transcription plugins with unified lifecycle management
 */
export abstract class BaseTranscriptionPlugin extends EventEmitter {
  protected isRunning = false;
  protected isInitialized = false;
  protected isActive = false;
  protected currentState: PluginState = { isLoading: false };
  protected options: Record<string, any> = {};
  protected onTranscriptionCallback: ((update: SegmentUpdate) => void) | null =
    null;

  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly supportsRealtime: boolean;
  abstract readonly supportsBatchProcessing: boolean;

  // Existing transcription methods
  abstract isAvailable(): Promise<boolean>;
  abstract startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void>;
  abstract processAudioSegment(audioData: Float32Array): Promise<void>;
  abstract transcribeFile(filePath: string): Promise<string>;
  abstract stopTranscription(): Promise<void>;
  abstract cleanup(): Promise<void>;
  abstract getConfigSchema(): TranscriptionPluginConfigSchema;
  abstract configure(config: Record<string, any>): void;

  // New unified plugin system methods
  abstract getOptions(): PluginOption[];
  abstract verifyOptions(
    options: Record<string, any>
  ): Promise<{ valid: boolean; errors: string[] }>;
  abstract onActivated(uiFunctions?: PluginUIFunctions): Promise<void>;
  abstract initialize(): Promise<void>;
  abstract destroy(): Promise<void>;
  abstract onDeactivate(): Promise<void>;
  abstract clearData(): Promise<void>;
  abstract getDataSize(): Promise<number>;
  abstract getDataPath(): string;
  abstract updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions
  ): Promise<void>;

  /**
   * Called when the dictation window is shown. Default is no-op.
   */
  onDictationWindowShow(): void {}

  /**
   * Called when the dictation window is hidden. Default is no-op.
   */
  onDictationWindowHide(): void {}

  /**
   * Check if the plugin is currently transcribing
   */
  isTranscribing(): boolean {
    return this.isRunning;
  }

  /**
   * Get the current plugin state
   */
  getState(): PluginState {
    return { ...this.currentState };
  }

  /**
   * Check if the plugin is initialized
   */
  isPluginInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if the plugin is active
   */
  isPluginActive(): boolean {
    return this.isActive;
  }

  /**
   * Get current options
   */
  getCurrentOptions(): Record<string, any> {
    return { ...this.options };
  }

  protected setRunning(running: boolean): void {
    this.isRunning = running;
  }

  protected setTranscriptionCallback(
    callback: ((update: SegmentUpdate) => void) | null
  ): void {
    this.onTranscriptionCallback = callback;
  }

  /**
   * Update the plugin loading state
   */
  protected setLoadingState(isLoading: boolean, message?: string): void {
    this.currentState.isLoading = isLoading;
    this.currentState.loadingMessage = message;
    this.emit("stateChanged", this.getState());
  }

  /**
   * Update download progress
   */
  protected setDownloadProgress(progress: ModelDownloadProgress): void {
    this.currentState.downloadProgress = progress;
    this.emit("downloadProgress", progress);
    this.emit("stateChanged", this.getState());
  }

  /**
   * Set error state
   */
  protected setError(error: string | null): void {
    this.currentState.error = error || undefined;
    this.emit("stateChanged", this.getState());
  }

  /**
   * Mark plugin as initialized
   */
  protected setInitialized(initialized: boolean): void {
    this.isInitialized = initialized;
  }

  /**
   * Mark plugin as active
   */
  protected setActive(active: boolean): void {
    this.isActive = active;
  }

  /**
   * Update stored options
   */
  protected setOptions(options: Record<string, any>): void {
    this.options = { ...options };
  }

  /**
   * Uniform post-processing API for transcription output
   * Handles common tasks like timestamp parsing, text cleaning, etc.
   */
  protected postProcessTranscription(
    rawOutput: string,
    options: {
      parseTimestamps?: boolean;
      cleanText?: boolean;
      extractConfidence?: boolean;
    } = {}
  ): PostProcessedTranscription {
    const {
      parseTimestamps = true,
      cleanText = true,
      extractConfidence = false,
    } = options;

    let text = rawOutput.trim();
    let start: number | undefined;
    let end: number | undefined;
    let confidence: number | undefined;

    // Parse timestamps if requested and present
    if (parseTimestamps) {
      // Handle multiple timestamped lines by combining them
      const timestampRegex =
        /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/g;
      const matches = Array.from(text.matchAll(timestampRegex));

      if (matches.length > 0) {
        // Use the first timestamp for start time
        start = this.parseTimestamp(matches[0][1]);

        // Use the last timestamp for end time
        end = this.parseTimestamp(matches[matches.length - 1][2]);

        // Combine all the text from all timestamped segments
        const textParts = matches.map((match) => match[3].trim());
        text = textParts.join(" ");
      }
    }

    // Clean text if requested
    if (cleanText) {
      text = this.cleanTranscriptionText(text);
    }

    // Extract confidence if requested and present
    if (extractConfidence) {
      const confidenceMatch = text.match(/confidence:\s*([0-9.]+)/i);
      if (confidenceMatch) {
        confidence = parseFloat(confidenceMatch[1]);
        text = text.replace(/confidence:\s*[0-9.]+/gi, "").trim();
      }
    }

    return {
      text: text || "[No speech detected]",
      start,
      end,
      confidence,
    };
  }

  /**
   * Parse timestamp string (HH:MM:SS.mmm) to milliseconds
   */
  protected parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(":");
    const seconds = parts[2].split(".");
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secs = parseInt(seconds[0], 10);
    const ms = parseInt(seconds[1], 10);

    return (hours * 3600 + minutes * 60 + secs) * 1000 + ms;
  }

  /**
   * Clean and normalize transcription text
   */
  protected cleanTranscriptionText(text: string): string {
    return (
      text
        .trim()
        // Remove extra whitespace
        .replace(/\s+/g, " ")
        // Remove common transcription artifacts
        .replace(/\[inaudible\]/gi, "")
        .replace(/\[unintelligible\]/gi, "")
        .replace(/\[music\]/gi, "")
        .replace(/\[noise\]/gi, "")
        .trim()
    );
  }

  /**
   * Update segment with post-processed data
   */
  protected updateSegmentWithPostProcessedData(
    segment: any,
    postProcessed: PostProcessedTranscription
  ): void {
    if (segment && segment.type === "transcribed") {
      segment.text = postProcessed.text;
      if (postProcessed.start !== undefined) {
        segment.start = postProcessed.start;
      }
      if (postProcessed.end !== undefined) {
        segment.end = postProcessed.end;
      }
      if (postProcessed.confidence !== undefined) {
        segment.confidence = postProcessed.confidence;
      }
    }
  }
}
