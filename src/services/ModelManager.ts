import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
  createWriteStream,
  unlinkSync,
} from "fs";
import { AppConfig } from "../config/AppConfig";
import * as https from "https";
import { IncomingMessage, ClientRequest } from "http";
import { pipeline } from "stream";
import { promisify } from "util";

const pipelineAsync = promisify(pipeline);

export type ModelDownloadProgress = {
  status: "starting" | "downloading" | "extracting" | "complete" | "error";
  message: string;
  modelRepoId: string;
  progress: number;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
};

export class ModelManager {
  private config: AppConfig;
  private activeDownload: string | null = null;
  private activeRequest: ClientRequest | null = null;
  private activeFilePath: string | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  private ensureDataDirectory(): void {
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!existsSync(this.config.getModelsDir())) {
      mkdirSync(this.config.getModelsDir(), { recursive: true });
    }
  }

  async ensureModelExists(
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    this.ensureDataDirectory();
    const modelPath = this.getModelPath(modelName);
    if (existsSync(modelPath)) {
      return true;
    }

    return await this.downloadModel(modelName, onProgress, onLog, abortSignal);
  }

  private getModelPath(modelName: string): string {
    // Direct path to model file
    return join(this.config.getModelsDir(), modelName);
  }

  private async downloadModelFile(
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.activeDownload) {
        reject(
          new Error(
            `Another model (${this.activeDownload}) is already downloading`,
          ),
        );
        return;
      }

      // Check if already aborted
      if (abortSignal?.aborted) {
        const error = new Error("Download aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }

      this.activeDownload = modelName;
      const modelPath = this.getModelPath(modelName);
      this.activeFilePath = modelPath;
      const ggmlUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;

      console.log(`Downloading model ${modelName} from ${ggmlUrl}`);
      onLog?.(`Starting download of ${modelName}`);

      onProgress?.({
        status: "starting",
        message: "Preparing to download model...",
        modelRepoId: modelName,
        progress: 0,
      });

      // Setup abort handler
      const abortHandler = () => {
        console.log(`[ModelManager] Download aborted for ${modelName}`);
        this.cleanupActiveDownload();
        const error = new Error("Download aborted");
        error.name = "AbortError";
        reject(error);
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }

      const request = https.get(ggmlUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFromUrl(
              redirectUrl,
              modelPath,
              modelName,
              onProgress,
              onLog,
              resolve,
              reject,
              abortSignal,
            );
          } else {
            this.activeDownload = null;
            this.activeFilePath = null;
            reject(new Error("Redirect without location header"));
          }
          return;
        }

        if (response.statusCode !== 200) {
          this.activeDownload = null;
          this.activeFilePath = null;
          reject(
            new Error(`Failed to download model: HTTP ${response.statusCode}`),
          );
          return;
        }

        this.downloadFromUrl(
          ggmlUrl,
          modelPath,
          modelName,
          onProgress,
          onLog,
          resolve,
          reject,
          abortSignal,
          response,
        );
      });

      this.activeRequest = request;

      request.on("error", (error) => {
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        this.activeDownload = null;
        this.activeRequest = null;
        this.activeFilePath = null;
        console.error(`Failed to start download: ${error.message}`);
        onProgress?.({
          status: "error",
          message: `Download failed: ${error.message}`,
          modelRepoId: modelName,
          progress: 0,
        });
        reject(error);
      });
    });
  }

  private downloadFromUrl(
    url: string,
    filePath: string,
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void,
    resolve?: (value: boolean) => void,
    reject?: (reason?: any) => void,
    abortSignal?: AbortSignal,
    response?: IncomingMessage,
  ): void {
    // Check if already aborted
    if (abortSignal?.aborted) {
      const error = new Error("Download aborted");
      error.name = "AbortError";
      reject?.(error);
      return;
    }

    const actualRequest = response
      ? null
      : https.get(url, (res) => {
          this.handleDownloadResponse(
            res,
            filePath,
            modelName,
            onProgress,
            onLog,
            resolve,
            reject,
            abortSignal,
          );
        });

    if (response) {
      this.handleDownloadResponse(
        response,
        filePath,
        modelName,
        onProgress,
        onLog,
        resolve,
        reject,
        abortSignal,
      );
    }

    if (actualRequest) {
      this.activeRequest = actualRequest;
      actualRequest.on("error", (error) => {
        this.activeDownload = null;
        this.activeRequest = null;
        this.activeFilePath = null;
        reject?.(error);
      });
    }
  }

  private handleDownloadResponse(
    response: IncomingMessage,
    filePath: string,
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void,
    resolve?: (value: boolean) => void,
    reject?: (reason?: any) => void,
    abortSignal?: AbortSignal,
  ): void {
    if (response.statusCode !== 200) {
      this.activeDownload = null;
      this.activeRequest = null;
      this.activeFilePath = null;
      reject?.(new Error(`Failed to download: HTTP ${response.statusCode}`));
      return;
    }

    // Check if already aborted
    if (abortSignal?.aborted) {
      response.destroy();
      const error = new Error("Download aborted");
      error.name = "AbortError";
      reject?.(error);
      return;
    }

    const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
    let downloadedBytes = 0;
    let aborted = false;

    const fileStream = createWriteStream(filePath);

    // Setup abort handler for this response
    const abortHandler = () => {
      if (aborted) return;
      aborted = true;
      console.log(`[ModelManager] Aborting download response for ${modelName}`);
      response.destroy();
      fileStream.destroy();
      this.cleanupPartialDownload(filePath);
      this.activeDownload = null;
      this.activeRequest = null;
      this.activeFilePath = null;
      const error = new Error("Download aborted");
      error.name = "AbortError";
      reject?.(error);
    };

    if (abortSignal) {
      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

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
        totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

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

    fileStream.on("finish", () => {
      if (aborted) return;
      if (abortSignal) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      this.activeDownload = null;
      this.activeRequest = null;
      this.activeFilePath = null;
      console.log(`Model ${modelName} downloaded successfully to ${filePath}`);
      onLog?.(`Download completed: ${modelName}`);

      onProgress?.({
        status: "complete",
        message: "Model downloaded successfully",
        modelRepoId: modelName,
        progress: 100,
        percent: 100,
      });

      resolve?.(true);
    });

    fileStream.on("error", (error) => {
      if (aborted) return;
      if (abortSignal) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      this.activeDownload = null;
      this.activeRequest = null;
      this.activeFilePath = null;
      console.error(`File write error: ${error.message}`);
      onProgress?.({
        status: "error",
        message: `Download failed: ${error.message}`,
        modelRepoId: modelName,
        progress: 0,
      });
      reject?.(error);
    });

    response.on("error", (error: Error) => {
      if (aborted) return;
      if (abortSignal) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      this.activeDownload = null;
      this.activeRequest = null;
      this.activeFilePath = null;
      console.error(`Download error: ${error.message}`);
      onProgress?.({
        status: "error",
        message: `Download failed: ${error.message}`,
        modelRepoId: modelName,
        progress: 0,
      });
      reject?.(error);
    });
  }

  getModelDirectory(modelName: string): string {
    return this.config.getModelsDir();
  }

  async downloadModel(
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    this.ensureDataDirectory();
    return this.downloadModelFile(modelName, onProgress, onLog, abortSignal);
  }

  isModelDownloaded(modelName: string): boolean {
    const modelPath = this.getModelPath(modelName);
    return existsSync(modelPath);
  }

  /** List downloaded models and their sizes (in bytes). */
  listDownloadedModels(): Array<{
    repoId: string;
    filePath: string;
    sizeBytes: number;
  }> {
    const modelsDir = this.config.getModelsDir();
    if (!existsSync(modelsDir)) return [];
    const entries = readdirSync(modelsDir, { withFileTypes: true });
    const result: Array<{
      repoId: string;
      filePath: string;
      sizeBytes: number;
    }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".bin")) continue;
      const filePath = join(modelsDir, entry.name);
      result.push({
        repoId: entry.name, // Use filename as repoId for compatibility
        filePath,
        sizeBytes: statSync(filePath).size,
      });
    }
    return result;
  }

  deleteModel(modelName: string): void {
    const filePath = this.getModelPath(modelName);
    try {
      if (existsSync(filePath)) rmSync(filePath, { force: true });
    } catch (e) {
      console.error("Failed to delete model file:", filePath, e);
    }
  }

  isDownloading(): boolean {
    return this.activeDownload !== null;
  }

  getCurrentDownload(): string | null {
    return this.activeDownload;
  }

  cancelDownload(): void {
    console.log("[ModelManager] cancelDownload called");
    this.cleanupActiveDownload();
  }

  /**
   * Cleanup active download: abort request and remove partial file
   */
  private cleanupActiveDownload(): void {
    if (this.activeRequest) {
      console.log("[ModelManager] Destroying active request");
      this.activeRequest.destroy();
      this.activeRequest = null;
    }

    if (this.activeFilePath) {
      this.cleanupPartialDownload(this.activeFilePath);
      this.activeFilePath = null;
    }

    this.activeDownload = null;
  }

  /**
   * Remove a partial download file
   */
  private cleanupPartialDownload(filePath: string): void {
    try {
      if (existsSync(filePath)) {
        console.log(`[ModelManager] Removing partial download: ${filePath}`);
        unlinkSync(filePath);
      }
    } catch (error) {
      console.error(
        `[ModelManager] Failed to cleanup partial download:`,
        error,
      );
    }
  }

  /**
   * Cleanup method to stop any active downloads
   */
  cleanup(): void {
    console.log("Cleaning up ModelManager...");
    this.cleanupActiveDownload();
  }
}
