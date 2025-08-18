import { EventEmitter } from "events";
import { SegmentUpdate } from "../types/SegmentTypes";

export interface TranscriptionSetupProgress {
  status: "starting" | "complete" | "error";
  message: string;
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
 * Base class for transcription plugins
 */
export abstract class BaseTranscriptionPlugin extends EventEmitter {
  protected isRunning = false;
  protected onTranscriptionCallback: ((update: SegmentUpdate) => void) | null =
    null;

  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly supportsRealtime: boolean;
  abstract readonly supportsBatchProcessing: boolean;

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

  /**
   * Check if the plugin is currently transcribing
   */
  isTranscribing(): boolean {
    return this.isRunning;
  }

  /**
   * Initialize the plugin (optional - can be overridden by subclasses)
   */
  async initialize(): Promise<void> {
    // Default implementation does nothing
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
