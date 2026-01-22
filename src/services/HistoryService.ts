import { EventEmitter } from "events";
import { join } from "path";
import { promises as fs } from "fs";
import { v4 as uuidv4 } from "uuid";
import { AppConfig } from "../config/AppConfig";

export interface RecordingEntry {
  id: string;
  timestamp: number;
  audioPath: string;
  rawTranscription: string;
  transformedTranscription: string | null;
  duration: number;
  pluginUsed: string | null;
}

export interface HistorySettings {
  enabled: boolean;
  maxRecordings: number;
}

interface HistoryData {
  recordings: RecordingEntry[];
  settings: HistorySettings;
}

const DEFAULT_SETTINGS: HistorySettings = {
  enabled: true,
  maxRecordings: 100,
};

export class HistoryService extends EventEmitter {
  private static instance: HistoryService | null = null;
  private config: AppConfig;
  private historyData: HistoryData;
  private historyFilePath: string;
  private recordingsDir: string;
  private initialized: boolean = false;
  private saveDebounceTimeout: NodeJS.Timeout | null = null;

  private constructor(config: AppConfig) {
    super();
    this.config = config;
    this.historyFilePath = join(config.dataDir, "history.json");
    this.recordingsDir = join(config.dataDir, "recordings");
    this.historyData = {
      recordings: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  static getInstance(config: AppConfig): HistoryService {
    if (!HistoryService.instance) {
      HistoryService.instance = new HistoryService(config);
    }
    return HistoryService.instance;
  }

  static resetInstance(): void {
    HistoryService.instance = null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure recordings directory exists
      await fs.mkdir(this.recordingsDir, { recursive: true });

      // Load existing history data
      await this.loadHistory();
      this.initialized = true;
      console.log("[HistoryService] Initialized with", this.historyData.recordings.length, "recordings");
    } catch (error) {
      console.error("[HistoryService] Failed to initialize:", error);
      throw error;
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const data = await fs.readFile(this.historyFilePath, "utf-8");
      const parsed = JSON.parse(data) as HistoryData;

      this.historyData = {
        recordings: Array.isArray(parsed.recordings) ? parsed.recordings : [],
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        // File doesn't exist, use defaults
        this.historyData = {
          recordings: [],
          settings: { ...DEFAULT_SETTINGS },
        };
      } else {
        console.error("[HistoryService] Failed to load history:", error);
        this.historyData = {
          recordings: [],
          settings: { ...DEFAULT_SETTINGS },
        };
      }
    }
  }

  private async saveHistory(): Promise<void> {
    // Debounce saves to avoid excessive disk writes
    if (this.saveDebounceTimeout) {
      clearTimeout(this.saveDebounceTimeout);
    }

    this.saveDebounceTimeout = setTimeout(async () => {
      try {
        await fs.writeFile(
          this.historyFilePath,
          JSON.stringify(this.historyData, null, 2),
          "utf-8"
        );
      } catch (error) {
        console.error("[HistoryService] Failed to save history:", error);
      }
    }, 500);
  }

  private async saveHistoryImmediate(): Promise<void> {
    if (this.saveDebounceTimeout) {
      clearTimeout(this.saveDebounceTimeout);
      this.saveDebounceTimeout = null;
    }

    try {
      await fs.writeFile(
        this.historyFilePath,
        JSON.stringify(this.historyData, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("[HistoryService] Failed to save history:", error);
    }
  }

  /**
   * Convert Float32Array audio data to WAV format
   */
  private createWavBuffer(audioData: Float32Array, sampleRate: number = 16000): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = audioData.length * (bitsPerSample / 8);
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Write audio samples
    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      const intSample = Math.round(sample * 32767);
      buffer.writeInt16LE(intSample, offset);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Calculate audio duration from Float32Array
   */
  private calculateDuration(audioData: Float32Array, sampleRate: number = 16000): number {
    return audioData.length / sampleRate;
  }

  /**
   * Add a new recording to history
   */
  async addRecording(
    audioData: Float32Array,
    rawTranscription: string,
    transformedTranscription: string | null,
    pluginUsed: string | null = null
  ): Promise<RecordingEntry | null> {
    if (!this.historyData.settings.enabled) {
      return null;
    }

    try {
      const id = uuidv4();
      const timestamp = Date.now();
      const audioFileName = `${id}.wav`;
      const audioPath = join(this.recordingsDir, audioFileName);
      const duration = this.calculateDuration(audioData);

      // Save audio file
      const wavBuffer = this.createWavBuffer(audioData);
      await fs.writeFile(audioPath, wavBuffer);

      const entry: RecordingEntry = {
        id,
        timestamp,
        audioPath,
        rawTranscription: rawTranscription.trim(),
        transformedTranscription: transformedTranscription?.trim() || null,
        duration,
        pluginUsed,
      };

      // Add to beginning of array (most recent first)
      this.historyData.recordings.unshift(entry);

      // Cleanup old recordings if over limit
      await this.enforceLimit();

      // Save history
      await this.saveHistory();

      this.emit("recording-added", entry);
      console.log(`[HistoryService] Added recording ${id}, duration: ${duration.toFixed(2)}s`);

      return entry;
    } catch (error) {
      console.error("[HistoryService] Failed to add recording:", error);
      return null;
    }
  }

  /**
   * Enforce the max recordings limit
   */
  private async enforceLimit(): Promise<void> {
    const limit = this.historyData.settings.maxRecordings;

    while (this.historyData.recordings.length > limit) {
      const oldest = this.historyData.recordings.pop();
      if (oldest) {
        try {
          await fs.unlink(oldest.audioPath);
          console.log(`[HistoryService] Removed old recording: ${oldest.id}`);
        } catch (error) {
          // File might already be deleted, ignore
        }
      }
    }
  }

  /**
   * Get all recordings
   */
  getRecordings(): RecordingEntry[] {
    return [...this.historyData.recordings];
  }

  /**
   * Get a specific recording by ID
   */
  getRecording(id: string): RecordingEntry | null {
    return this.historyData.recordings.find((r) => r.id === id) || null;
  }

  /**
   * Get the most recent recording
   */
  getLatestRecording(): RecordingEntry | null {
    return this.historyData.recordings[0] || null;
  }

  /**
   * Delete a specific recording
   */
  async deleteRecording(id: string): Promise<boolean> {
    const index = this.historyData.recordings.findIndex((r) => r.id === id);

    if (index === -1) {
      return false;
    }

    const recording = this.historyData.recordings[index];

    // Delete audio file
    try {
      await fs.unlink(recording.audioPath);
    } catch (error) {
      // File might already be deleted, continue
    }

    // Remove from array
    this.historyData.recordings.splice(index, 1);

    // Save history
    await this.saveHistory();

    this.emit("recording-deleted", id);
    console.log(`[HistoryService] Deleted recording: ${id}`);

    return true;
  }

  /**
   * Delete all recordings
   */
  async deleteAllRecordings(): Promise<number> {
    const count = this.historyData.recordings.length;

    // Delete all audio files
    for (const recording of this.historyData.recordings) {
      try {
        await fs.unlink(recording.audioPath);
      } catch (error) {
        // File might already be deleted, continue
      }
    }

    // Clear array
    this.historyData.recordings = [];

    // Save history
    await this.saveHistoryImmediate();

    this.emit("all-recordings-deleted");
    console.log(`[HistoryService] Deleted all ${count} recordings`);

    return count;
  }

  /**
   * Get the audio file path for a recording
   */
  getAudioPath(id: string): string | null {
    const recording = this.getRecording(id);
    return recording?.audioPath || null;
  }

  /**
   * Check if an audio file exists
   */
  async audioExists(id: string): Promise<boolean> {
    const path = this.getAudioPath(id);
    if (!path) return false;

    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get history settings
   */
  getSettings(): HistorySettings {
    return { ...this.historyData.settings };
  }

  /**
   * Update history settings
   */
  async updateSettings(settings: Partial<HistorySettings>): Promise<HistorySettings> {
    const prevMaxRecordings = this.historyData.settings.maxRecordings;

    this.historyData.settings = {
      ...this.historyData.settings,
      ...settings,
    };

    // If max recordings decreased, enforce the new limit
    if (settings.maxRecordings !== undefined && settings.maxRecordings < prevMaxRecordings) {
      await this.enforceLimit();
    }

    await this.saveHistory();

    this.emit("settings-updated", this.historyData.settings);

    return this.historyData.settings;
  }

  /**
   * Get total storage used by recordings
   */
  async getStorageUsed(): Promise<number> {
    let totalBytes = 0;

    for (const recording of this.historyData.recordings) {
      try {
        const stats = await fs.stat(recording.audioPath);
        totalBytes += stats.size;
      } catch {
        // File might not exist
      }
    }

    return totalBytes;
  }

  /**
   * Get history statistics
   */
  async getStats(): Promise<{
    totalRecordings: number;
    totalDuration: number;
    storageUsed: number;
    oldestRecording: number | null;
    newestRecording: number | null;
  }> {
    const recordings = this.historyData.recordings;
    const totalDuration = recordings.reduce((sum, r) => sum + r.duration, 0);
    const storageUsed = await this.getStorageUsed();

    return {
      totalRecordings: recordings.length,
      totalDuration,
      storageUsed,
      oldestRecording: recordings.length > 0 ? recordings[recordings.length - 1].timestamp : null,
      newestRecording: recordings.length > 0 ? recordings[0].timestamp : null,
    };
  }

  /**
   * Update the transformed transcription for a recording
   */
  async updateTransformedTranscription(id: string, transformedText: string): Promise<boolean> {
    const recording = this.getRecording(id);
    if (!recording) return false;

    recording.transformedTranscription = transformedText.trim();
    await this.saveHistory();

    this.emit("recording-updated", recording);
    return true;
  }

  /**
   * Cleanup service resources
   */
  async cleanup(): Promise<void> {
    if (this.saveDebounceTimeout) {
      clearTimeout(this.saveDebounceTimeout);
      await this.saveHistoryImmediate();
    }
  }
}
