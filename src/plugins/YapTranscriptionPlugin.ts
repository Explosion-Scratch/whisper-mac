import { spawn, ChildProcess } from "child_process";
import { unlinkSync, mkdtempSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import { AppConfig } from "../config/AppConfig";
import { FileSystemService } from "../services/FileSystemService";
import { WavProcessor } from "../helpers/WavProcessor";
import {
  Segment,
  TranscribedSegment,
  InProgressSegment,
  SegmentUpdate,
} from "../types/SegmentTypes";
import {
  BaseTranscriptionPlugin,
  TranscriptionSetupProgress,
  TranscriptionPluginConfigSchema,
  PluginSchemaItem,
  PluginUIFunctions,
} from "./TranscriptionPlugin";

/**
 * YAP transcription plugin using YAP CLI
 */
export class YapTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "yap";
  readonly displayName = "YAP (Apple Speech Framework)";
  readonly version = "1.0.3";
  readonly description =
    "On-device transcription using YAP CLI for transcription";
  readonly supportsRealtime = true;
  readonly supportsBatchProcessing = true;

  private config: AppConfig;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];
  private tempDir: string;
  private yapBinaryPath: string;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "yap-plugin-"));
    this.yapBinaryPath = this.resolveYapBinaryPath();
    // Declare default activation criteria
    this.setActivationCriteria({ runOnAll: true, skipTransformation: false });
    // Initialize schema
    this.schema = this.getSchema();
  }

  /**
   * YAP typically serves as a last resort fallback, so no fallback chain defined
   */
  getFallbackChain(): string[] {
    return [];
  }

  private resolveYapBinaryPath(): string {
    // Try production bundled path first
    const packagedPath = join(process.resourcesPath, "yap", "yap");
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(process.cwd(), "vendor", "yap", "yap");
    if (existsSync(devPath)) {
      return devPath;
    }

    // Fall back to system yap (if installed via Homebrew)
    return "yap";
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if YAP binary exists and is executable
      return new Promise((resolve) => {
        const yapProcess = spawn(this.yapBinaryPath, ["--help"], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        // Some versions print help to stderr or print nothing but still exit 0.
        // Consider exit code 0 as success (align with Whisper behavior).
        yapProcess.on("close", (code) => {
          resolve(code === 0);
        });

        yapProcess.on("error", () => {
          resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!yapProcess.killed) {
            yapProcess.kill();
            resolve(false);
          }
        }, 5000);
      });
    } catch (error) {
      console.error("YAP availability check failed:", error);
      return false;
    }
  }

  /**
   * YAP doesn't require model downloads, so this is a no-op that always succeeds
   */
  public async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void,
  ): Promise<boolean> {
    onLog?.("YAP plugin doesn't require model downloads");
    onProgress?.({
      status: "complete",
      message: "YAP ready",
      percent: 100,
    });
    return true;
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<void> {
    console.log("=== Starting YAP transcription plugin ===");

    if (this.isRunning) {
      onLog?.("[YAP Plugin] Service already running");
      onProgress?.({ status: "complete", message: "YAP plugin ready" });
      return;
    }

    try {
      onProgress?.({ status: "starting", message: "Initializing YAP plugin" });

      this.setTranscriptionCallback(onUpdate);
      this.sessionUid = uuidv4();
      this.currentSegments = [];
      this.setRunning(true);

      onProgress?.({ status: "complete", message: "YAP plugin ready" });
      onLog?.("[YAP Plugin] Service initialized and ready for audio segments");
    } catch (error: any) {
      console.error("Failed to start YAP plugin:", error);
      this.setRunning(false);
      onProgress?.({
        status: "error",
        message: `Failed to start plugin: ${error.message}`,
      });

      this.emit("error", error);
      throw error;
    }
  }

  async processAudioSegment(audioData: Float32Array): Promise<void> {
    if (!this.isRunning || !this.onTranscriptionCallback) {
      console.log("YAP plugin not running, ignoring audio segment");
      return;
    }

    try {
      console.log(`Processing audio segment: ${audioData.length} samples`);

      // Create temporary WAV file for YAP
      const tempAudioPath = await this.saveAudioAsWav(audioData);

      // Show in-progress transcription
      const inProgressSegment: InProgressSegment = {
        id: uuidv4(),
        type: "inprogress",
        text: "Transcribing...",
        timestamp: Date.now(),
      };

      this.currentSegments = [inProgressSegment];
      if (this.onTranscriptionCallback) {
        this.onTranscriptionCallback({
          segments: [...this.currentSegments],
          sessionUid: this.sessionUid,
        });
      }

      // Transcribe with YAP
      const rawTranscription = await this.transcribeWithYap(tempAudioPath);

      // Clean up temp file
      try {
        unlinkSync(tempAudioPath);
      } catch (err) {
        console.warn("Failed to delete temp audio file:", err);
      }

      // Use uniform post-processing API
      const postProcessed = this.postProcessTranscription(rawTranscription, {
        parseTimestamps: true,
        cleanText: true,
        extractConfidence: false,
      });

      // Create completed segment
      const completedSegment: TranscribedSegment = {
        id: uuidv4(),
        type: "transcribed",
        text: postProcessed.text,
        completed: true,
        timestamp: Date.now(),
        confidence: postProcessed.confidence ?? 0.9, // YAP doesn't provide confidence, use default
        start: postProcessed.start,
        end: postProcessed.end,
      };

      this.currentSegments = [completedSegment];
      if (this.onTranscriptionCallback) {
        this.onTranscriptionCallback({
          segments: [...this.currentSegments],
          sessionUid: this.sessionUid,
        });
      }
    } catch (error: any) {
      console.error("Failed to process audio segment:", error);

      const errorSegment: TranscribedSegment = {
        id: uuidv4(),
        type: "transcribed",
        text: "[Transcription failed]",
        completed: true,
        timestamp: Date.now(),
        confidence: 0,
      };

      this.currentSegments = [errorSegment];
      if (this.onTranscriptionCallback) {
        this.onTranscriptionCallback({
          segments: [...this.currentSegments],
          sessionUid: this.sessionUid,
        });
      }
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    const rawTranscription = await this.transcribeWithYap(filePath);
    const postProcessed = this.postProcessTranscription(rawTranscription, {
      parseTimestamps: true,
      cleanText: true,
      extractConfidence: false,
    });
    return postProcessed.text;
  }

  async stopTranscription(): Promise<void> {
    console.log("=== Stopping YAP transcription plugin ===");

    this.setRunning(false);
    this.setTranscriptionCallback(null);
    this.currentSegments = [];

    console.log("YAP transcription plugin stopped");
  }

  async cleanup(): Promise<void> {
    await this.stopTranscription();

    // Clean up temp directory
    try {
      const { readdirSync } = require("fs");
      const files = readdirSync(this.tempDir);
      for (const file of files) {
        unlinkSync(join(this.tempDir, file));
      }
    } catch (err) {
      console.warn("Failed to clean temp directory:", err);
    }
  }

  getConfigSchema(): TranscriptionPluginConfigSchema {
    return {
      locale: {
        type: "select",
        label: "Language",
        description: "Language for transcription",
        default: "en-US",
        options: [
          "current",
          "en-US",
          "en-GB",
          "es-ES",
          "fr-FR",
          "de-DE",
          "it-IT",
          "pt-BR",
          "zh-CN",
          "ja-JP",
          "ko-KR",
        ],
      },
      censor: {
        type: "boolean",
        label: "Censor Profanity",
        description: "Replaces certain words and phrases with a redacted form",
        default: false,
      },
    };
  }

  /**
   * Convert Float32Array audio data to WAV file for YAP
   */
  private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
      sampleRate: 16000, // VAD outputs at 16kHz
      numChannels: 1,
      bitsPerSample: 16,
    });
  }

  /**
   * Transcribe audio file using YAP CLI
   */
  private async transcribeWithYap(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["transcribe", audioPath, "--txt"];

      // Add configuration options from plugin options
      const locale = this.options.locale;
      if (locale && locale !== "current") {
        args.push("--locale", locale);
      }

      const censor = this.options.censor;
      if (censor) {
        args.push("--censor");
      }

      console.log(`Running YAP: ${this.yapBinaryPath} ${args.join(" ")}`);

      const yapProcess = spawn(this.yapBinaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      yapProcess.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      yapProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      yapProcess.on("close", (code) => {
        if (code === 0) {
          const rawTranscription = stdout.trim();
          console.log(`YAP raw transcription: "${rawTranscription}"`);
          resolve(rawTranscription || "[No speech detected]");
        } else {
          const error = new Error(`YAP failed with code ${code}: ${stderr}`);
          console.error("YAP error:", error.message);
          reject(error);
        }
      });

      yapProcess.on("error", (error) => {
        console.error("YAP spawn error:", error);
        reject(error);
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        if (!yapProcess.killed) {
          yapProcess.kill();
          reject(new Error("YAP transcription timeout"));
        }
      }, 30000); // 30 second timeout
    });
  }

  // New unified plugin system methods
  getSchema(): PluginSchemaItem[] {
    return [
      {
        key: "locale",
        type: "select" as const,
        label: "Language",
        description: "Language for transcription",
        default: "en-US",
        category: "basic" as const,
        options: [
          { value: "current", label: "System Language" },
          { value: "en-US", label: "English (US)" },
          { value: "en-GB", label: "English (UK)" },
          { value: "es-ES", label: "Spanish (Spain)" },
          { value: "fr-FR", label: "French (France)" },
          { value: "de-DE", label: "German (Germany)" },
          { value: "it-IT", label: "Italian (Italy)" },
          { value: "pt-BR", label: "Portuguese (Brazil)" },
          { value: "zh-CN", label: "Chinese (Simplified)" },
          { value: "ja-JP", label: "Japanese" },
          { value: "ko-KR", label: "Korean" },
        ],
        required: true,
      },
      {
        key: "censor",
        type: "boolean" as const,
        label: "Censor Profanity",
        description: "Replaces certain words and phrases with a redacted form",
        default: false,
        category: "advanced" as const,
      },
    ];
  }

  async validateOptions(
    options: Record<string, any>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (options.locale) {
      const validLocales =
        this.getSchema()
          .find((opt) => opt.key === "locale")
          ?.options?.map((opt) => opt.value) || [];
      if (!validLocales.includes(options.locale)) {
        errors.push(`Invalid locale: ${options.locale}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    this.setActive(true);

    try {
      // YAP doesn't require models - just verify it's available
      const available = await this.isAvailable();
      if (!available) {
        const error = "YAP binary not found or not executable";
        this.setError(error);
        throw new Error(error);
      }

      this.setError(null);
      console.log(`YAP plugin activated`);
    } catch (error) {
      this.setActive(false);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    this.setLoadingState(true, "Initializing YAP plugin...");

    try {
      // YAP doesn't need model loading - just basic setup
      this.setInitialized(true);
      this.setLoadingState(false);
      console.log("YAP plugin initialized successfully");
    } catch (error) {
      this.setError(`YAP initialization failed: ${error}`);
      this.setLoadingState(false);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    console.log("YAP plugin destroyed");
    this.setInitialized(false);
    this.setActive(false);
  }

  async onDeactivate(): Promise<void> {
    this.setActive(false);
    console.log("YAP plugin deactivated");
  }

  getDataPath(): string {
    return this.tempDir;
  }

  async listData(): Promise<
    Array<{ name: string; description: string; size: number; id: string }>
  > {
    const dataItems: Array<{
      name: string;
      description: string;
      size: number;
      id: string;
    }> = [];

    try {
      // List temp files (YAP doesn't store models locally)
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const tempFile of tempFiles) {
          const tempPath = join(this.tempDir, tempFile);
          try {
            const stats = require("fs").statSync(tempPath);
            dataItems.push({
              name: tempFile,
              description: `Temporary audio file`,
              size: stats.size,
              id: `temp:${tempFile}`,
            });
          } catch (error) {
            console.warn(`Failed to stat temp file ${tempFile}:`, error);
          }
        }
      }

      // List secure storage keys
      const secureKeys = await this.listSecureKeys();
      for (const key of secureKeys) {
        dataItems.push({
          name: key,
          description: `Secure storage item`,
          size: 0,
          id: `secure:${key}`,
        });
      }
    } catch (error) {
      console.warn("Failed to list YAP plugin data:", error);
    }

    return dataItems;
  }

  async deleteDataItem(id: string): Promise<void> {
    const [type, identifier] = id.split(":", 2);

    try {
      switch (type) {
        case "temp":
          const tempPath = join(this.tempDir, identifier);
          if (existsSync(tempPath)) {
            require("fs").unlinkSync(tempPath);
            console.log(`Deleted temp file: ${identifier}`);
          }
          break;

        case "secure":
          await this.deleteSecureValue(identifier);
          console.log(`Deleted secure data: ${identifier}`);
          break;

        default:
          throw new Error(`Unknown data type: ${type}`);
      }
    } catch (error) {
      console.error(`Failed to delete data item ${id}:`, error);
      throw error;
    }
  }

  async deleteAllData(): Promise<void> {
    try {
      // Clear temp files
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const file of tempFiles) {
          try {
            require("fs").unlinkSync(join(this.tempDir, file));
          } catch (error) {
            console.warn(`Failed to delete temp file ${file}:`, error);
          }
        }
      }

      // Clear secure storage
      await this.clearSecureData();

      console.log("YAP plugin: all data cleared");
    } catch (error) {
      console.error("Failed to clear all YAP plugin data:", error);
      throw error;
    }
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    this.setOptions(options);

    if (uiFunctions) {
      uiFunctions.showSuccess("YAP plugin options updated");
    }

    console.log("YAP plugin options updated:", options);
  }

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    // YAP doesn't use local models - it uses external APIs
    // This is a no-op implementation
    if (uiFunctions) {
      uiFunctions.showSuccess("YAP plugin doesn't require model downloads");
    }
    console.log("YAP plugin: downloadModel called but not needed");
  }
}
