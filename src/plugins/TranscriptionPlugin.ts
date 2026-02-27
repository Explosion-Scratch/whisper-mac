import { EventEmitter } from "events";
import { SegmentUpdate } from "../types/SegmentTypes";
import { SecureStorageService } from "../services/SecureStorageService";
import { FileSystemService } from "../services/FileSystemService";
import { WavProcessor } from "../helpers/WavProcessor";
import { spawn } from "child_process";
import * as https from "https";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  unlinkSync,
  statSync,
  createWriteStream,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

export interface PluginSchemaItem {
  key: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "select"
    | "model-select"
    | "textarea"
    | "api-key";
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
  /** Conditional visibility - only show this field when another field has a specific value */
  dependsOn?: {
    key: string;
    value: any;
    /** If true, show when value does NOT match */
    negate?: boolean;
  };
  /** Dynamic description based on another field's value */
  conditionalDescription?: {
    condition: {
      key: string;
      value: any;
    };
    description: string;
  };
  /** Secure storage key for api-key type fields */
  secureStorageKey?: string;
}

export interface PluginActivationCriteria {
  runOnAll?: boolean;
  skipTransformation?: boolean;
  skipAllTransforms?: boolean;
  /** When true, this plugin's settings override AI transformation settings */
  overridesTransformationSettings?: boolean;
}

/**
 * Metadata about how an AI plugin handles transcription and transformation
 */
export interface AiPluginCapabilities {
  /** Whether this is an AI-powered transcription plugin */
  isAiPlugin: boolean;
  /** Whether the plugin supports combined transcription + transformation mode */
  supportsCombinedMode: boolean;
  /** Current processing mode if applicable */
  processingMode?: "transcription_only" | "transcription_and_transformation";
  /** Settings that should be read from transformation config when in combined mode */
  transformationSettingsKeys?: string[];
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

export interface PostProcessedTranscription {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface PluginHealthStatus {
  healthy: boolean;
  lastSuccessfulTranscription: number | null;
  errorCount: number;
  consecutiveErrors: number;
  lastError: string | null;
  uptime: number;
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
  protected schema: PluginSchemaItem[] = [];
  protected tempDir: string;

  protected activationCriteria: PluginActivationCriteria = {};
  protected onTranscriptionCallback: ((update: SegmentUpdate) => void) | null =
    null;
  protected secureStorage: SecureStorageService;
  protected pluginManager: any = null;

  protected aiCapabilities: AiPluginCapabilities = {
    isAiPlugin: false,
    supportsCombinedMode: false,
  };

  protected lastTranscriptionAt: number | null = null;
  protected errorCount: number = 0;
  protected consecutiveErrors: number = 0;
  protected lastError: string | null = null;
  protected pluginStartTime: number = Date.now();

  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly supportsRealtime: boolean;
  abstract readonly supportsBatchProcessing: boolean;

  constructor() {
    super();
    this.secureStorage = new SecureStorageService();
    this.tempDir = mkdtempSync(join(tmpdir(), "plugin-"));
    this.schema = this.getSchema();
  }

  abstract isAvailable(): Promise<boolean>;
  abstract startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<void>;
  abstract processAudioSegment(audioData: Float32Array): Promise<void>;
  abstract transcribeFile(filePath: string): Promise<string>;
  finalizeBufferedAudio?(): Promise<void>;
  abstract stopTranscription(): Promise<void>;
  abstract cleanup(): Promise<void>;
  abstract getSchema(): PluginSchemaItem[];

  getSchemaItems(): PluginSchemaItem[] {
    return [...this.schema];
  }

  getOptions(): Record<string, any> {
    return { ...this.options };
  }

  setOptions(options: Record<string, any>): void {
    this.options = { ...options };
  }

  async validateOptions(
    options: Record<string, any>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    this.setActive(true);
  }

  async initialize(): Promise<void> {
    this.setInitialized(true);
  }

  async destroy(): Promise<void> {
    await this.stopTranscription();
    this.setInitialized(false);
    this.setActive(false);
  }

  async onDeactivate(): Promise<void> {
    this.setActive(false);
  }

  async getDataSize(): Promise<number> {
    try {
      const items = await this.listData();
      return items ? items.reduce((total, item) => total + (item.size || 0), 0) : 0;
    } catch {
      return 0;
    }
  }

  getDataPath(): string {
    return this.tempDir;
  }

  async listData(): Promise<
    Array<{ name: string; description: string; size: number; id: string }>
  > {
    const items: Array<{ name: string; description: string; size: number; id: string }> = [];
    try {
      if (existsSync(this.tempDir)) {
        for (const file of readdirSync(this.tempDir)) {
          try {
            const s = statSync(join(this.tempDir, file));
            items.push({ name: file, description: "Temporary file", size: s.size, id: `temp:${file}` });
          } catch {}
        }
      }
      for (const key of await this.listSecureKeys()) {
        items.push({ name: key, description: "Secure storage item", size: 0, id: `secure:${key}` });
      }
    } catch {}
    return items;
  }

  async deleteDataItem(id: string): Promise<void> {
    const [type, identifier] = id.split(":", 2);
    if (type === "temp") {
      const p = join(this.tempDir, identifier);
      if (existsSync(p)) unlinkSync(p);
    } else if (type === "secure") {
      await this.deleteSecureValue(identifier);
    }
  }

  async deleteAllData(): Promise<void> {
    if (existsSync(this.tempDir)) {
      for (const file of readdirSync(this.tempDir)) {
        try { unlinkSync(join(this.tempDir, file)); } catch {}
      }
    }
    await this.clearSecureData();
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    this.setOptions(options);
  }

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {}

  async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    return true;
  }

  protected async saveAudioAsWav(
    audioData: Float32Array,
    opts?: { sampleRate?: number; numChannels?: number; bitsPerSample?: number },
  ): Promise<string> {
    return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
      sampleRate: opts?.sampleRate ?? 16000,
      numChannels: opts?.numChannels ?? 1,
      bitsPerSample: opts?.bitsPerSample ?? 16,
    });
  }

  protected clearTempDir(): void {
    try {
      if (existsSync(this.tempDir)) {
        for (const file of readdirSync(this.tempDir)) {
          try { unlinkSync(join(this.tempDir, file)); } catch {}
        }
      }
    } catch {}
  }

  protected async downloadFileWithProgress(
    url: string,
    destPath: string,
    label: string,
    onProgress?: (percent: number) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (abortSignal?.aborted) {
        const e = new Error("Download aborted"); e.name = "AbortError"; reject(e); return;
      }
      let aborted = false;
      let req: any, res: any, fstream: any;

      const cleanup = () => {
        res?.destroy(); fstream?.destroy(); req?.destroy();
        try { if (existsSync(destPath)) unlinkSync(destPath); } catch {}
      };
      const onAbort = () => {
        if (aborted) return; aborted = true; cleanup();
        const e = new Error("Download aborted"); e.name = "AbortError"; reject(e);
      };
      abortSignal?.addEventListener("abort", onAbort, { once: true });

      req = https.get(url, (response) => {
        res = response;
        if (aborted) { cleanup(); return; }
        if (response.statusCode === 301 || response.statusCode === 302) {
          const loc = response.headers.location;
          if (loc) { this.downloadFileWithProgress(loc, destPath, label, onProgress, abortSignal).then(resolve).catch(reject); }
          else { abortSignal?.removeEventListener("abort", onAbort); reject(new Error("Redirect without location")); }
          return;
        }
        if (response.statusCode !== 200) {
          abortSignal?.removeEventListener("abort", onAbort);
          reject(new Error(`HTTP ${response.statusCode}`)); return;
        }
        const total = parseInt(response.headers["content-length"] || "0", 10);
        let downloaded = 0;
        fstream = createWriteStream(destPath);
        response.on("data", (chunk: Buffer) => {
          if (aborted) return;
          downloaded += chunk.length;
          onProgress?.(total > 0 ? Math.round((downloaded / total) * 100) : 0);
        });
        response.pipe(fstream);
        fstream.on("finish", () => {
          if (aborted) return; abortSignal?.removeEventListener("abort", onAbort);
          onProgress?.(100); resolve();
        });
        fstream.on("error", (e: Error) => {
          if (aborted) return; abortSignal?.removeEventListener("abort", onAbort); reject(e);
        });
        response.on("error", (e: Error) => {
          if (aborted) return; abortSignal?.removeEventListener("abort", onAbort); reject(e);
        });
      });
      req.on("error", (e: Error) => {
        if (aborted) return; abortSignal?.removeEventListener("abort", onAbort); reject(e);
      });
    });
  }

  protected async extractZip(zipPath: string, extractDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("unzip", ["-o", zipPath, "-d", extractDir], { stdio: "inherit" });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Extraction failed (code ${code})`)));
      child.on("error", (e) => reject(new Error(`Extraction failed: ${e.message}`)));
    });
  }

  /** Plugins can override to declare activation criteria */
  getActivationCriteria(): PluginActivationCriteria {
    return { ...this.activationCriteria };
  }
  setActivationCriteria(criteria: PluginActivationCriteria) {
    this.activationCriteria = { ...criteria };
  }

  /**
   * Get AI plugin capabilities
   * Override in AI plugins to declare capabilities
   */
  getAiCapabilities(): AiPluginCapabilities {
    return { ...this.aiCapabilities };
  }

  /**
   * Set AI plugin capabilities
   */
  protected setAiCapabilities(
    capabilities: Partial<AiPluginCapabilities>,
  ): void {
    this.aiCapabilities = { ...this.aiCapabilities, ...capabilities };
  }

  /**
   * Check if this plugin currently overrides transformation settings
   * Returns true if this is an AI plugin in combined transcription+transformation mode
   */
  overridesTransformationSettings(): boolean {
    const caps = this.getAiCapabilities();
    return (
      caps.isAiPlugin &&
      caps.supportsCombinedMode &&
      caps.processingMode === "transcription_and_transformation"
    );
  }

  /**
   * Get the fallback chain for this plugin - plugins to try if this one fails.
   * If not overridden, returns empty array (no specific fallback preference).
   */
  getFallbackChain(): string[] {
    return [];
  }

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

  protected setRunning(running: boolean): void {
    this.isRunning = running;
  }

  protected setTranscriptionCallback(
    callback: ((update: SegmentUpdate) => void) | null,
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

  protected recordSuccess(): void {
    this.lastTranscriptionAt = Date.now();
    this.consecutiveErrors = 0;
  }

  protected recordError(error: Error): void {
    this.errorCount++;
    this.consecutiveErrors++;
    this.lastError = error.message;
    this.emit("error", error);
  }

  getHealthStatus(): PluginHealthStatus {
    const maxConsecutiveErrors = 5;
    return {
      healthy:
        this.consecutiveErrors < maxConsecutiveErrors && this.isInitialized,
      lastSuccessfulTranscription: this.lastTranscriptionAt,
      errorCount: this.errorCount,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
      uptime: Date.now() - this.pluginStartTime,
    };
  }

  resetHealthCounters(): void {
    this.errorCount = 0;
    this.consecutiveErrors = 0;
    this.lastError = null;
    this.pluginStartTime = Date.now();
  }

  // Plugin secure storage methods
  async setSecureValue(key: string, value: string): Promise<void> {
    await this.secureStorage.setSecureValue(this.name, key, value);
  }

  async getSecureValue(key: string): Promise<string | null> {
    return this.secureStorage.getSecureValue(this.name, key);
  }

  async deleteSecureValue(key: string): Promise<void> {
    await this.secureStorage.deleteSecureValue(this.name, key);
  }

  async setSecureData(key: string, data: any): Promise<void> {
    await this.secureStorage.setSecureData(this.name, key, data);
  }

  async getSecureData(key: string): Promise<any | null> {
    return this.secureStorage.getSecureData(this.name, key);
  }

  async listSecureKeys(): Promise<string[]> {
    return this.secureStorage.listSecureKeys(this.name);
  }

  async clearSecureData(): Promise<void> {
    await this.secureStorage.clearPluginData(this.name);
  }

  /**
   * Set the plugin manager reference (called by the manager)
   */
  setPluginManager(manager: any): void {
    this.pluginManager = manager;
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
    } = {},
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
        // Remove stuttering artifacts: repeated single letters/characters with spaces
        // e.g., "s s s s s s" or "e e e e e"
        // Pattern: 3 or more occurrences of the same single character separated by spaces
        .replace(/\b([\w])(?: \1){2,}\b/gi, "")
        // Clean up any double spaces left after removal
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  /**
   * Update segment with post-processed data
   */
  protected updateSegmentWithPostProcessedData(
    segment: any,
    postProcessed: PostProcessedTranscription,
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
