import { spawn, ChildProcess } from "child_process";
import { unlinkSync, mkdtempSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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
import { WavProcessor } from "../helpers/WavProcessor";
import { ModelManager, ModelDownloadProgress } from "../services/ModelManager";

/**
 * Vosk transcription plugin using Python vosk-api via CLI
 */
export class VoskTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "vosk";
  readonly displayName = "Vosk";
  readonly version = "0.3.50";
  readonly description =
    "Offline speech recognition using Vosk engine with support for multiple languages";
  readonly supportsRealtime = true;
  readonly supportsBatchProcessing = true;

  private config: AppConfig;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];
  private tempDir: string;
  private modelManager: ModelManager;
  private voskScriptPath: string;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "vosk-plugin-"));
    this.modelManager = new ModelManager(config);
    this.voskScriptPath = this.resolveVoskScriptPath();
    this.setActivationCriteria({ runOnAll: false, skipTransformation: false });
  }

  /**
   * Resolve the path to the Vosk Python script
   */
  private resolveVoskScriptPath(): string {
    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "vosk",
      "vosk_transcribe.py"
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(process.cwd(), "vendor", "vosk", "vosk_transcribe.py");
    if (existsSync(devPath)) {
      return devPath;
    }

    // Return expected path for creation
    return devPath;
  }

  /**
   * Get available Vosk models with their download URLs
   */
  private getAvailableModels(): Record<
    string,
    { url: string; description: string }
  > {
    return {
      "vosk-model-small-en-us-0.15": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
        description: "Small English US model (40MB)",
      },
      "vosk-model-en-us-aspire-0.2": {
        url: "https://alphacephei.com/vosk/models/vosk-model-en-us-aspire-0.2.zip",
        description: "Large English US model (1.4GB)",
      },
      "vosk-model-small-cn-0.22": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip",
        description: "Small Chinese model (42MB)",
      },
      "vosk-model-small-ru-0.22": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip",
        description: "Small Russian model (45MB)",
      },
      "vosk-model-small-fr-0.22": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
        description: "Small French model (41MB)",
      },
      "vosk-model-small-de-0.15": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip",
        description: "Small German model (45MB)",
      },
      "vosk-model-small-es-0.42": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip",
        description: "Small Spanish model (39MB)",
      },
      "vosk-model-small-it-0.22": {
        url: "https://alphacephei.com/vosk/models/vosk-model-small-it-0.22.zip",
        description: "Small Italian model (48MB)",
      },
    };
  }

  /**
   * Get the current model name from options
   */
  private getCurrentModelName(): string {
    return (
      this.options.model ||
      this.getOptions().find((opt) => opt.key === "model")?.default ||
      "vosk-model-small-en-us-0.15"
    );
  }

  /**
   * Get path to the extracted model directory
   */
  private getModelPath(modelName: string): string {
    return join(this.config.getModelsDir(), modelName);
  }

  /**
   * Check if a model is downloaded and extracted
   */
  public isModelDownloaded(modelName: string): boolean {
    const modelPath = this.getModelPath(modelName);
    return (
      existsSync(modelPath) && existsSync(join(modelPath, "conf", "model.conf"))
    );
  }

  /**
   * Download and extract a Vosk model using existing ModelManager pattern
   */
  public async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    const modelName =
      options.model ||
      this.getOptions().find((opt) => opt.key === "model")?.default ||
      "vosk-model-small-en-us-0.15";
    if (this.isModelDownloaded(modelName)) {
      onLog?.(`Vosk model ${modelName} already available`);
      return true;
    }

    const models = this.getAvailableModels();
    const modelInfo = models[modelName];

    if (!modelInfo) {
      const availableModels = Object.keys(models).join(", ");
      throw new Error(
        `Unknown Vosk model: ${modelName}. Available models: ${availableModels}`
      );
    }

    // Ensure models directory exists
    const modelsDir = this.config.getModelsDir();
    if (!existsSync(modelsDir)) {
      const { mkdirSync } = require("fs");
      mkdirSync(modelsDir, { recursive: true });
      onLog?.(`Created models directory: ${modelsDir}`);
    }

    const zipPath = join(modelsDir, `${modelName}.zip`);
    const extractPath = this.getModelPath(modelName);

    try {
      onLog?.(`Downloading Vosk model: ${modelName} from ${modelInfo.url}`);
      onProgress?.({
        status: "downloading",
        message: "Starting download...",
        modelRepoId: modelName,
        progress: 0,
        percent: 0,
      });

      // Download the zip file
      await this.downloadFile(
        modelInfo.url,
        zipPath,
        modelName,
        onProgress,
        onLog
      );

      onLog?.(`Extracting model: ${modelName} to ${extractPath}`);
      onProgress?.({
        status: "extracting",
        message: "Extracting model...",
        modelRepoId: modelName,
        progress: 90,
        percent: 90,
      });

      // Extract the zip file
      await this.extractZipFile(zipPath, extractPath, onLog);

      // Verify the model is properly installed
      if (!this.isModelDownloaded(modelName)) {
        throw new Error(
          `Model extraction completed but validation failed. Model may be corrupt.`
        );
      }

      // Clean up zip file
      try {
        unlinkSync(zipPath);
        onLog?.(`Cleaned up zip file: ${zipPath}`);
      } catch (err) {
        console.warn("Failed to delete zip file:", err);
      }

      onProgress?.({
        status: "complete",
        message: "Model ready",
        modelRepoId: modelName,
        progress: 100,
        percent: 100,
      });

      onLog?.(`Vosk model ${modelName} is now available`);
      return true;
    } catch (error: any) {
      console.error(`Failed to download/extract model ${modelName}:`, error);

      // Clean up any partial files on error
      try {
        if (existsSync(zipPath)) {
          unlinkSync(zipPath);
          onLog?.(`Cleaned up partial zip file: ${zipPath}`);
        }
        if (existsSync(extractPath)) {
          const { rmSync } = require("fs");
          rmSync(extractPath, { recursive: true, force: true });
          onLog?.(`Cleaned up partial extraction: ${extractPath}`);
        }
      } catch (cleanupError) {
        console.warn("Failed to clean up after error:", cleanupError);
      }

      onProgress?.({
        status: "error",
        message: error.message,
        modelRepoId: modelName,
        progress: 0,
      });

      throw error;
    }
  }

  /**
   * Download file with progress tracking
   */
  private async downloadFile(
    url: string,
    filePath: string,
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    const https = require("https");
    const fs = require("fs");

    return new Promise((resolve, reject) => {
      const request = https.get(url, (response: any) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFile(
              redirectUrl,
              filePath,
              modelName,
              onProgress,
              onLog
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
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`)
          );
          return;
        }

        const totalBytes = parseInt(
          response.headers["content-length"] || "0",
          10
        );
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(filePath);

        onProgress?.({
          status: "downloading",
          message: "Downloading model...",
          modelRepoId: modelName,
          progress: 0,
          percent: 0,
          downloadedBytes: 0,
          totalBytes,
        });

        response.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const percent =
            totalBytes > 0
              ? Math.round((downloadedBytes / totalBytes) * 80)
              : 0; // 80% for download, 20% for extraction

          onProgress?.({
            status: "downloading",
            message: `Downloading model... ${percent}%`,
            modelRepoId: modelName,
            progress: percent,
            percent,
            downloadedBytes,
            totalBytes,
          });
        });

        response.pipe(fileStream);

        fileStream.on("close", () => {
          // Verify file exists and has expected size before resolving
          if (existsSync(filePath)) {
            const stats = require("fs").statSync(filePath);
            if (totalBytes > 0 && stats.size !== totalBytes) {
              reject(
                new Error(
                  `Downloaded file size ${stats.size} does not match expected ${totalBytes}`
                )
              );
              return;
            }
            onLog?.(`Download completed: ${modelName} (${stats.size} bytes)`);
            resolve();
          } else {
            reject(new Error("Downloaded file does not exist"));
          }
        });

        fileStream.on("error", (error: Error) => {
          // Clean up partial file on error
          try {
            if (existsSync(filePath)) {
              unlinkSync(filePath);
            }
          } catch (e) {
            console.warn("Failed to clean up partial download:", e);
          }
          reject(error);
        });

        response.on("error", (error: Error) => {
          fileStream.destroy();
          reject(error);
        });
      });

      request.on("error", reject);
    });
  }

  /**
   * Extract ZIP file using native child process
   */
  private async extractZipFile(
    zipPath: string,
    extractPath: string,
    onLog?: (line: string) => void
  ): Promise<void> {
    const { mkdirSync, rmSync } = require("fs");

    // Verify zip file exists before attempting extraction
    if (!existsSync(zipPath)) {
      throw new Error(`ZIP file does not exist: ${zipPath}`);
    }

    // Verify zip file has content
    const stats = require("fs").statSync(zipPath);
    if (stats.size === 0) {
      throw new Error(`ZIP file is empty: ${zipPath}`);
    }

    onLog?.(`Extracting ZIP file: ${zipPath} (${stats.size} bytes)`);

    // Clean up any existing extraction directory
    if (existsSync(extractPath)) {
      try {
        rmSync(extractPath, { recursive: true, force: true });
      } catch (err) {
        console.warn("Failed to clean existing extraction directory:", err);
      }
    }

    // Create extraction directory
    mkdirSync(extractPath, { recursive: true });

    return new Promise((resolve, reject) => {
      const unzip = spawn("unzip", ["-o", zipPath, "-d", extractPath]);

      let stdout = "";
      let stderr = "";

      unzip.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      unzip.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      unzip.on("close", (code: number) => {
        if (code === 0) {
          // Verify extraction was successful by checking for expected files
          const modelConfigPath = join(extractPath, "conf", "model.conf");
          if (!existsSync(modelConfigPath)) {
            // Look for the model directory structure (sometimes nested)
            const entries = require("fs").readdirSync(extractPath);
            let foundModel = false;

            for (const entry of entries) {
              const entryPath = join(extractPath, entry);
              const nestedConfigPath = join(entryPath, "conf", "model.conf");
              if (existsSync(nestedConfigPath)) {
                // Move nested model to correct location
                const tempPath = join(extractPath, "_temp");
                require("fs").renameSync(entryPath, tempPath);
                require("fs")
                  .readdirSync(tempPath)
                  .forEach((file: string) => {
                    require("fs").renameSync(
                      join(tempPath, file),
                      join(extractPath, file)
                    );
                  });
                rmSync(tempPath, { recursive: true, force: true });
                foundModel = true;
                break;
              }
            }

            if (!foundModel) {
              reject(
                new Error(
                  `Extraction completed but model structure is invalid. Expected conf/model.conf in ${extractPath}`
                )
              );
              return;
            }
          }

          onLog?.("Model extraction completed successfully");
          resolve();
        } else {
          reject(
            new Error(
              `Extraction failed with code ${code}: ${stderr || stdout}`
            )
          );
        }
      });

      unzip.on("error", (error: Error) => {
        reject(new Error(`Extraction process error: ${error.message}`));
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Python is available
      const pythonCheck = await this.checkPythonAndVosk();
      if (!pythonCheck) {
        console.log("Python or vosk package not available");
        return false;
      }

      // Check if we have our transcription script
      if (!existsSync(this.voskScriptPath)) {
        console.log(
          `Vosk transcription script not found at: ${this.voskScriptPath}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error("Vosk availability check failed:", error);
      return false;
    }
  }

  /**
   * Check if Python and vosk package are available
   */
  private async checkPythonAndVosk(): Promise<boolean> {
    return new Promise((resolve) => {
      const pythonProcess = spawn(
        "python3",
        ["-c", "import vosk; print('vosk available')"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      let hasOutput = false;
      pythonProcess.stdout?.on("data", () => {
        hasOutput = true;
      });

      pythonProcess.on("close", (code) => {
        resolve(hasOutput && code === 0);
      });

      pythonProcess.on("error", () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill();
          resolve(false);
        }
      }, 5000);
    });
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    console.log("=== Starting Vosk transcription plugin ===");

    if (this.isRunning) {
      onLog?.("[Vosk Plugin] Service already running");
      onProgress?.({ status: "complete", message: "Vosk plugin ready" });
      return;
    }

    try {
      onProgress?.({
        status: "starting",
        message: "Initializing Vosk plugin",
      });

      const modelName = this.getCurrentModelName();

      // Ensure model is downloaded
      await this.ensureModelAvailable(
        { model: modelName },
        (progress: any) => {
          onProgress?.({
            status: "starting",
            message: progress.message,
          });
        },
        onLog
      );

      this.setTranscriptionCallback(onUpdate);
      this.sessionUid = uuidv4();
      this.currentSegments = [];
      this.setRunning(true);

      onProgress?.({ status: "complete", message: "Vosk plugin ready" });
      onLog?.("[Vosk Plugin] Service initialized and ready for audio segments");
    } catch (error: any) {
      console.error("Failed to start Vosk plugin:", error);
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
      console.log("Vosk plugin not running, ignoring audio segment");
      return;
    }

    try {
      console.log(`Processing audio segment: ${audioData.length} samples`);

      // Create temporary WAV file for Vosk
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

      // Transcribe with Vosk
      const rawTranscription = await this.transcribeWithVosk(tempAudioPath);

      // Clean up temp file
      try {
        unlinkSync(tempAudioPath);
      } catch (err) {
        console.warn("Failed to delete temp audio file:", err);
      }

      // Use uniform post-processing API
      const postProcessed = this.postProcessTranscription(rawTranscription, {
        parseTimestamps: false, // Vosk doesn't provide timestamps by default
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
        confidence: postProcessed.confidence ?? 0.9, // Vosk confidence varies
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
    const rawTranscription = await this.transcribeWithVosk(filePath);
    const postProcessed = this.postProcessTranscription(rawTranscription, {
      parseTimestamps: false,
      cleanText: true,
      extractConfidence: false,
    });
    return postProcessed.text;
  }

  async stopTranscription(): Promise<void> {
    console.log("=== Stopping Vosk transcription plugin ===");

    this.setRunning(false);
    this.setTranscriptionCallback(null);
    this.currentSegments = [];

    console.log("Vosk transcription plugin stopped");
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
    const availableModels = this.getAvailableModels();

    return {
      model: {
        type: "select",
        label: "Vosk Model",
        description: "Choose the Vosk model for transcription",
        default: "vosk-model-small-en-us-0.15",
        options: Object.keys(availableModels),
      },
      sampleRate: {
        type: "number",
        label: "Sample Rate",
        description: "Audio sample rate for transcription",
        default: 16000,
        min: 8000,
        max: 48000,
      },
    };
  }

  configure(config: Record<string, any>): void {
    if (config.model !== undefined) {
      this.config.set("voskModel", config.model);
    }
    if (config.sampleRate !== undefined) {
      this.config.set("voskSampleRate", config.sampleRate);
    }
  }

  /**
   * Convert Float32Array audio data to WAV file for Vosk
   */
  private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
      sampleRate: this.config.get("voskSampleRate") || 16000,
      numChannels: 1,
      bitsPerSample: 16,
    });
  }

  /**
   * Transcribe audio file using Python Vosk API
   */
  private async transcribeWithVosk(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const modelName = this.getCurrentModelName();
      const modelPath = this.getModelPath(modelName);

      const args = [
        this.voskScriptPath,
        "--audio",
        audioPath,
        "--model",
        modelPath,
        "--sample-rate",
        (this.config.get("voskSampleRate") || 16000).toString(),
      ];

      console.log(`Running Vosk transcription: python3 ${args.join(" ")}`);

      const voskProcess = spawn("python3", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      voskProcess.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      voskProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      voskProcess.on("close", (code) => {
        if (code === 0) {
          const rawTranscription = stdout.trim();
          console.log(`Vosk raw transcription: "${rawTranscription}"`);
          resolve(rawTranscription || "[No speech detected]");
        } else {
          const error = new Error(
            `Vosk transcription failed with code ${code}: ${stderr}`
          );
          console.error("Vosk error:", error.message);
          reject(error);
        }
      });

      voskProcess.on("error", (error) => {
        console.error("Vosk spawn error:", error);
        reject(error);
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        if (!voskProcess.killed) {
          voskProcess.kill();
          reject(new Error("Vosk transcription timeout"));
        }
      }, 30000); // 30 second timeout
    });
  }

  // New unified plugin system methods
  getOptions() {
    const voskModels = [
      {
        value: "vosk-model-small-en-us-0.15",
        label: "Small English US",
        description: "Fast and lightweight",
        size: "40MB",
      },
      {
        value: "vosk-model-en-us-aspire-0.2",
        label: "Large English US",
        description: "High accuracy",
        size: "1.4GB",
      },
      {
        value: "vosk-model-small-cn-0.22",
        label: "Small Chinese",
        description: "Chinese language support",
        size: "42MB",
      },
      {
        value: "vosk-model-small-ru-0.22",
        label: "Small Russian",
        description: "Russian language support",
        size: "45MB",
      },
      {
        value: "vosk-model-small-fr-0.22",
        label: "Small French",
        description: "French language support",
        size: "41MB",
      },
      {
        value: "vosk-model-small-de-0.15",
        label: "Small German",
        description: "German language support",
        size: "45MB",
      },
      {
        value: "vosk-model-small-es-0.42",
        label: "Small Spanish",
        description: "Spanish language support",
        size: "39MB",
      },
      {
        value: "vosk-model-small-it-0.22",
        label: "Small Italian",
        description: "Italian language support",
        size: "48MB",
      },
    ];

    return [
      {
        key: "model",
        type: "model-select" as const,
        label: "Vosk Model",
        description: "Choose the Vosk model to use for transcription",
        default: "vosk-model-small-en-us-0.15",
        category: "model" as const,
        options: voskModels,
        required: true,
      },
      {
        key: "sampleRate",
        type: "select" as const,
        label: "Sample Rate",
        description: "Audio sample rate for transcription",
        default: "16000",
        category: "advanced" as const,
        options: [
          { value: "16000", label: "16 kHz (Recommended)" },
          { value: "8000", label: "8 kHz" },
          { value: "44100", label: "44.1 kHz" },
          { value: "48000", label: "48 kHz" },
        ],
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

    if (options.sampleRate) {
      const validRates =
        this.getOptions()
          .find((opt) => opt.key === "sampleRate")
          ?.options?.map((opt) => opt.value) || [];
      if (!validRates.includes(options.sampleRate)) {
        errors.push(`Invalid sample rate: ${options.sampleRate}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    this.setActive(true);

    try {
      // Check if model exists - this is required for activation
      const modelName =
        this.config.get("voskModel") || "vosk-model-small-en-us-0.15";
      const modelPath = join(this.config.getModelsDir(), modelName);

      if (!existsSync(modelPath)) {
        const error = `Model ${modelName} not found. Please download it first.`;
        this.setError(error);
        throw new Error(error);
      }

      this.setError(null);
      console.log(`Vosk plugin activated with model: ${modelName}`);
    } catch (error) {
      this.setActive(false);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    this.setLoadingState(true, "Initializing Vosk plugin...");

    try {
      // Only verify Python and dependencies - don't check models here
      const available = await this.isAvailable();
      if (!available) {
        throw new Error("Python or Vosk dependencies not found");
      }

      this.setInitialized(true);
      this.setLoadingState(false);
      console.log("Vosk plugin initialized successfully");
    } catch (error) {
      this.setError(`Vosk initialization failed: ${error}`);
      this.setLoadingState(false);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    console.log("Vosk plugin destroyed");
    this.setInitialized(false);
    this.setActive(false);
  }

  async onDeactivate(): Promise<void> {
    this.setActive(false);
    console.log("Vosk plugin deactivated");
  }

  async clearData(): Promise<void> {
    // Clean temp files
    try {
      if (FileSystemService.deleteDirectory(this.tempDir)) {
        this.tempDir = mkdtempSync(join(tmpdir(), "vosk-plugin-"));
      }
      console.log("Vosk plugin data cleared");
    } catch (error) {
      console.warn("Failed to clear Vosk plugin data:", error);
    }
  }

  async getDataSize(): Promise<number> {
    try {
      let totalSize = 0;

      // Calculate temp directory size
      totalSize += FileSystemService.calculateDirectorySize(this.tempDir);

      // Calculate model file size if it exists
      const modelPath = join(
        this.config.getModelsDir(),
        this.config.get("voskModel") || ""
      );
      totalSize += FileSystemService.calculateFileSize(modelPath);

      return totalSize;
    } catch (error) {
      console.warn("Failed to calculate Vosk plugin data size:", error);
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
    if (options.model && options.model !== this.config.get("voskModel")) {
      if (uiFunctions) {
        uiFunctions.showProgress(`Switching to model ${options.model}...`, 0);
      }
      this.setLoadingState(true, `Switching to model ${options.model}...`);

      try {
        // Update model configuration
        this.config.set("voskModel", options.model);

        // Check if new model exists
        const modelPath = join(this.config.getModelsDir(), options.model);
        if (!existsSync(modelPath)) {
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

    console.log("Vosk plugin options updated:", options);
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

      // Use the existing ensureModelAvailable method which handles all Vosk model download logic
      const onProgress = (progress: ModelDownloadProgress) => {
        this.setDownloadProgress(progress);
        if (uiFunctions) {
          uiFunctions.showDownloadProgress(progress);
        }
      };

      const onLog = (line: string) => {
        console.log(`[Vosk Download] ${line}`);
      };

      await this.ensureModelAvailable({ model: modelName }, onProgress, onLog);

      const completedProgress = {
        status: "complete" as const,
        progress: 100,
        message: `${modelName} downloaded successfully`,
        modelName,
      };

      this.setDownloadProgress(completedProgress);
      this.setLoadingState(false);

      if (uiFunctions) {
        uiFunctions.showDownloadProgress(completedProgress);
        uiFunctions.showSuccess(`${modelName} downloaded successfully`);
      }
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
