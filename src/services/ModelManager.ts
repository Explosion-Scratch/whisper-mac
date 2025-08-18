import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
  createWriteStream,
} from "fs";
import { AppConfig } from "../config/AppConfig";
import * as https from "https";
import { pipeline } from "stream";
import { promisify } from "util";

const pipelineAsync = promisify(pipeline);

export type ModelDownloadProgress = {
  status: "starting" | "downloading" | "complete" | "error";
  message: string;
  modelRepoId: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
};

export class ModelManager {
  private config: AppConfig;
  private activeDownload: string | null = null;

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
    onLog?: (line: string) => void
  ): Promise<boolean> {
    this.ensureDataDirectory();
    const modelPath = this.getModelPath(modelName);
    if (existsSync(modelPath)) {
      return true;
    }

    return await this.downloadModel(modelName, onProgress, onLog);
  }

  private getModelPath(modelName: string): string {
    // Direct path to model file
    return join(this.config.getModelsDir(), modelName);
  }

  private async downloadModelFile(
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.activeDownload) {
        reject(
          new Error(
            `Another model (${this.activeDownload}) is already downloading`
          )
        );
        return;
      }

      this.activeDownload = modelName;
      const modelPath = this.getModelPath(modelName);
      const ggmlUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;

      console.log(`Downloading model ${modelName} from ${ggmlUrl}`);
      onLog?.(`Starting download of ${modelName}`);

      onProgress?.({
        status: "starting",
        message: "Preparing to download model...",
        modelRepoId: modelName,
      });

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
              reject
            );
          } else {
            this.activeDownload = null;
            reject(new Error("Redirect without location header"));
          }
          return;
        }

        if (response.statusCode !== 200) {
          this.activeDownload = null;
          reject(
            new Error(`Failed to download model: HTTP ${response.statusCode}`)
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
          response
        );
      });

      request.on("error", (error) => {
        this.activeDownload = null;
        console.error(`Failed to start download: ${error.message}`);
        onProgress?.({
          status: "error",
          message: `Download failed: ${error.message}`,
          modelRepoId: modelName,
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
    response?: any
  ): void {
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
            reject
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
        reject
      );
    }

    if (actualRequest) {
      actualRequest.on("error", (error) => {
        this.activeDownload = null;
        reject?.(error);
      });
    }
  }

  private handleDownloadResponse(
    response: any,
    filePath: string,
    modelName: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void,
    resolve?: (value: boolean) => void,
    reject?: (reason?: any) => void
  ): void {
    if (response.statusCode !== 200) {
      this.activeDownload = null;
      reject?.(new Error(`Failed to download: HTTP ${response.statusCode}`));
      return;
    }

    const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
    let downloadedBytes = 0;

    const fileStream = createWriteStream(filePath);

    onProgress?.({
      status: "downloading",
      message: "Downloading model...",
      modelRepoId: modelName,
      percent: 0,
      downloadedBytes: 0,
      totalBytes,
    });

    response.on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      const percent =
        totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

      onProgress?.({
        status: "downloading",
        message: `Downloading model... ${percent}%`,
        modelRepoId: modelName,
        percent,
        downloadedBytes,
        totalBytes,
      });
    });

    response.pipe(fileStream);

    fileStream.on("finish", () => {
      this.activeDownload = null;
      console.log(`Model ${modelName} downloaded successfully to ${filePath}`);
      onLog?.(`Download completed: ${modelName}`);

      onProgress?.({
        status: "complete",
        message: "Model downloaded successfully",
        modelRepoId: modelName,
        percent: 100,
      });

      resolve?.(true);
    });

    fileStream.on("error", (error) => {
      this.activeDownload = null;
      console.error(`File write error: ${error.message}`);
      onProgress?.({
        status: "error",
        message: `Download failed: ${error.message}`,
        modelRepoId: modelName,
      });
      reject?.(error);
    });

    response.on("error", (error: Error) => {
      this.activeDownload = null;
      console.error(`Download error: ${error.message}`);
      onProgress?.({
        status: "error",
        message: `Download failed: ${error.message}`,
        modelRepoId: modelName,
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
    onLog?: (line: string) => void
  ): Promise<boolean> {
    this.ensureDataDirectory();
    return this.downloadModelFile(modelName, onProgress, onLog);
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
    this.activeDownload = null;
  }
}
