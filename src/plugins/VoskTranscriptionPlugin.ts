import { spawn, ChildProcess } from "child_process";
import {
  unlinkSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
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
  PluginSchemaItem,
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
    // Initialize schema
    this.schema = this.getSchema();
  }

  /**
   * Define fallback chain for Vosk plugin
   * Prefer Whisper.cpp for high-quality transcription, then YAP as lightweight fallback
   */
  getFallbackChain(): string[] {
    return ["whisper-cpp", "yap"];
  }

  /**
   * Resolve the path to the Vosk Python script
   */
  private resolveVoskScriptPath(): string {
    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "vosk",
      "vosk_transcribe.py",
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
      this.getSchema().find((opt) => opt.key === "model")?.default ||
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
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    // Check if already aborted
    if (abortSignal?.aborted) {
      const error = new Error("Download aborted");
      error.name = "AbortError";
      throw error;
    }

    const modelName =
      options.model ||
      this.getSchema().find((opt) => opt.key === "model")?.default ||
      "vosk-model-small-en-us-0.15";
    if (this.isModelDownloaded(modelName)) {
      onLog?.(`Vosk model ${modelName} already available`);
      return true;
    }

    // Check abort before continuing
    if (abortSignal?.aborted) {
      const error = new Error("Download aborted");
      error.name = "AbortError";
      throw error;
    }

    const models = this.getAvailableModels();
    const modelInfo = models[modelName];

    if (!modelInfo) {
      const availableModels = Object.keys(models).join(", ");
      throw new Error(
        `Unknown Vosk model: ${modelName}. Available models: ${availableModels}`,
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
        onLog,
        abortSignal,
      );

      // Check if aborted after download
      if (abortSignal?.aborted) {
        // Clean up zip file
        try {
          if (existsSync(zipPath)) {
            unlinkSync(zipPath);
          }
        } catch (e) {
          console.warn("Failed to cleanup after abort:", e);
        }
        const error = new Error("Download aborted");
        error.name = "AbortError";
        throw error;
      }

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
          `Model extraction completed but validation failed. Model may be corrupt.`,
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
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const https = require("https");
    const fs = require("fs");

    return new Promise((resolve, reject) => {
      // Check if already aborted
      if (abortSignal?.aborted) {
        const error = new Error("Download aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }

      let aborted = false;
      let activeRequest: any = null;
      let activeFileStream: any = null;
      let activeResponse: any = null;

      const cleanup = () => {
        if (activeResponse) {
          activeResponse.destroy();
        }
        if (activeFileStream) {
          activeFileStream.destroy();
        }
        if (activeRequest) {
          activeRequest.destroy();
        }
        // Remove partial file
        try {
          if (existsSync(filePath)) {
            unlinkSync(filePath);
            console.log(`[Vosk] Removed partial download: ${filePath}`);
          }
        } catch (e) {
          console.error(`[Vosk] Failed to cleanup partial download:`, e);
        }
      };

      const abortHandler = () => {
        if (aborted) return;
        aborted = true;
        console.log(`[Vosk] Download aborted for ${modelName}`);
        cleanup();
        const error = new Error("Download aborted");
        error.name = "AbortError";
        reject(error);
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }

      const request = https.get(url, (response: any) => {
        activeResponse = response;

        if (aborted) {
          cleanup();
          return;
        }
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFile(
              redirectUrl,
              filePath,
              modelName,
              onProgress,
              onLog,
              abortSignal,
            )
              .then(resolve)
              .catch(reject);
          } else {
            if (abortSignal) {
              abortSignal.removeEventListener("abort", abortHandler);
            }
            reject(new Error("Redirect without location header"));
          }
          return;
        }

        if (response.statusCode !== 200) {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", abortHandler);
          }
          reject(
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
          );
          return;
        }

        const totalBytes = parseInt(
          response.headers["content-length"] || "0",
          10,
        );
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(filePath);
        activeFileStream = fileStream;

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
          if (aborted) return;
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
          if (aborted) return;
          if (abortSignal) {
            abortSignal.removeEventListener("abort", abortHandler);
          }
          // Verify file exists and has expected size before resolving
          if (existsSync(filePath)) {
            const stats = require("fs").statSync(filePath);
            if (totalBytes > 0 && stats.size !== totalBytes) {
              reject(
                new Error(
                  `Downloaded file size ${stats.size} does not match expected ${totalBytes}`,
                ),
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
          if (aborted) return;
          if (abortSignal) {
            abortSignal.removeEventListener("abort", abortHandler);
          }
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
          if (aborted) return;
          if (abortSignal) {
            abortSignal.removeEventListener("abort", abortHandler);
          }
          fileStream.destroy();
          reject(error);
        });
      });

      activeRequest = request;

      request.on("error", (error: Error) => {
        if (aborted) return;
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        reject(error);
      });
    });
  }

  /**
   * Extract ZIP file using native child process
   */
  private async extractZipFile(
    zipPath: string,
    extractPath: string,
    onLog?: (line: string) => void,
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
                      join(extractPath, file),
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
                  `Extraction completed but model structure is invalid. Expected conf/model.conf in ${extractPath}`,
                ),
              );
              return;
            }
          }

          onLog?.("Model extraction completed successfully");
          resolve();
        } else {
          reject(
            new Error(
              `Extraction failed with code ${code}: ${stderr || stdout}`,
            ),
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
          `Vosk transcription script not found at: ${this.voskScriptPath}`,
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
        },
      );

      let hasOutput = false;
      pythonProcess.stdout?.on("data", () => {
        hasOutput = true;
      });

      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill();
          resolve(false);
        }
      }, 5000);

      const clearAll = () => clearTimeout(timeout);

      pythonProcess.on("close", (code) => {
        clearAll();
        resolve(hasOutput && code === 0);
      });

      pythonProcess.on("error", () => {
        clearAll();
        resolve(false);
      });
    });
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
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
        onLog,
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

  /**
   * Convert Float32Array audio data to WAV file for Vosk
   */
  private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
      sampleRate: this.options.sampleRate || 16000,
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
        (this.options.sampleRate || 16000).toString(),
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

      // Set timeout to prevent hanging
      const timeout = setTimeout(() => {
        if (!voskProcess.killed) {
          voskProcess.kill();
          reject(new Error("Vosk transcription timeout"));
        }
      }, 30000); // 30 second timeout

      const clearAll = () => clearTimeout(timeout);

      voskProcess.on("close", (code) => {
        clearAll();
        if (code === 0) {
          const rawTranscription = stdout.trim();
          console.log(`Vosk raw transcription: "${rawTranscription}"`);
          resolve(rawTranscription || "[No speech detected]");
        } else {
          const error = new Error(
            `Vosk transcription failed with code ${code}: ${stderr}`,
          );
          console.error("Vosk error:", error.message);
          reject(error);
        }
      });

      voskProcess.on("error", (error) => {
        clearAll();
        console.error("Vosk spawn error:", error);
        reject(error);
      });
    });
  }

  // New unified plugin system methods
  getSchema(): PluginSchemaItem[] {
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

    if (options.sampleRate) {
      const validRates =
        this.getSchema()
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
      const modelName = this.options.model || "vosk-model-small-en-us-0.15";
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

      // List downloaded models (both zip files and extracted directories)
      if (existsSync(modelsDir)) {
        const files = readdirSync(modelsDir);

        for (const item of files) {
          const itemPath = join(modelsDir, item);
          try {
            const stats = require("fs").statSync(itemPath);

            if (item.endsWith(".zip")) {
              // Vosk model zip file
              dataItems.push({
                name: item.replace(".zip", ""),
                description: `Vosk model archive`,
                size: stats.size,
                id: `model_zip:${item}`,
              });
            } else if (stats.isDirectory() && item.startsWith("vosk-model-")) {
              // Extracted Vosk model directory
              const dirSize =
                FileSystemService.calculateDirectorySize(itemPath);
              dataItems.push({
                name: item,
                description: `Vosk extracted model`,
                size: dirSize,
                id: `model_dir:${item}`,
              });
            }
          } catch (error) {
            console.warn(`Failed to stat model item ${item}:`, error);
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
      console.warn("Failed to list Vosk plugin data:", error);
    }

    return dataItems;
  }

  async deleteDataItem(id: string): Promise<void> {
    const [type, identifier] = id.split(":", 2);

    try {
      switch (type) {
        case "model_zip":
          const zipPath = join(this.config.getModelsDir(), identifier);
          if (existsSync(zipPath)) {
            require("fs").unlinkSync(zipPath);
            console.log(`Deleted model zip: ${identifier}`);
          }
          break;

        case "model_dir":
          const dirPath = join(this.config.getModelsDir(), identifier);
          if (existsSync(dirPath)) {
            FileSystemService.deleteDirectory(dirPath);
            console.log(`Deleted model directory: ${identifier}`);
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

            // Delete model zip files and extracted directories
            if (
              file.endsWith(".zip") ||
              (stats.isDirectory() && file.startsWith("vosk-model-"))
            ) {
              if (stats.isDirectory()) {
                // Use the FileSystemService to delete directories
                FileSystemService.deleteDirectory(filePath);
              } else {
                require("fs").unlinkSync(filePath);
              }
              console.log(`Deleted Vosk model: ${file}`);
            }
          } catch (error) {
            console.warn(`Failed to delete model ${file}:`, error);
          }
        }
      }

      console.log("Vosk plugin: all data cleared");
    } catch (error) {
      console.error("Failed to clear all Vosk plugin data:", error);
      throw error;
    }
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    // Preserve previous model selection for comparison
    const previousModel = this.options.model;
    this.setOptions(options);

    // Handle model changes only when model actually changed
    if (options.model && options.model !== previousModel) {
      if (uiFunctions) {
        uiFunctions.showProgress(`Switching to model ${options.model}...`, 0);
      }
      this.setLoadingState(true, `Switching to model ${options.model}...`);

      try {
        // Check if new model exists, download if missing
        const modelsDir = this.config.getModelsDir();
        const modelPath = join(modelsDir, options.model);
        if (!existsSync(modelPath)) {
          const message = `Model ${options.model} not found, downloading...`;
          this.setLoadingState(true, message);
          if (uiFunctions) {
            uiFunctions.showProgress(message, 0);
          }

          // Download the missing model
          await this.downloadModel(options.model, uiFunctions);

          // Verify download succeeded
          if (existsSync(modelPath)) {
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
    console.log("Vosk plugin options updated:", options);
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
