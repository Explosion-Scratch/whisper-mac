import { spawn, ChildProcess } from "child_process";
import {
  unlinkSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  createWriteStream,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir, arch, platform } from "os";
import { v4 as uuidv4 } from "uuid";
import * as https from "https";
import { AppConfig } from "../config/AppConfig";
import { FileSystemService } from "../services/FileSystemService";
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
import { readPrompt } from "../helpers/getPrompt";
import { WavProcessor } from "../helpers/WavProcessor";

/**
 * Whisper.cpp transcription plugin
 */
export class WhisperCppTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "whisper-cpp";
  readonly displayName = "Whisper.cpp";
  readonly version = "1.7.6";
  readonly description =
    "High-performance C++ implementation of OpenAI Whisper for local transcription";
  readonly supportsRealtime = true;
  readonly supportsBatchProcessing = true;

  private config: AppConfig;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];
  private tempDir: string;
  private whisperBinaryPath: string;
  private modelPath: string = "";
  private isAppleSilicon: boolean;
  private resolvedBinaryPath: string;
  private warmupTimer: NodeJS.Timeout | null = null;
  private isWarmupRunning = false;
  private isWindowVisible = false;
  private isCurrentlyTranscribing = false;
  private useCoreML = false;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "whisper-cpp-plugin-"));
    this.isAppleSilicon = arch() === "arm64" && platform() === "darwin";
    this.whisperBinaryPath = this.resolveWhisperBinaryPath(); // Keep for backward compatibility
    // Don't set modelPath here - wait for options to be applied
    this.resolvedBinaryPath = this.getBinaryPath(true); // Resolve once and store
    this.setActivationCriteria({ runOnAll: false, skipTransformation: false });

    // Load Core ML setting from options with fallback to old config
    this.useCoreML = false; // Will be set properly when options are loaded

    // Initialize schema
    this.schema = this.getSchema();
  }

  /**
   * Define fallback chain for Whisper.cpp plugin
   * Prefer offline plugins: Vosk first, then YAP as lightweight fallback
   */
  getFallbackChain(): string[] {
    return ["vosk", "yap"];
  }

  private resolveWhisperBinaryPath(): string {
    // On Apple Silicon, prefer Metal version if available
    if (this.isAppleSilicon) {
      // Try production bundled Metal path first
      const packagedMetalPath = join(
        process.resourcesPath,
        "whisper-cpp",
        "whisper-cli-metal",
      );
      if (existsSync(packagedMetalPath)) {
        return packagedMetalPath;
      }

      // Fall back to development vendor Metal path
      const devMetalPath = join(
        process.cwd(),
        "vendor",
        "whisper-cpp",
        "whisper-cli-metal",
      );
      if (existsSync(devMetalPath)) {
        return devMetalPath;
      }
    }

    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "whisper-cpp",
      "whisper-cli",
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(process.cwd(), "vendor", "whisper-cpp", "whisper-cli");
    if (existsSync(devPath)) {
      return devPath;
    }

    // Fall back to system whisper-cli (if installed)
    return "whisper-cli";
  }

  private resolveModelPath(): string {
    // Get model from plugin options with fallback to default
    const modelName = this.options.model || "ggml-base.en.bin";

    // Models are now stored directly as files in the models directory
    const userModelPath = join(this.config.getModelsDir(), modelName);
    if (existsSync(userModelPath)) {
      return userModelPath;
    }

    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "whisper-cpp",
      "models",
      modelName,
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(
      process.cwd(),
      "vendor",
      "whisper-cpp",
      "models",
      modelName,
    );
    if (existsSync(devPath)) {
      return devPath;
    }

    // Return expected path for download
    return userModelPath;
  }

  async isBinaryAvailable(): Promise<boolean> {
    try {
      // Check if whisper binary exists and is executable
      return new Promise((resolve) => {
        const whisperProcess = spawn(this.resolvedBinaryPath, ["--help"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        console.log(
          "Whisper.cpp binary check started",
          this.resolvedBinaryPath,
        );

        let hasOutput = false;
        whisperProcess.stdout?.on("data", (data) => {
          console.log("Whisper.cpp data: ", data.toString());
          hasOutput = true;
          resolve(true);
        });
        whisperProcess.stderr?.on("data", (data) => {
          hasOutput = true;
          resolve(true);
        });

        whisperProcess.on("close", (code) => {
          console.log("Whisper.cpp binary check closed with code:", {
            code,
            hasOutput,
          });
          resolve(code === 0); // Some versions return 1 for --help
        });

        whisperProcess.on("error", (error) => {
          console.log("Whisper.cpp binary check failed:", error.message);
          resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!whisperProcess.killed) {
            console.log("Whisper.cpp binary check timed out");
            whisperProcess.kill();
            resolve(false);
          }
        }, 5000);
      });
    } catch (error) {
      console.error("Whisper.cpp binary availability check failed:", error);
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return await this.isBinaryAvailable();
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<void> {
    if (this.isRunning) {
      onLog?.("[Whisper.cpp Plugin] Service already running");
      onProgress?.({ status: "complete", message: "Whisper.cpp plugin ready" });
      return;
    }

    try {
      // Model path should already be set by the unified plugin system
      // Don't override it here

      onProgress?.({
        status: "starting",
        message: "Initializing Whisper.cpp plugin",
      });

      // Log which binary and Core ML model will be used
      const modelName = this.options.model || "ggml-base.en.bin";
      const coreMLPath = this.getCoreMLModelPath(modelName);

      if (this.isAppleSilicon) {
        if (coreMLPath) {
          onLog?.("[Whisper.cpp Plugin] Apple Metal acceleration enabled");
        } else {
          console.log("Core ML model not found, using regular binary");
          onLog?.(
            "[Whisper.cpp Plugin] Apple Metal acceleration not available",
          );
        }
      }

      this.setTranscriptionCallback(onUpdate);
      this.sessionUid = uuidv4();
      this.currentSegments = [];
      this.setRunning(true);

      onProgress?.({ status: "complete", message: "Whisper.cpp plugin ready" });
      onLog?.(
        "[Whisper.cpp Plugin] Service initialized and ready for audio segments",
      );
    } catch (error: any) {
      console.error("Failed to start Whisper.cpp plugin:", error);
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
      return;
    }

    try {
      this.isCurrentlyTranscribing = true;
      console.log(`Processing audio segment: ${audioData.length} samples`);

      // Create temporary WAV file for whisper.cpp
      const tempAudioPath = await this.saveAudioAsWav(audioData);

      // Show in-progress transcription
      const inProgressSegment: InProgressSegment = {
        id: uuidv4(),
        type: "inprogress",
        text: "Transcribing...",
        timestamp: Date.now(),
      };

      this.currentSegments = [inProgressSegment];
      this.onTranscriptionCallback({
        segments: [...this.currentSegments],
        sessionUid: this.sessionUid,
      });

      // Transcribe with whisper.cpp
      const rawTranscription = await this.transcribeWithWhisperCpp(
        tempAudioPath,
      );

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
        confidence: postProcessed.confidence ?? 0.95, // Whisper.cpp generally has good confidence
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
    } finally {
      this.isCurrentlyTranscribing = false;
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    const rawTranscription = await this.transcribeWithWhisperCpp(filePath);
    const postProcessed = this.postProcessTranscription(rawTranscription, {
      parseTimestamps: true,
      cleanText: true,
      extractConfidence: false,
    });
    return postProcessed.text;
  }

  async stopTranscription(): Promise<void> {
    console.log("=== Stopping Whisper.cpp transcription plugin ===");

    this.setRunning(false);
    this.setTranscriptionCallback(null);
    this.currentSegments = [];
    this.isCurrentlyTranscribing = false;

    console.log("Whisper.cpp transcription plugin stopped");
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
    const schema: TranscriptionPluginConfigSchema = {
      model: {
        type: "select",
        label: "Model",
        description: "Whisper model to use for transcription",
        default: "ggml-base.en.bin",
        options: [
          "ggml-tiny.bin",
          "ggml-tiny-q5_1.bin",
          "ggml-tiny-q8_0.bin",
          "ggml-tiny.en.bin",
          "ggml-tiny.en-q5_1.bin",
          "ggml-tiny.en-q8_0.bin",
          "ggml-base.bin",
          "ggml-base-q5_1.bin",
          "ggml-base-q8_0.bin",
          "ggml-base.en.bin",
          "ggml-base.en-q5_1.bin",
          "ggml-base.en-q8_0.bin",
          "ggml-small.bin",
          "ggml-small-q5_1.bin",
          "ggml-small-q8_0.bin",
          "ggml-small.en.bin",
          "ggml-small.en-q5_1.bin",
          "ggml-small.en-q8_0.bin",
          "ggml-medium.bin",
          "ggml-medium-q5_0.bin",
          "ggml-medium-q8_0.bin",
          "ggml-medium.en.bin",
          "ggml-medium.en-q5_0.bin",
          "ggml-medium.en-q8_0.bin",
          "ggml-large-v2.bin",
          "ggml-large-v2-q5_0.bin",
          "ggml-large-v2-q8_0.bin",
          "ggml-large-v3.bin",
          "ggml-large-v3-q5_0.bin",
          "ggml-large-v3-turbo.bin",
          "ggml-large-v3-turbo-q5_0.bin",
          "ggml-large-v3-turbo-q8_0.bin",
        ],
      },
      language: {
        type: "select",
        label: "Language",
        description: "Language for transcription",
        default: "auto",
        options: [
          "auto",
          "en",
          "es",
          "fr",
          "de",
          "it",
          "pt",
          "zh",
          "ja",
          "ko",
          "ru",
          "ar",
          "hi",
        ],
      },
      threads: {
        type: "number",
        label: "Threads",
        description: "Number of threads to use for processing",
        default: 4,
        min: 1,
        max: 16,
      },
    };

    // Add Core ML option only on Apple Silicon
    if (this.isAppleSilicon) {
      schema.useCoreML = {
        type: "boolean",
        label: "Use Core ML Acceleration",
        description: "Use Apple Metal acceleration for faster transcription",
        default: false,
      };
    }

    return schema;
  }

  /**
   * Update the model path after model switch
   */
  updateModelPath(): void {
    this.modelPath = this.resolveModelPath();
    console.log(
      `WhisperCppTranscriptionPlugin: Updated model path to ${this.modelPath}`,
    );
  }

  /**
   * Download Core ML model for a given model name
   */
  async downloadCoreMLModel(modelName: string): Promise<string | null> {
    if (!this.isAppleSilicon) {
      console.log("Core ML models are only supported on Apple Silicon");
      return null;
    }

    // Strip quantization suffix if present (e.g., "ggml-base.en-q4_0.bin" -> "ggml-base.en")
    const baseModelName = modelName
      .replace(/-\w+\.bin$/, "")
      .replace(/\.bin$/, "");
    const coreMLModelName = `${baseModelName}-encoder.mlmodelc`;
    const coreMLZipName = `${coreMLModelName}.zip`;
    const coreMLUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${coreMLZipName}`;
    const localZipPath = join(this.config.getModelsDir(), coreMLZipName);
    const localModelPath = join(this.config.getModelsDir(), coreMLModelName);

    // Check if already exists
    if (existsSync(localModelPath)) {
      console.log(`Core ML model ${coreMLModelName} already exists`);
      return localModelPath;
    }

    try {
      console.log(`Downloading Core ML model: ${coreMLModelName}`);

      // Download using curl
      await this.downloadFile(coreMLUrl, localZipPath);

      // Extract the zip
      await this.extractZip(localZipPath, this.config.getModelsDir());

      // Clean up zip file
      unlinkSync(localZipPath);

      console.log(`Core ML model ${coreMLModelName} downloaded successfully`);
      return localModelPath;
    } catch (error) {
      console.warn(
        `Failed to download Core ML model ${coreMLModelName}: ${error}`,
      );
      return null;
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("curl", ["-L", "-o", destPath, url], {
        stdio: "inherit",
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Download failed with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Download failed: ${error.message}`));
      });
    });
  }

  private async downloadFileWithProgress(
    url: string,
    destPath: string,
    modelName: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFileWithProgress(
              redirectUrl,
              destPath,
              modelName,
              onProgress,
            )
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error("Redirect without location header"));
          }
          return;
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to download model: HTTP ${response.statusCode}`),
          );
          return;
        }

        const totalBytes = parseInt(
          response.headers["content-length"] || "0",
          10,
        );
        let downloadedBytes = 0;
        const fileStream = createWriteStream(destPath);

        response.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const percent =
            totalBytes > 0
              ? Math.round((downloadedBytes / totalBytes) * 100)
              : 0;
          onProgress?.(percent);
        });

        response.pipe(fileStream);

        fileStream.on("finish", () => {
          console.log(
            `Model ${modelName} downloaded successfully to ${destPath}`,
          );
          onProgress?.(100);
          resolve();
        });

        fileStream.on("error", (error) => {
          console.error(`File write error: ${error.message}`);
          reject(error);
        });

        response.on("error", (error: Error) => {
          console.error(`Download error: ${error.message}`);
          reject(error);
        });
      });

      request.on("error", (error) => {
        console.error(`Failed to start download: ${error.message}`);
        reject(error);
      });
    });
  }

  private async extractZip(zipPath: string, extractDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("unzip", ["-o", zipPath, "-d", extractDir], {
        stdio: "inherit",
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Extraction failed with code ${code}`));
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Extraction failed: ${error.message}`));
      });
    });
  }

  /**
   * Get the appropriate binary path for the current platform
   * @param preferMetal - Whether to prefer Metal version on Apple Silicon
   * @returns Path to the appropriate binary
   */
  getBinaryPath(preferMetal = true): string {
    if (this.isAppleSilicon && this.useCoreML) {
      // Try production bundled Metal path first
      const packagedMetalPath = join(
        process.resourcesPath,
        "whisper-cpp",
        "whisper-cli-metal",
      );
      if (existsSync(packagedMetalPath)) {
        return packagedMetalPath;
      }

      // Fall back to development vendor Metal path
      const devMetalPath = join(
        process.cwd(),
        "vendor",
        "whisper-cpp",
        "whisper-cli-metal",
      );
      if (existsSync(devMetalPath)) {
        return devMetalPath;
      }
    }

    // Fall back to regular binary
    return this.resolveWhisperBinaryPath();
  }

  /**
   * Check if Core ML model exists for a given model name
   * @param modelName - The model name to check
   * @returns Path to Core ML model if it exists, null otherwise
   */
  getCoreMLModelPath(modelName: string): string | null {
    if (!this.isAppleSilicon) {
      return null;
    }

    // Strip quantization suffix if present (e.g., "ggml-base.en-q4_0.bin" -> "ggml-base.en")
    const baseModelName = modelName
      .replace(/-\w+\.bin$/, "")
      .replace(/\.bin$/, "");
    const coreMLModelName = `${baseModelName}-encoder.mlmodelc`;
    const coreMLModelPath = join(this.config.getModelsDir(), coreMLModelName);

    return existsSync(coreMLModelPath) ? coreMLModelPath : null;
  }

  /**
   * Convert Float32Array audio data to WAV file for whisper.cpp
   */
  private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
      sampleRate: 16000, // Whisper expects 16kHz
      numChannels: 1,
      bitsPerSample: 16,
    });
  }

  /**
   * Transcribe audio file using whisper.cpp CLI
   */
  private async transcribeWithWhisperCpp(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "--file",
        audioPath,
        "--model",
        this.modelPath,
        "--output-txt",
      ];

      // Add whisper prompt
      const whisperPrompt = this.options.prompt;
      if (whisperPrompt && whisperPrompt.trim()) {
        args.push("--prompt", whisperPrompt.trim());
      }

      // Add configuration options
      const language = this.options.language || "auto";
      if (language && language !== "auto") {
        args.push("--language", language);
      }

      const threads = this.options.threads || 4;
      if (threads) {
        args.push("--threads", threads.toString());
      }

      console.log(
        `Running Whisper.cpp: ${this.resolvedBinaryPath} ${args.join(" ")}`,
      );

      const whisperProcess = spawn(this.resolvedBinaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      whisperProcess.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      whisperProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      whisperProcess.on("close", (code) => {
        if (code === 0) {
          // Try to read the output txt file
          const txtOutputPath = audioPath.replace(/\.[^/.]+$/, ".txt");
          try {
            const rawTranscription = readFileSync(txtOutputPath, "utf8").trim();
            unlinkSync(txtOutputPath); // Clean up output file

            console.log(
              `Whisper.cpp raw transcription from file: "${rawTranscription}"`,
            );
            resolve(rawTranscription || "[No speech detected]");
          } catch (fileError) {
            // If we can't read the file, try to get output from stdout
            const rawTranscription = stdout.trim();

            console.log(
              `Whisper.cpp raw transcription from stdout: "${rawTranscription}"`,
            );
            resolve(rawTranscription || "[No speech detected]");
          }
        } else {
          const error = new Error(
            `Whisper.cpp failed with code ${code}: ${stderr}`,
          );
          console.error("Whisper.cpp error:", error.message);
          reject(error);
        }
      });

      whisperProcess.on("error", (error) => {
        console.error("Whisper.cpp spawn error:", error);
        reject(error);
      });

      // Set timeout to prevent hanging (3 minutes)
      setTimeout(() => {
        if (!whisperProcess.killed) {
          console.error("Whisper.cpp transcription timeout after 3 minutes");
          whisperProcess.kill();
          reject(new Error("Whisper.cpp transcription timeout"));
        }
      }, 180000); // 3 minute timeout
    });
  }

  // New unified plugin system methods
  getSchema(): PluginSchemaItem[] {
    const whisperModels = [
      {
        value: "ggml-tiny.bin",
        label: "Tiny",
        description: "Fastest, least accurate - multilingual",
        size: "77.7 MB",
      },
      {
        value: "ggml-tiny.en.bin",
        label: "Tiny English",
        description: "English only, fastest option",
        size: "77.7 MB",
      },
      {
        value: "ggml-tiny-q5_1.bin",
        label: "Tiny Quantized",
        description: "Smallest size, good quality",
        size: "32.2 MB",
      },
      {
        value: "ggml-tiny-q8_0.bin",
        label: "Tiny Q8",
        description: "Better quality than Q5_1",
        size: "43.5 MB",
      },
      {
        value: "ggml-base.bin",
        label: "Base",
        description: "Good balance of speed and accuracy",
        size: "148 MB",
      },
      {
        value: "ggml-base.en.bin",
        label: "Base English",
        description: "English only, recommended for most users",
        size: "148 MB",
      },
      {
        value: "ggml-base-q5_1.bin",
        label: "Base Quantized",
        description: "Compact with good quality",
        size: "59.7 MB",
      },
      {
        value: "ggml-base-q8_0.bin",
        label: "Base Q8",
        description: "Higher quality quantized",
        size: "81.8 MB",
      },
      {
        value: "ggml-small.bin",
        label: "Small",
        description: "Higher accuracy, slower",
        size: "488 MB",
      },
      {
        value: "ggml-small.en.bin",
        label: "Small English",
        description: "English only, higher accuracy",
        size: "488 MB",
      },
      {
        value: "ggml-medium.bin",
        label: "Medium",
        description: "Very accurate, much slower",
        size: "1.53 GB",
      },
      {
        value: "ggml-medium.en.bin",
        label: "Medium English",
        description: "English only, very accurate",
        size: "1.53 GB",
      },
      {
        value: "ggml-large-v2.bin",
        label: "Large v2",
        description: "Excellent accuracy, very slow",
        size: "3.09 GB",
      },
      {
        value: "ggml-large-v3.bin",
        label: "Large v3",
        description: "Latest large model, best accuracy",
        size: "3.1 GB",
      },
      {
        value: "ggml-large-v3-turbo.bin",
        label: "Large v3 Turbo",
        description: "Fast large model, great balance",
        size: "1.62 GB",
      },
    ];

    const options: PluginSchemaItem[] = [
      {
        key: "model",
        type: "model-select",
        label: "Whisper Model",
        description: "Choose the Whisper model to use for transcription",
        default: "ggml-base.en.bin",
        category: "model",
        options: whisperModels,
        required: true,
      },
      {
        key: "language",
        type: "select",
        label: "Language",
        description:
          "Language for transcription (auto-detect if not specified)",
        default: "auto",
        category: "basic",
        options: [
          { value: "auto", label: "Auto-detect" },
          { value: "en", label: "English" },
          { value: "es", label: "Spanish" },
          { value: "fr", label: "French" },
          { value: "de", label: "German" },
          { value: "it", label: "Italian" },
          { value: "pt", label: "Portuguese" },
          { value: "ru", label: "Russian" },
          { value: "ja", label: "Japanese" },
          { value: "ko", label: "Korean" },
          { value: "zh", label: "Chinese" },
        ],
      },
      {
        key: "threads",
        type: "number",
        label: "Thread Count",
        description: "Number of threads to use for transcription",
        default: 4,
        min: 1,
        max: 16,
        category: "advanced",
      },
      {
        key: "prompt",
        type: "string",
        label: "Transcription Prompt",
        description: "Custom prompt to guide the transcription (optional)",
        default: readPrompt("whisper"),
        category: "advanced",
      },
    ];

    // Add Apple Metal option only on Apple Silicon
    if (this.isAppleSilicon) {
      options.push({
        key: "useCoreML",
        type: "boolean",
        label: "Use Apple Metal Acceleration",
        description:
          "Enable Apple Metal acceleration for faster transcription on Apple Silicon Macs",
        default: true,
        category: "advanced",
      });
    }

    return options;
  }

  async validateOptions(
    options: Record<string, any>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (options.model) {
      const validModels =
        this.getSchema()
          .find((opt) => opt.key === "model")
          ?.options?.map((opt) => opt.value) || [];
      if (!validModels.includes(options.model)) {
        errors.push(`Invalid model: ${options.model}`);
      }
    }

    if (options.threads !== undefined) {
      const threads = Number(options.threads);
      if (isNaN(threads) || threads < 1 || threads > 16) {
        errors.push("Thread count must be between 1 and 16");
      }
    }

    if (
      options.useCoreML !== undefined &&
      typeof options.useCoreML !== "boolean"
    ) {
      errors.push("Apple Metal acceleration must be true or false");
    }

    // Validate prompt option - no specific validation needed, just check it's a string
    if (options.prompt !== undefined && typeof options.prompt !== "string") {
      errors.push("Prompt must be a string");
    }

    return { valid: errors.length === 0, errors };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    this.setActive(true);

    try {
      // Initialize useCoreML from options
      this.useCoreML =
        this.options.useCoreML !== undefined ? this.options.useCoreML : false;
      this.resolvedBinaryPath = this.getBinaryPath(true);

      // Get model from stored options (unified plugin system), fallback to default
      const modelName =
        this.options.model ||
        this.getSchema().find((opt) => opt.key === "model")?.default ||
        "ggml-base.en.bin";
      const modelPath = join(this.config.getModelsDir(), modelName);

      if (!existsSync(modelPath)) {
        const error = `Model ${modelName} not found. Please download it first.`;
        this.setError(error);
        throw new Error(error);
      }

      // Update the model path with the correct model
      this.modelPath = modelPath;
      this.setError(null);
      console.log(`Whisper.cpp plugin activated with model: ${modelName}`);

      // Start warmup loop and run initial warmup
      this.startWarmupLoop();
      this.runWarmupIfIdle();
    } catch (error) {
      this.setActive(false);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    this.setLoadingState(true, "Initializing Whisper.cpp plugin...");

    try {
      // Only verify binary is available - don't check models here
      const available = await this.isBinaryAvailable();
      if (!available) {
        throw new Error("Whisper.cpp binary not found or not executable");
      }

      this.setInitialized(true);
      this.setLoadingState(false);
      console.log("Whisper.cpp plugin initialized successfully");
    } catch (error) {
      this.setError(`Whisper.cpp initialization failed: ${error}`);
      this.setLoadingState(false);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    console.log("Whisper.cpp plugin destroyed");
    this.setInitialized(false);
    this.setActive(false);
  }

  async onDeactivate(): Promise<void> {
    this.setActive(false);
    console.log("Whisper.cpp plugin deactivated");
    this.stopWarmupLoop();
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
      const modelsDir = this.config.getModelsDir();

      // List downloaded models
      if (existsSync(modelsDir)) {
        const files = readdirSync(modelsDir);
        for (const file of files) {
          const modelPath = join(modelsDir, file);
          try {
            if (file.endsWith(".bin")) {
              const stats = require("fs").statSync(modelPath);
              dataItems.push({
                name: file.replace(".bin", ""),
                description: `Whisper.cpp model file`,
                size: stats.size,
                id: `model:${file}`,
              });
            } else if (file.endsWith(".mlmodelc")) {
              const dirSize =
                FileSystemService.calculateDirectorySize(modelPath);
              dataItems.push({
                name: file,
                description: `Whisper.cpp CoreML model`,
                size: dirSize,
                id: `model:${file}`,
              });
            }
          } catch (error) {
            console.warn(`Failed to stat model file ${file}:`, error);
          }
        }
      }

      // List temp files
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
      console.warn("Failed to list Whisper.cpp plugin data:", error);
    }

    return dataItems;
  }

  async deleteDataItem(id: string): Promise<void> {
    const [type, identifier] = id.split(":", 2);

    try {
      switch (type) {
        case "model":
          const modelPath = join(this.config.getModelsDir(), identifier);
          if (existsSync(modelPath)) {
            const stats = require("fs").statSync(modelPath);
            if (stats.isDirectory()) {
              FileSystemService.deleteDirectory(modelPath);
              console.log(`Deleted model directory: ${identifier}`);
            } else {
              require("fs").unlinkSync(modelPath);
              console.log(`Deleted model file: ${identifier}`);
            }
          }
          break;

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

      // Clear downloaded models
      const modelsDir = this.config.getModelsDir();
      if (existsSync(modelsDir)) {
        const files = readdirSync(modelsDir);

        for (const file of files) {
          const filePath = join(modelsDir, file);

          try {
            const stats = require("fs").statSync(filePath);

            // Delete model files and Core ML models
            if (file.endsWith(".bin") || file.endsWith(".mlmodelc")) {
              if (stats.isDirectory()) {
                // Core ML models are directories
                FileSystemService.deleteDirectory(filePath);
              } else {
                require("fs").unlinkSync(filePath);
              }
              console.log(`Deleted Whisper model: ${file}`);
            }
          } catch (error) {
            console.warn(`Failed to delete model ${file}:`, error);
          }
        }
      }

      console.log("Whisper.cpp plugin: all data cleared");
    } catch (error) {
      console.error("Failed to clear all Whisper.cpp plugin data:", error);
      throw error;
    }
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    // Store previous model for change detection
    const previousModel = this.options.model;
    this.setOptions(options);

    // Handle Core ML setting changes
    if (
      options.useCoreML !== undefined &&
      options.useCoreML !== this.useCoreML
    ) {
      const modelName = this.options.model || "ggml-base.en.bin";

      if (options.useCoreML) {
        if (uiFunctions) {
          uiFunctions.showProgress(
            `Downloading Core ML model for ${modelName}...`,
            0,
          );
        }
        this.setLoadingState(
          true,
          `Downloading Core ML model for ${modelName}...`,
        );

        try {
          const coreMLPath = await this.downloadCoreMLModel(modelName);
          if (coreMLPath) {
            this.useCoreML = true;
            this.options.useCoreML = true;
            this.resolvedBinaryPath = this.getBinaryPath(true);

            if (uiFunctions) {
              uiFunctions.showSuccess(`Core ML model downloaded successfully`);
              uiFunctions.hideProgress();
            }
          } else {
            throw new Error("Failed to download Core ML model");
          }
        } catch (error) {
          const errorMsg = `Failed to download Core ML model: ${error}`;
          this.setError(errorMsg);
          this.setLoadingState(false);
          if (uiFunctions) {
            uiFunctions.showError(errorMsg);
            uiFunctions.hideProgress();
          }
        }
      } else {
        if (uiFunctions) {
          uiFunctions.showProgress("Removing Core ML models...", 0);
        }
        this.setLoadingState(true, "Removing Core ML models...");

        try {
          await this.deleteCoreMLModels();
          this.useCoreML = false;
          this.options.useCoreML = false;
          this.resolvedBinaryPath = this.getBinaryPath(true);

          if (uiFunctions) {
            uiFunctions.showSuccess("Core ML models removed successfully");
            uiFunctions.hideProgress();
          }
        } catch (error) {
          const errorMsg = `Failed to remove Core ML models: ${error}`;
          this.setError(errorMsg);
          this.setLoadingState(false);
          if (uiFunctions) {
            uiFunctions.showError(errorMsg);
            uiFunctions.hideProgress();
          }
        }
      }
    }

    // Handle model changes only when a new model is selected
    if (options.model && options.model !== previousModel) {
      if (uiFunctions) {
        uiFunctions.showProgress(`Switching to model ${options.model}...`, 0);
      }
      this.setLoadingState(true, `Switching to model ${options.model}...`);

      try {
        const modelPath = join(this.config.getModelsDir(), options.model);

        if (!existsSync(modelPath)) {
          const message = `Model ${options.model} not found, downloading...`;
          this.setLoadingState(true, message);
          if (uiFunctions) {
            uiFunctions.showProgress(message, 0);
          }

          await this.downloadModel(options.model, uiFunctions);

          if (existsSync(modelPath)) {
            this.modelPath = modelPath;
            this.setLoadingState(false);
            if (uiFunctions) {
              uiFunctions.showSuccess(
                `Downloaded and switched to model ${options.model}`,
              );
              uiFunctions.hideProgress();
            }
          } else {
            throw new Error(`Failed to download model ${options.model}`);
          }
        } else {
          this.modelPath = modelPath;
          this.setLoadingState(false);
          if (uiFunctions) {
            uiFunctions.showSuccess(`Switched to model ${options.model}`);
            uiFunctions.hideProgress();
          }
        }
      } catch (error) {
        const errorMsg = `Failed to switch model: ${error}`;
        this.setError(errorMsg);
        this.setLoadingState(false);
        if (uiFunctions) {
          uiFunctions.showError(errorMsg);
          uiFunctions.hideProgress();
        }
      }
    }

    // All configuration is now handled via options
    console.log("Whisper.cpp plugin options updated:", options);
  }

  onDictationWindowShow(): void {
    this.isWindowVisible = true;
  }

  onDictationWindowHide(): void {
    this.isWindowVisible = false;
  }

  private startWarmupLoop() {
    if (this.warmupTimer) return;
    this.warmupTimer = setInterval(() => {
      this.runWarmupIfIdle();
    }, 5000);
  }

  private stopWarmupLoop() {
    if (this.warmupTimer) {
      clearInterval(this.warmupTimer);
      this.warmupTimer = null;
    }
  }

  private async runWarmupIfIdle() {
    if (this.isWarmupRunning) return; // Don't start another warmup if one is already running
    if (!this.isPluginActive()) return;
    if (this.isCurrentlyTranscribing) return;
    if (this.isWindowVisible) return; // Don't run warmup during active dictation

    this.isWarmupRunning = true;
    try {
      // Warmup: Running dummy audio (log removed for production)

      // Run a tiny silent segment to keep binary/model hot
      // Bypass transcription state management and call whisper.cpp directly
      const dummy = new Float32Array(16000);
      const tempAudioPath = await this.saveAudioAsWav(dummy);

      try {
        await this.transcribeWithWhisperCpp(tempAudioPath);
        // Clean up temp file
        unlinkSync(tempAudioPath);
      } catch (e) {
        console.warn("Whisper.cpp warmup transcription failed:", e);
      }
    } catch (e) {
      console.warn("Whisper.cpp warmup failed:", e);
    } finally {
      this.isWarmupRunning = false;
    }
  }

  /**
   * Ensure model is available for onboarding/setup
   */
  public async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void,
  ): Promise<boolean> {
    const modelName =
      options.model ||
      this.getSchema().find((opt) => opt.key === "model")?.default ||
      "ggml-base.en.bin";
    onLog?.(`Ensuring Whisper.cpp model ${modelName} is available`);

    const modelPath = join(this.config.getModelsDir(), modelName);
    if (existsSync(modelPath)) {
      onLog?.(`Whisper.cpp model ${modelName} already available`);
      return true;
    }

    try {
      await this.downloadModel(modelName, {
        showProgress: (message: string, progress: number) => {
          onProgress?.({
            message,
            percent: progress,
            status: progress >= 100 ? "complete" : "downloading",
          });
        },
        showDownloadProgress: (downloadProgress: any) => {
          onProgress?.(downloadProgress);
        },
        hideProgress: () => {},
        showError: (error: string) => {
          onLog?.(`Error: ${error}`);
        },
        showSuccess: (message: string) => {
          onLog?.(message);
        },
        confirmAction: async (message: string) => true,
      });
      return true;
    } catch (error: any) {
      onLog?.(`Failed to download model ${modelName}: ${error.message}`);
      throw error;
    }
  }

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    this.setLoadingState(true, `Downloading ${modelName}...`);

    try {
      const downloadProgress = {
        status: "downloading" as const,
        progress: 0,
        message: `Starting download of ${modelName}...`,
        modelName,
      };

      this.setDownloadProgress(downloadProgress);
      if (uiFunctions) {
        uiFunctions.showDownloadProgress(downloadProgress);
      }

      // Download the main GGML model first
      const modelPath = join(this.config.getModelsDir(), modelName);
      const ggmlUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;

      if (!existsSync(modelPath)) {
        if (uiFunctions) {
          uiFunctions.showProgress(`Downloading ${modelName}...`, 10);
        }

        await this.downloadFileWithProgress(
          ggmlUrl,
          modelPath,
          modelName,
          (progress) => {
            const adjustedProgress = Math.min(Math.round(progress * 0.5), 50); // Use first 50% for main model
            uiFunctions?.showProgress(
              `Downloading ${modelName}... ${adjustedProgress}%`,
              adjustedProgress,
            );
            this.setDownloadProgress({
              status: "downloading",
              progress: adjustedProgress,
              message: `Downloading ${modelName}... ${adjustedProgress}%`,
              modelName,
            });
          },
        );

        if (uiFunctions) {
          uiFunctions.showProgress(`${modelName} downloaded successfully`, 50);
        }
      } else {
        if (uiFunctions) {
          uiFunctions.showProgress(`${modelName} already exists`, 50);
        }
      }

      // If on Apple Silicon, also download Core ML model
      if (this.isAppleSilicon) {
        if (uiFunctions) {
          uiFunctions.showProgress(
            `Downloading Core ML model for ${modelName}...`,
            60,
          );
        }

        try {
          const coreMLPath = await this.downloadCoreMLModel(modelName);
          if (coreMLPath) {
            console.log(`Core ML model downloaded: ${coreMLPath}`);
            if (uiFunctions) {
              uiFunctions.showProgress(
                `Core ML model downloaded successfully`,
                90,
              );
            }
          } else {
            console.warn(`Failed to download Core ML model for ${modelName}`);
            if (uiFunctions) {
              uiFunctions.showProgress(
                `Core ML model download failed, continuing with regular model`,
                90,
              );
            }
          }
        } catch (error) {
          console.warn(`Core ML model download error: ${error}`);
          if (uiFunctions) {
            uiFunctions.showProgress(
              `Core ML model download failed, continuing with regular model`,
              90,
            );
          }
        }
      }

      // Update model path after successful download
      this.modelPath = join(this.config.getModelsDir(), modelName);

      const finalProgress = {
        status: "complete" as const,
        progress: 100,
        message: `${modelName} download complete`,
        modelName,
      };

      this.setDownloadProgress(finalProgress);
      this.setLoadingState(false);

      if (uiFunctions) {
        uiFunctions.showProgress(`${modelName} ready`, 100);
        uiFunctions.hideProgress();
      }
    } catch (error) {
      const errorMsg = `Failed to download ${modelName}: ${error}`;
      this.setError(errorMsg);
      this.setLoadingState(false);
      if (uiFunctions) {
        uiFunctions.showError(errorMsg);
        uiFunctions.hideProgress();
      }
      throw error;
    }
  }

  /**
   * Delete all Core ML models
   */
  private async deleteCoreMLModels(): Promise<void> {
    if (!this.isAppleSilicon) {
      return;
    }

    try {
      const { readdirSync, unlinkSync, rmdirSync } = require("fs");
      const modelsDir = this.config.getModelsDir();
      const files = readdirSync(modelsDir);

      for (const file of files) {
        if (file.endsWith(".mlmodelc")) {
          const modelPath = join(modelsDir, file);
          try {
            // Remove the .mlmodelc directory
            const { rmSync } = require("fs");
            rmSync(modelPath, { recursive: true, force: true });
            console.log(`Deleted Core ML model: ${file}`);
          } catch (err) {
            console.warn(`Failed to delete Core ML model ${file}:`, err);
          }
        }
      }
    } catch (error) {
      console.warn("Failed to delete Core ML models:", error);
      throw error;
    }
  }
}
