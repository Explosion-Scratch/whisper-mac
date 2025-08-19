import { spawn, ChildProcess } from "child_process";
import { unlinkSync, mkdtempSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir, arch, platform } from "os";
import { v4 as uuidv4 } from "uuid";
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
  PluginOption,
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
  private modelPath: string;
  private isAppleSilicon: boolean;
  private resolvedBinaryPath: string;
  private warmupTimer: NodeJS.Timeout | null = null;
  private isWarmupRunning = false;
  private isWindowVisible = false;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "whisper-cpp-plugin-"));
    this.isAppleSilicon = arch() === "arm64" && platform() === "darwin";
    this.whisperBinaryPath = this.resolveWhisperBinaryPath(); // Keep for backward compatibility
    this.modelPath = this.resolveModelPath();
    this.resolvedBinaryPath = this.getBinaryPath(true); // Resolve once and store
  }

  private resolveWhisperBinaryPath(): string {
    // On Apple Silicon, prefer Metal version if available
    if (this.isAppleSilicon) {
      // Try production bundled Metal path first
      const packagedMetalPath = join(
        process.resourcesPath,
        "whisper-cpp",
        "whisper-cli-metal"
      );
      if (existsSync(packagedMetalPath)) {
        return packagedMetalPath;
      }

      // Fall back to development vendor Metal path
      const devMetalPath = join(
        process.cwd(),
        "vendor",
        "whisper-cpp",
        "whisper-cli-metal"
      );
      if (existsSync(devMetalPath)) {
        return devMetalPath;
      }
    }

    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "whisper-cpp",
      "whisper-cli"
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
    // Default to base.en model
    const modelName = this.config.get("whisperCppModel") || "ggml-base.en.bin";

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
      modelName
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
      modelName
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
          this.resolvedBinaryPath
        );

        let hasOutput = false;
        whisperProcess.stdout?.on("data", (data) => {
          console.log("Whisper.cpp data: ", data.toString());
          hasOutput = true;
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
    onLog?: (line: string) => void
  ): Promise<void> {
    console.log("=== Starting Whisper.cpp transcription plugin ===");

    if (this.isRunning) {
      onLog?.("[Whisper.cpp Plugin] Service already running");
      onProgress?.({ status: "complete", message: "Whisper.cpp plugin ready" });
      return;
    }

    try {
      // Refresh paths in case onboarding updated them
      this.modelPath = this.resolveModelPath();

      onProgress?.({
        status: "starting",
        message: "Initializing Whisper.cpp plugin",
      });

      // Log which binary and Core ML model will be used
      const modelName =
        this.config.get("whisperCppModel") || "ggml-base.en.bin";
      const coreMLPath = this.getCoreMLModelPath(modelName);

      console.log(`Whisper.cpp binary: ${this.resolvedBinaryPath}`);
      if (this.isAppleSilicon) {
        if (coreMLPath) {
          console.log(`Core ML model available: ${coreMLPath}`);
          onLog?.("[Whisper.cpp Plugin] Apple Metal acceleration enabled");
        } else {
          console.log("Core ML model not found, using regular binary");
          onLog?.(
            "[Whisper.cpp Plugin] Apple Metal acceleration not available"
          );
        }
      }

      this.setTranscriptionCallback(onUpdate);
      this.sessionUid = uuidv4();
      this.currentSegments = [];
      this.setRunning(true);

      onProgress?.({ status: "complete", message: "Whisper.cpp plugin ready" });
      onLog?.(
        "[Whisper.cpp Plugin] Service initialized and ready for audio segments"
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
      console.log("Whisper.cpp plugin not running, ignoring audio segment");
      return;
    }

    try {
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
        tempAudioPath
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
    return {
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
  }

  configure(config: Record<string, any>): void {
    if (config.model !== undefined) {
      this.config.set("whisperCppModel", config.model);
      this.modelPath = this.resolveModelPath();
    }
    if (config.language !== undefined) {
      this.config.set("whisperCppLanguage", config.language);
    }
    if (config.threads !== undefined) {
      this.config.set("whisperCppThreads", config.threads);
    }
  }

  /**
   * Update the model path after model switch
   */
  updateModelPath(): void {
    this.modelPath = this.resolveModelPath();
    console.log(
      `WhisperCppTranscriptionPlugin: Updated model path to ${this.modelPath}`
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
        `Failed to download Core ML model ${coreMLModelName}: ${error}`
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
    if (this.isAppleSilicon && preferMetal) {
      // Try production bundled Metal path first
      const packagedMetalPath = join(
        process.resourcesPath,
        "whisper-cpp",
        "whisper-cli-metal"
      );
      if (existsSync(packagedMetalPath)) {
        return packagedMetalPath;
      }

      // Fall back to development vendor Metal path
      const devMetalPath = join(
        process.cwd(),
        "vendor",
        "whisper-cpp",
        "whisper-cli-metal"
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
      try {
        const whisperPrompt = readPrompt("whisper");
        if (whisperPrompt.trim()) {
          args.push("--prompt", whisperPrompt.trim());
        }
      } catch (error) {
        console.warn("Failed to read whisper prompt:", error);
      }

      // Add configuration options
      const language = this.config.get("whisperCppLanguage");
      if (language && language !== "auto") {
        args.push("--language", language);
      }

      const threads = this.config.get("whisperCppThreads");
      if (threads) {
        args.push("--threads", threads.toString());
      }

      console.log(
        `Running Whisper.cpp: ${this.resolvedBinaryPath} ${args.join(" ")}`
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
              `Whisper.cpp raw transcription from file: "${rawTranscription}"`
            );
            resolve(rawTranscription || "[No speech detected]");
          } catch (fileError) {
            // If we can't read the file, try to get output from stdout
            const rawTranscription = stdout.trim();

            console.log(
              `Whisper.cpp raw transcription from stdout: "${rawTranscription}"`
            );
            resolve(rawTranscription || "[No speech detected]");
          }
        } else {
          const error = new Error(
            `Whisper.cpp failed with code ${code}: ${stderr}`
          );
          console.error("Whisper.cpp error:", error.message);
          reject(error);
        }
      });

      whisperProcess.on("error", (error) => {
        console.error("Whisper.cpp spawn error:", error);
        reject(error);
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        if (!whisperProcess.killed) {
          whisperProcess.kill();
          reject(new Error("Whisper.cpp transcription timeout"));
        }
      }, 60000); // 60 second timeout (whisper.cpp can be slower than YAP)
    });
  }

  // New unified plugin system methods
  getOptions() {
    const whisperModels = [
      {
        value: "ggml-tiny.bin",
        label: "Tiny (77.7 MB)",
        description: "Fastest, least accurate - multilingual",
        size: "77.7 MB",
      },
      {
        value: "ggml-tiny.en.bin",
        label: "Tiny English (77.7 MB)",
        description: "English only, fastest option",
        size: "77.7 MB",
      },
      {
        value: "ggml-tiny-q5_1.bin",
        label: "Tiny Quantized (32.2 MB)",
        description: "Smallest size, good quality",
        size: "32.2 MB",
      },
      {
        value: "ggml-tiny-q8_0.bin",
        label: "Tiny Q8 (43.5 MB)",
        description: "Better quality than Q5_1",
        size: "43.5 MB",
      },
      {
        value: "ggml-base.bin",
        label: "Base (148 MB)",
        description: "Good balance of speed and accuracy",
        size: "148 MB",
      },
      {
        value: "ggml-base.en.bin",
        label: "Base English (148 MB)",
        description: "English only, recommended for most users",
        size: "148 MB",
      },
      {
        value: "ggml-base-q5_1.bin",
        label: "Base Quantized (59.7 MB)",
        description: "Compact with good quality",
        size: "59.7 MB",
      },
      {
        value: "ggml-base-q8_0.bin",
        label: "Base Q8 (81.8 MB)",
        description: "Higher quality quantized",
        size: "81.8 MB",
      },
      {
        value: "ggml-small.bin",
        label: "Small (488 MB)",
        description: "Higher accuracy, slower",
        size: "488 MB",
      },
      {
        value: "ggml-small.en.bin",
        label: "Small English (488 MB)",
        description: "English only, higher accuracy",
        size: "488 MB",
      },
      {
        value: "ggml-medium.bin",
        label: "Medium (1.53 GB)",
        description: "Very accurate, much slower",
        size: "1.53 GB",
      },
      {
        value: "ggml-medium.en.bin",
        label: "Medium English (1.53 GB)",
        description: "English only, very accurate",
        size: "1.53 GB",
      },
      {
        value: "ggml-large-v2.bin",
        label: "Large v2 (3.09 GB)",
        description: "Excellent accuracy, very slow",
        size: "3.09 GB",
      },
      {
        value: "ggml-large-v3.bin",
        label: "Large v3 (3.1 GB)",
        description: "Latest large model, best accuracy",
        size: "3.1 GB",
      },
      {
        value: "ggml-large-v3-turbo.bin",
        label: "Large v3 Turbo (1.62 GB)",
        description: "Fast large model, great balance",
        size: "1.62 GB",
      },
    ];

    return [
      {
        key: "model",
        type: "model-select" as const,
        label: "Whisper Model",
        description: "Choose the Whisper model to use for transcription",
        default: "ggml-base.en.bin",
        category: "model" as const,
        options: whisperModels,
        required: true,
      },
      {
        key: "language",
        type: "select" as const,
        label: "Language",
        description:
          "Language for transcription (auto-detect if not specified)",
        default: "auto",
        category: "basic" as const,
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
        type: "number" as const,
        label: "Thread Count",
        description: "Number of threads to use for transcription",
        default: 4,
        min: 1,
        max: 16,
        category: "advanced" as const,
      },
    ];
  }

  async verifyOptions(
    options: Record<string, any>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (options.model) {
      const validModels =
        this.getOptions()
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

    return { valid: errors.length === 0, errors };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    this.setActive(true);

    try {
      // Check if model exists - this is required for activation
      const modelName =
        this.config.get("whisperCppModel") || "ggml-base.en.bin";
      const modelPath = join(this.config.getModelsDir(), modelName);

      if (!existsSync(modelPath)) {
        const error = `Model ${modelName} not found. Please download it first.`;
        this.setError(error);
        throw new Error(error);
      }

      this.setError(null);
      console.log(`Whisper.cpp plugin activated with model: ${modelName}`);
      this.startWarmupLoop();
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

  async clearData(): Promise<void> {
    // Clean temp files
    try {
      if (FileSystemService.deleteDirectory(this.tempDir)) {
        this.tempDir = mkdtempSync(join(tmpdir(), "whisper-cpp-plugin-"));
      }
      console.log("Whisper.cpp plugin data cleared");
    } catch (error) {
      console.warn("Failed to clear Whisper.cpp plugin data:", error);
    }
  }

  async getDataSize(): Promise<number> {
    try {
      let totalSize = 0;

      // Calculate temp directory size
      totalSize += FileSystemService.calculateDirectorySize(this.tempDir);

      // Calculate model file size if it exists
      totalSize += FileSystemService.calculateFileSize(this.modelPath);

      return totalSize;
    } catch (error) {
      console.warn("Failed to calculate Whisper.cpp plugin data size:", error);
      return 0;
    }
  }

  getDataPath(): string {
    return this.tempDir;
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions
  ): Promise<void> {
    this.setOptions(options);

    // Handle model changes
    if (options.model && options.model !== this.config.get("whisperCppModel")) {
      if (uiFunctions) {
        uiFunctions.showProgress(`Switching to model ${options.model}...`, 0);
      }
      this.setLoadingState(true, `Switching to model ${options.model}...`);

      try {
        // Update model path
        this.config.set("whisperCppModel", options.model);
        this.modelPath = this.resolveModelPath();

        // Check if new model exists
        if (!existsSync(this.modelPath)) {
          const message = `Model ${options.model} not found, may need to download...`;
          this.setLoadingState(true, message);
          if (uiFunctions) {
            uiFunctions.showError(message);
          }
        } else {
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

    // Apply other configuration changes
    this.configure(options);

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
    }, 10000);
  }

  private stopWarmupLoop() {
    if (this.warmupTimer) {
      clearInterval(this.warmupTimer);
      this.warmupTimer = null;
    }
  }

  private async runWarmupIfIdle() {
    if (this.isWarmupRunning) return;
    if (!this.isPluginActive()) return;
    if (this.isWindowVisible) return;
    if (this.isRunning) return;

    this.isWarmupRunning = true;
    try {
      // Run a tiny silent segment to keep binary/model hot
      const dummy = new Float32Array(16000);
      await this.startTranscription(() => {});
      await this.processAudioSegment(dummy);
      await this.stopTranscription();
    } catch (e) {
      // best-effort
    } finally {
      this.isWarmupRunning = false;
    }
  }

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions
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

      // Download the main model using existing system
      // This would integrate with the existing model download system
      // For now, just simulate the process

      // If on Apple Silicon, also download Core ML model
      if (this.isAppleSilicon) {
        if (uiFunctions) {
          uiFunctions.showProgress(
            `Downloading Core ML model for ${modelName}...`,
            50
          );
        }

        try {
          const coreMLPath = await this.downloadCoreMLModel(modelName);
          if (coreMLPath) {
            console.log(`Core ML model downloaded: ${coreMLPath}`);
            if (uiFunctions) {
              uiFunctions.showProgress(
                `Core ML model downloaded successfully`,
                100
              );
            }
          } else {
            console.warn(`Failed to download Core ML model for ${modelName}`);
            if (uiFunctions) {
              uiFunctions.showProgress(
                `Core ML model download failed, continuing with regular model`,
                100
              );
            }
          }
        } catch (error) {
          console.warn(`Core ML model download error: ${error}`);
          if (uiFunctions) {
            uiFunctions.showProgress(
              `Core ML model download failed, continuing with regular model`,
              100
            );
          }
        }
      }

      throw new Error(
        "Download functionality not yet implemented - please use the existing model download system"
      );
    } catch (error) {
      const errorMsg = `Failed to download ${modelName}: ${error}`;
      this.setError(errorMsg);
      this.setLoadingState(false);
      if (uiFunctions) {
        uiFunctions.showError(errorMsg);
      }
      throw error;
    }
  }
}
