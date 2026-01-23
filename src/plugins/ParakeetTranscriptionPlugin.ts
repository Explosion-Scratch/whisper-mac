// import "isomorphic-fetch";
import { spawn, ChildProcess } from "child_process";
import {
  unlinkSync,
  mkdtempSync,
  existsSync,
  createWriteStream,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { v4 as uuidv4 } from "uuid";
import * as createInterface from "readline";
import { AppConfig } from "../config/AppConfig";
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
import { FileSystemService } from "../services/FileSystemService";

/**
 * Parakeet transcription plugin using custom Rust backend in server mode
 */
export class ParakeetTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "parakeet";
  readonly displayName = "Parakeet";
  readonly version = "0.2.0";
  readonly description =
    "Fast Parakeet-based transcription using persistent local Rust backend";
  readonly supportsRealtime = false;
  readonly supportsBatchProcessing = true;

  private config: AppConfig;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];
  private tempDir: string;
  private binaryPath: string;
  private modelPath: string = "";
  private isCurrentlyTranscribing = false;
  private isWindowVisible = false;

  // Server process management
  private serverProcess: ChildProcess | null = null;
  private serverReadline: createInterface.Interface | null = null;
  private requestQueue: Array<{
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }> = [];
  private isServerReady = false;

  // Lifecycle management
  private shutdownTimeout: NodeJS.Timeout | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly SHUTDOWN_DELAY_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "parakeet-plugin-"));
    this.binaryPath = this.resolveBinaryPath();

    // Initialize schema
    this.schema = this.getSchema();

    // Set default activation criteria based on schema default
    const defaultRunOnAll =
      this.schema.find((opt) => opt.key === "runOnAll")?.default ?? false;
    this.setActivationCriteria({
      runOnAll: defaultRunOnAll,
      skipTransformation: false,
    });
  }

  getFallbackChain(): string[] {
    return ["whisper-cpp", "vosk"];
  }

  private resolveBinaryPath(): string {
    // Try production bundled path first
    const packagedPath = join(process.resourcesPath, "parakeet-backend");
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development path
    const devPath = join(
      process.cwd(),
      "native",
      "parakeet-backend",
      "target",
      "release",
      "parakeet-backend",
    );
    if (existsSync(devPath)) {
      return devPath;
    }

    return "parakeet-backend";
  }

  private resolveModelPath(): string {
    const modelName = this.options.model || "parakeet-tdt-0.6b-v2-onnx";
    const userModelPath = join(this.config.getModelsDir(), modelName);
    return userModelPath;
  }

  async isAvailable(): Promise<boolean> {
    // We can just check if binary exists for now
    return existsSync(this.binaryPath);
  }

  private async ensureServerStarted(): Promise<void> {
    // If we have a pending shutdown, cancel it
    if (this.shutdownTimeout) {
      clearTimeout(this.shutdownTimeout);
      this.shutdownTimeout = null;
    }

    if (this.serverProcess && !this.serverProcess.killed) {
      return;
    }

    // Kill any existing dead process refs just in case
    this.killServer();

    return new Promise((resolve, reject) => {
      try {
        const args = ["--server"];
        console.log(
          `[parakeet] Spawning server: ${this.binaryPath} ${args.join(" ")}`,
        );

        this.serverProcess = spawn(this.binaryPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        if (!this.serverProcess.stdout || !this.serverProcess.stdin) {
          throw new Error("Failed to open stdio for Parakeet server");
        }

        this.serverReadline = createInterface.createInterface({
          input: this.serverProcess.stdout,
          terminal: false,
        });

        this.serverProcess.stderr?.on("data", (data) => {
          console.error(`[parakeet-server] ${data.toString()}`);
        });

        this.serverProcess.on("close", (code) => {
          console.log(`[parakeet] Server exited with code ${code}`);
          this.serverProcess = null;
          this.isServerReady = false;
          this.readyPromise = null; // Reset ready promise so we retry next time
          this.rejectAllPending(
            new Error(`Server exited unexpectedly with code ${code}`),
          );
        });

        // Wait for ready signal
        const readyListener = (line: string) => {
          if (line.trim() === "PARAKEET_SERVER_READY") {
            console.log("[parakeet] Server ready signal received");
            this.isServerReady = true;
            this.serverReadline?.off("line", readyListener);
            this.serverReadline?.on("line", (line) =>
              this.handleServerResponse(line),
            );
            resolve();
          } else {
            // Might be logs appearing before ready signal
            console.log(`[parakeet-server init] ${line}`);
          }
        };

        this.serverReadline.on("line", readyListener);

        // Timeout for startup
        setTimeout(() => {
          if (!this.isServerReady) {
            this.serverReadline?.off("line", readyListener);
            this.killServer();
            reject(new Error("Timeout waiting for Parakeet server to start"));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleServerResponse(line: string) {
    if (line.trim().length === 0) return;

    try {
      const response = JSON.parse(line);
      const request = this.requestQueue.shift();
      if (request) {
        if (response.status === "ok") {
          request.resolve(response.data);
        } else {
          request.reject(new Error(response.message || "Unknown server error"));
        }
      } else {
        console.warn(
          "[parakeet] Received response with no pending request:",
          line,
        );
      }
    } catch (e) {
      console.error("[parakeet] Failed to parse server response:", line, e);
    }
  }

  private rejectAllPending(error: Error) {
    while (this.requestQueue.length > 0) {
      const req = this.requestQueue.shift();
      req?.reject(error);
    }
  }

  private async sendRequest(command: any): Promise<any> {
    // Ensure server is physically running (this should be fast if already running)
    // Note: ensureServerStarted handles the checking of existing process
    if (!this.serverProcess) {
      throw new Error("Server process not active");
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject });
      try {
        const cmdString = JSON.stringify(command) + "\n";
        this.serverProcess?.stdin?.write(cmdString);
      } catch (e) {
        const req = this.requestQueue.pop(); // Remove the one we just added
        reject(e);
      }
    });
  }

  private killServer() {
    if (this.shutdownTimeout) {
      clearTimeout(this.shutdownTimeout);
      this.shutdownTimeout = null;
    }

    if (this.serverProcess) {
      console.log("[parakeet] Killing server process");
      try {
        this.serverProcess.kill();
      } catch (e) {
        // ignore
      }
      this.serverProcess = null;
    }
    if (this.serverReadline) {
      this.serverReadline.close();
      this.serverReadline = null;
    }
    this.isServerReady = false;
    this.readyPromise = null;
    this.rejectAllPending(new Error("Server killed"));
  }

  // Background initialization to prevent blocking the UI
  private async initializeBackend(
    onProgress?: (p: TranscriptionSetupProgress) => void,
  ) {
    try {
      const needsModelLoad = !this.serverProcess; // If no process (or killed), we need to load model.

      await this.ensureServerStarted();

      if (needsModelLoad) {
        onProgress?.({
          status: "starting",
          message: "Loading model into memory...",
        });
        this.modelPath = this.resolveModelPath();
        await this.sendRequest({
          command: "load_model",
          path: this.modelPath,
        });
        onProgress?.({ status: "complete", message: "Parakeet backend ready" });
      }
    } catch (error) {
      console.error("[parakeet] Background initialization failed", error);
      // We don't throw here because this is running in background.
      // processAudioSegment will catch the failure when it awaits readyPromise.
      throw error;
    }
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      onProgress?.({
        status: "starting",
        message: "Initializing Parakeet plugin",
      });

      this.modelPath = this.resolveModelPath();

      // Check if model exists (FAST sync check)
      if (!existsSync(this.modelPath)) {
        throw new Error(
          `Model not found at ${this.modelPath}. Please download it first.`,
        );
      }

      // Sync setup
      this.setTranscriptionCallback(onUpdate);
      this.sessionUid = uuidv4();
      this.currentSegments = [];
      this.setRunning(true);

      // Kick off backend init properly.
      // If readyPromise exists and is effectively "done" (or running), we use it.
      // But if the server died or this is a fresh start, we create a new one.
      // ensureServerStarted will clear timeout and check logic.

      // We chain the initialization to ensure order
      this.readyPromise = this.initializeBackend(onProgress);

      // RETURN IMMEDIATELY so UI can show up.
    } catch (error: any) {
      this.setRunning(false);
      onProgress?.({
        status: "error",
        message: `Failed to start plugin: ${error.message}`,
      });
      throw error;
    }
  }

  async processAudioSegment(audioData: Float32Array): Promise<void> {
    if (!this.isRunning || !this.onTranscriptionCallback) {
      return;
    }

    let tempAudioPath: string | null = null;
    try {
      this.isCurrentlyTranscribing = true;
      tempAudioPath = await this.saveAudioAsWav(audioData);

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

      // Wait for backend to be ready (load_model cmd etc)
      if (this.readyPromise) {
        await this.readyPromise;
      }

      // Send transcribe command
      const result = await this.sendRequest({
        command: "transcribe",
        path: tempAudioPath,
        options: {},
      });

      const completedSegment: TranscribedSegment = {
        id: uuidv4(),
        type: "transcribed",
        text: result.text,
        completed: true,
        timestamp: Date.now(),
        start: result.segments?.[0]?.start,
        end: result.segments?.[result.segments.length - 1]?.end,
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
      // Should properly delete temp files, or let the OS handle it if we are confident.
      // Using a queue ensures we don't delete before server reads it?
      // Actually, server reads it during 'transcribe' call, which awaits until done.
      // So it is safe to delete here.
      if (tempAudioPath) {
        try {
          unlinkSync(tempAudioPath);
        } catch (err) {
          console.warn("[parakeet] Failed to delete temp audio file:", err);
        }
      }
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    // Assuming server is running, or start it temporarily?
    // For now, let's assume this is called when active.
    if (!this.serverProcess) {
      await this.ensureServerStarted();
      // And we probably need to load the model if not loaded...
      // This method might need more robust handling if called outside a session.
      await this.sendRequest({
        command: "load_model",
        path: this.resolveModelPath(),
      });
    }

    const result = await this.sendRequest({
      command: "transcribe",
      path: filePath,
    });
    return result.text;
  }

  async stopTranscription(): Promise<void> {
    this.setRunning(false);
    this.setTranscriptionCallback(null);
    this.currentSegments = [];
    this.isCurrentlyTranscribing = false;

    // Don't kill server immediately, just start shutdown timer
    if (this.shutdownTimeout) clearTimeout(this.shutdownTimeout);
    this.shutdownTimeout = setTimeout(() => {
      console.log("[parakeet] Server idle timeout reached, shutting down...");
      this.killServer();
    }, this.SHUTDOWN_DELAY_MS);
  }

  async cleanup(): Promise<void> {
    await this.stopTranscription();
    try {
      const { readdirSync } = require("fs");
      if (existsSync(this.tempDir)) {
        const files = readdirSync(this.tempDir);
        for (const file of files) {
          unlinkSync(join(this.tempDir, file));
        }
      }
    } catch (err) {
      console.warn("Failed to clean temp directory:", err);
    }
  }

  // Model configurations mapping model values to their HuggingFace repos
  private readonly modelConfigs: Record<
    string,
    { hfRepo: string; displayName: string }
  > = {
    "parakeet-tdt-0.6b-v2-onnx": {
      hfRepo: "istupakov/parakeet-tdt-0.6b-v2-onnx",
      displayName: "Parakeet V2 (English only)",
    },
    "parakeet-tdt-0.6b-v3-onnx": {
      hfRepo: "istupakov/parakeet-tdt-0.6b-v3-onnx",
      displayName: "Parakeet V3 (Multilingual)",
    },
  };

  private getHfRepoForModel(modelName: string): string {
    return (
      this.modelConfigs[modelName]?.hfRepo ||
      this.modelConfigs["parakeet-tdt-0.6b-v2-onnx"].hfRepo
    );
  }

  getSchema(): PluginSchemaItem[] {
    return [
      {
        key: "model",
        type: "model-select",
        label: "Parakeet Model",
        description: "Choose the Parakeet model version for transcription",
        default: "parakeet-tdt-0.6b-v2-onnx",
        category: "model",
        options: [
          {
            value: "parakeet-tdt-0.6b-v2-onnx",
            label: "Parakeet V2 (English only)",
            description:
              "Best for English - fastest and most accurate for English speech",
            size: "661 MB",
          },
          {
            value: "parakeet-tdt-0.6b-v3-onnx",
            label: "Parakeet V3 (Multilingual)",
            description: "Supports 25 European languages including English",
            size: "670 MB",
          },
        ],
        required: true,
      },
      {
        key: "runOnAll",
        type: "boolean",
        label: "Process All Audio Together",
        description:
          "When enabled, processes all audio segments together for better context. When disabled, processes each segment individually.",
        default: false,
        category: "advanced",
      },
    ];
  }

  // Files needed for Parakeet TDT model (same structure for V2 and V3)
  private readonly modelFiles = [
    { remote: "encoder-model.int8.onnx", local: "encoder-model.onnx" },
    {
      remote: "decoder_joint-model.int8.onnx",
      local: "decoder_joint-model.onnx",
    },
    { remote: "nemo128.onnx", local: "nemo128.onnx" },
    { remote: "vocab.txt", local: "vocab.txt" },
  ];

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    const modelDir = join(this.config.getModelsDir(), modelName);
    console.log(`[parakeet] downloadModel called for: ${modelName}`);
    console.log(`[parakeet] Model directory: ${modelDir}`);

    if (!existsSync(modelDir)) {
      console.log(`[parakeet] Creating model directory`);
      mkdirSync(modelDir, { recursive: true });
    }

    // Get the correct HuggingFace repo for this model version
    const hfRepo = this.getHfRepoForModel(modelName);
    const displayName = this.modelConfigs[modelName]?.displayName || modelName;

    console.log(`[parakeet] HuggingFace repo: ${hfRepo}`);
    console.log(
      `[parakeet] Files to download: ${this.modelFiles.map((f) => f.local).join(", ")}`,
    );

    this.setLoadingState(true, `Downloading ${displayName}...`);

    try {
      let completedFiles = 0;
      const totalFiles = this.modelFiles.length;

      for (const file of this.modelFiles) {
        const url = `https://huggingface.co/${hfRepo}/resolve/main/${file.remote}`;
        const destPath = join(modelDir, file.local);

        const fileExists = existsSync(destPath);
        if (fileExists) {
          // Check file size - if it's 0 or very small, it's probably a failed download
          const stats = statSync(destPath);
          console.log(
            `[parakeet] File ${file.local} exists, size: ${stats.size} bytes`,
          );
          if (stats.size > 1000) {
            // File exists and has content, skip
            completedFiles++;
            continue;
          } else {
            console.log(
              `[parakeet] File ${file.local} is too small, re-downloading`,
            );
            // Delete the incomplete file
            unlinkSync(destPath);
          }
        } else {
          console.log(
            `[parakeet] File ${file.local} does not exist, will download`,
          );
        }

        if (uiFunctions) {
          uiFunctions.showProgress(
            `Downloading ${file.local} (${completedFiles + 1}/${totalFiles})...`,
            Math.round((completedFiles / totalFiles) * 100),
          );
        }

        console.log(`[parakeet] Starting download: ${url}`);
        console.log(`[parakeet] Destination: ${destPath}`);

        await this.downloadFileWithProgress(
          url,
          destPath,
          file.local,
          (percent) => {
            const totalPercent = Math.round(
              ((completedFiles + percent / 100) / totalFiles) * 100,
            );
            if (percent % 10 === 0) {
              console.log(
                `[parakeet] Download progress for ${file.local}: ${percent.toFixed(0)}%`,
              );
            }
            uiFunctions?.showProgress(
              `Downloading ${file.local}... ${percent}%`,
              totalPercent,
            );
          },
        );

        console.log(`[parakeet] Completed download: ${file.local}`);
        completedFiles++;
      }

      console.log(
        `[parakeet] All downloads complete. Downloaded ${completedFiles} files.`,
      );
      if (uiFunctions) {
        uiFunctions.showSuccess(`Model ${modelName} downloaded successfully`);
        uiFunctions.hideProgress();
      }
      this.setLoadingState(false);
    } catch (error: any) {
      const errorMsg = `Failed to download model: ${error.message}`;
      this.setError(errorMsg);
      this.setLoadingState(false);
      if (uiFunctions) {
        uiFunctions.showError(errorMsg);
        uiFunctions.hideProgress();
      }
      throw error;
    }
  }

  async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void,
  ): Promise<boolean> {
    const modelName = options.model || "parakeet-tdt-0.6b-v2-onnx";
    const modelDir = join(this.config.getModelsDir(), modelName);

    console.log(
      `[parakeet] ensureModelAvailable called with model: ${modelName}`,
    );
    console.log(`[parakeet] Checking model directory: ${modelDir}`);

    // Check if all files exist
    const missingFiles = this.modelFiles.filter(
      (file) => !existsSync(join(modelDir, file.local)),
    );
    const allFilesExist = missingFiles.length === 0;

    if (allFilesExist) {
      console.log(`[parakeet] All model files exist, skipping download`);
      onLog?.(`Parakeet model ${modelName} already available`);
      return true;
    }

    console.log(
      `[parakeet] Missing files: ${missingFiles.map((f) => f.local).join(", ")}`,
    );
    console.log(`[parakeet] Starting download...`);

    try {
      await this.downloadModel(modelName, {
        showProgress: (message: string, percent: number) => {
          onProgress?.({
            message,
            progress: percent,
            percent,
            status: percent >= 100 ? "complete" : "downloading",
          });
        },
        showDownloadProgress: (downloadProgress: any) => {
          // Normalize the progress field name
          onProgress?.({
            ...downloadProgress,
            progress:
              downloadProgress.percent ?? downloadProgress.progress ?? 0,
          });
        },
        hideProgress: () => {},
        showError: (error: string) => {
          onLog?.(`Error: ${error}`);
        },
        showSuccess: (message: string) => {
          onLog?.(message);
        },
        confirmAction: async () => true,
      });
      console.log(`[parakeet] Download completed successfully`);
      return true;
    } catch (error: any) {
      console.error(`[parakeet] Download failed: ${error.message}`);
      onLog?.(`Failed to download model ${modelName}: ${error.message}`);
      throw error;
    }
  }

  private async downloadFileWithProgress(
    url: string,
    destPath: string,
    fileName: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    console.log(`Downloading ${url} to ${destPath}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download ${fileName}: ${response.statusText} (${response.status})`,
      );
    }

    const totalBytes = parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    let downloadedBytes = 0;
    const fileStream = createWriteStream(destPath);

    if (response.body && typeof (response.body as any).pipe === "function") {
      // Node-fetch v2 style (Node stream)
      return new Promise((resolve, reject) => {
        (response.body as any).on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const percent =
            totalBytes > 0
              ? Math.round((downloadedBytes / totalBytes) * 100)
              : 0;
          onProgress?.(percent);
        });

        (response.body as any).pipe(fileStream);

        fileStream.on("finish", () => {
          onProgress?.(100);
          resolve();
        });

        fileStream.on("error", (error: any) => reject(error));
        (response.body as any).on("error", (error: any) => reject(error));
      });
    } else if (response.body) {
      // Web Streams API (standard fetch)
      const reader = response.body.getReader();

      return new Promise(async (resolve, reject) => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value) {
              downloadedBytes += value.length;
              const percent =
                totalBytes > 0
                  ? Math.round((downloadedBytes / totalBytes) * 100)
                  : 0;
              onProgress?.(percent);
              fileStream.write(Buffer.from(value));
            }
          }

          fileStream.end();
          fileStream.on("finish", () => {
            onProgress?.(100);
            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    } else {
      throw new Error("Response body is empty");
    }
  }

  // Helpers

  private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
      sampleRate: 16000,
      numChannels: 1,
      bitsPerSample: 16,
    });
  }

  onDictationWindowShow(): void {
    this.isWindowVisible = true;
  }

  onDictationWindowHide(): void {
    this.isWindowVisible = false;
  }

  // Required abstract methods
  async validateOptions(
    options: Record<string, any>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  }

  async onActivated(uiFunctions?: any): Promise<void> {
    this.setActive(true);

    // Update activation criteria based on runOnAll option
    const runOnAll =
      this.options.runOnAll !== undefined
        ? this.options.runOnAll
        : (this.getSchema().find((opt) => opt.key === "runOnAll")?.default ??
          false);
    this.setActivationCriteria({ runOnAll, skipTransformation: false });
    console.log(`[parakeet] Activated with runOnAll: ${runOnAll}`);
  }
  async initialize(): Promise<void> {
    this.setInitialized(true);
  }
  async destroy(): Promise<void> {
    this.killServer();
  }
  async onDeactivate(): Promise<void> {
    this.setActive(false);
    this.killServer();
  }
  getDataPath(): string {
    return this.config.getModelsDir();
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

      if (existsSync(modelsDir)) {
        const files = readdirSync(modelsDir);
        for (const file of files) {
          const modelPath = join(modelsDir, file);
          try {
            const stats = statSync(modelPath);
            if (stats.isDirectory() && file.startsWith("parakeet")) {
              const dirSize =
                FileSystemService.calculateDirectorySize(modelPath);
              dataItems.push({
                name: file,
                description: `Parakeet model directory`,
                size: dirSize,
                id: `model:${file}`,
              });
            }
          } catch (error) {
            console.warn(`Failed to stat model ${file}:`, error);
          }
        }
      }

      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const tempFile of tempFiles) {
          const tempPath = join(this.tempDir, tempFile);
          try {
            const stats = statSync(tempPath);
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
      console.warn("Failed to list Parakeet plugin data:", error);
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
            const stats = statSync(modelPath);
            if (stats.isDirectory()) {
              FileSystemService.deleteDirectory(modelPath);
              console.log(`[parakeet] Deleted model directory: ${identifier}`);
            } else {
              unlinkSync(modelPath);
              console.log(`[parakeet] Deleted model file: ${identifier}`);
            }
          }
          break;

        case "temp":
          const tempPath = join(this.tempDir, identifier);
          if (existsSync(tempPath)) {
            unlinkSync(tempPath);
            console.log(`[parakeet] Deleted temp file: ${identifier}`);
          }
          break;

        case "secure":
          await this.deleteSecureValue(identifier);
          console.log(`[parakeet] Deleted secure data: ${identifier}`);
          break;

        default:
          throw new Error(`Unknown data type: ${type}`);
      }
    } catch (error) {
      console.error(`[parakeet] Failed to delete data item ${id}:`, error);
      throw error;
    }
  }

  async deleteAllData(): Promise<void> {
    try {
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const file of tempFiles) {
          try {
            unlinkSync(join(this.tempDir, file));
          } catch (error) {
            console.warn(
              `[parakeet] Failed to delete temp file ${file}:`,
              error,
            );
          }
        }
      }

      await this.clearSecureData();

      const modelsDir = this.config.getModelsDir();
      if (existsSync(modelsDir)) {
        const files = readdirSync(modelsDir);

        for (const file of files) {
          const filePath = join(modelsDir, file);

          try {
            const stats = statSync(filePath);
            if (file.startsWith("parakeet") && stats.isDirectory()) {
              FileSystemService.deleteDirectory(filePath);
              console.log(`[parakeet] Deleted model: ${file}`);
            }
          } catch (error) {
            console.warn(`[parakeet] Failed to delete model ${file}:`, error);
          }
        }
      }

      console.log("[parakeet] All data cleared");
    } catch (error) {
      console.error("[parakeet] Failed to clear all data:", error);
      throw error;
    }
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    const previousModel = this.options.model;
    const previousRunOnAll = this.options.runOnAll;
    this.setOptions(options);

    // Handle model change - download new model if needed
    if (options.model && options.model !== previousModel) {
      const modelName = options.model;
      const modelDir = join(this.config.getModelsDir(), modelName);
      const allFilesExist = this.modelFiles.every((file) =>
        existsSync(join(modelDir, file.local)),
      );

      if (!allFilesExist) {
        console.log(`[parakeet] Model ${modelName} not found, downloading...`);
        try {
          await this.downloadModel(modelName, uiFunctions);
          console.log(`[parakeet] Model ${modelName} downloaded successfully`);
        } catch (error: any) {
          console.error(
            `[parakeet] Failed to download model ${modelName}:`,
            error,
          );
          throw error;
        }
      }

      // Kill existing server so it reloads with new model
      this.killServer();
      console.log(`[parakeet] Switched to model: ${modelName}`);
    }

    if (
      options.runOnAll !== undefined &&
      options.runOnAll !== previousRunOnAll
    ) {
      const runOnAll = options.runOnAll;
      this.setActivationCriteria({
        runOnAll,
        skipTransformation: false,
      });
    }
  }
}
