import { EventEmitter } from "events";
import { 
  SegmentUpdate 
} from "../types/SegmentTypes";

export interface TranscriptionSetupProgress {
  status: "starting" | "downloading" | "installing" | "complete" | "error";
  message: string;
  percent?: number;
}

export interface TranscriptionPlugin extends EventEmitter {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly supportsRealtime: boolean;
  readonly supportsBatchProcessing: boolean;

  /**
   * Initialize the plugin
   */
  initialize?(): Promise<void>;

  /**
   * Check if the plugin is available and ready to use
   */
  isAvailable(): Promise<boolean>;

  /**
   * Start transcription service
   */
  startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void>;

  /**
   * Stop transcription service
   */
  stopTranscription(): Promise<void>;

  /**
   * Process audio data (for real-time transcription)
   * This method is called when VAD detects speech
   */
  processAudioSegment?(audioData: Float32Array): Promise<void>;

  /**
   * Process audio file (for batch transcription)
   */
  transcribeFile?(filePath: string): Promise<string>;

  /**
   * Clean up resources
   */
  cleanup(): Promise<void>;

  /**
   * Check if currently transcribing
   */
  isTranscribing(): boolean;

  /**
   * Get plugin configuration options
   */
  getConfigSchema?(): TranscriptionPluginConfigSchema;

  /**
   * Set plugin configuration
   */
  configure?(config: Record<string, any>): void;
}

export interface TranscriptionPluginConfigSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "select";
    label: string;
    description?: string;
    default?: any;
    options?: string[]; // For select type
    min?: number; // For number type
    max?: number; // For number type
  };
}

export abstract class BaseTranscriptionPlugin extends EventEmitter implements TranscriptionPlugin {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly supportsRealtime: boolean;
  abstract readonly supportsBatchProcessing: boolean;

  protected isRunning: boolean = false;
  protected onTranscriptionCallback: ((update: SegmentUpdate) => void) | null = null;

  async initialize(): Promise<void> {
    // Override in subclasses if needed
  }

  abstract isAvailable(): Promise<boolean>;
  abstract startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void>;
  abstract stopTranscription(): Promise<void>;
  abstract cleanup(): Promise<void>;

  isTranscribing(): boolean {
    return this.isRunning;
  }

  protected setRunning(running: boolean): void {
    this.isRunning = running;
  }

  protected setTranscriptionCallback(callback: ((update: SegmentUpdate) => void) | null): void {
    this.onTranscriptionCallback = callback;
  }
}
