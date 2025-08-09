import { join } from "path";
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { spawn } from "child_process";
import { AppConfig } from "../config/AppConfig";

export type ModelDownloadProgress = {
  status: "starting" | "cloning" | "installing" | "complete" | "error";
  message: string;
  modelRepoId: string;
};

export class ModelManager {
  private config: AppConfig;

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

  private async ensureGitLFS(onLog?: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      // First check if git-lfs is installed
      const checkProcess = spawn("git", ["lfs", "version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      checkProcess.stdout?.on("data", (data) => {
        onLog?.(data.toString());
      });
      checkProcess.stderr?.on("data", (data) => {
        onLog?.(data.toString());
      });

      checkProcess.on("close", (code) => {
        if (code === 0) {
          // Git LFS is installed, just run git lfs install
          const installProcess = spawn("git", ["lfs", "install"], {
            stdio: ["ignore", "pipe", "pipe"],
          });

          installProcess.stdout?.on("data", (data) => {
            onLog?.(data.toString());
          });
          installProcess.stderr?.on("data", (data) => {
            onLog?.(data.toString());
          });

          installProcess.on("close", (installCode) => {
            if (installCode === 0) {
              console.log("Git LFS initialized successfully");
              resolve();
            } else {
              console.error("Failed to initialize Git LFS");
              reject(new Error("Failed to initialize Git LFS"));
            }
          });

          installProcess.on("error", (error) => {
            console.error(`Failed to run git lfs install: ${error.message}`);
            reject(error);
          });
        } else {
          // Git LFS not installed, install via brew
          console.log("Git LFS not found, installing via brew...");
          const brewProcess = spawn("brew", ["install", "git-lfs"], {
            stdio: ["ignore", "pipe", "pipe"],
          });

          brewProcess.stdout?.on("data", (data) => {
            console.log("Brew install output:", data.toString());
            onLog?.(data.toString());
          });

          brewProcess.stderr?.on("data", (data) => {
            console.log("Brew install progress:", data.toString());
            onLog?.(data.toString());
          });

          brewProcess.on("close", (brewCode) => {
            if (brewCode === 0) {
              // Now run git lfs install
              const installProcess = spawn("git", ["lfs", "install"], {
                stdio: ["ignore", "pipe", "pipe"],
              });

              installProcess.stdout?.on("data", (data) => {
                onLog?.(data.toString());
              });
              installProcess.stderr?.on("data", (data) => {
                onLog?.(data.toString());
              });

              installProcess.on("close", (installCode) => {
                if (installCode === 0) {
                  console.log("Git LFS installed and initialized successfully");
                  resolve();
                } else {
                  console.error(
                    "Failed to initialize Git LFS after installation"
                  );
                  reject(
                    new Error("Failed to initialize Git LFS after installation")
                  );
                }
              });

              installProcess.on("error", (error) => {
                console.error(
                  `Failed to run git lfs install: ${error.message}`
                );
                reject(error);
              });
            } else {
              console.error("Failed to install Git LFS via brew");
              reject(new Error("Failed to install Git LFS via brew"));
            }
          });

          brewProcess.on("error", (error) => {
            console.error(`Failed to start brew install: ${error.message}`);
            reject(error);
          });
        }
      });

      checkProcess.on("error", (error) => {
        console.error(`Failed to check git lfs version: ${error.message}`);
        reject(error);
      });
    });
  }

  async ensureModelExists(
    modelRepoId: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    this.ensureDataDirectory();
    const modelDir = this.getModelPath(modelRepoId);
    if (existsSync(modelDir)) {
      return true;
    }

    // Ensure Git LFS is available before cloning
    await this.ensureGitLFS(onLog);

    return await this.cloneModel(modelRepoId, onProgress, onLog);
  }

  private getModelPath(modelRepoId: string): string {
    // Convert repo ID to safe directory name (e.g., "Systran/faster-whisper-tiny.en" -> "Systran--faster-whisper-tiny.en")
    const safeName = modelRepoId.replace(/\//g, "--");
    return join(this.config.getModelsDir(), safeName);
  }

  private async cloneModel(
    modelRepoId: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const modelDir = this.getModelPath(modelRepoId);
      const huggingfaceUrl = `https://huggingface.co/${modelRepoId}`;

      console.log(
        `Cloning HuggingFace model ${modelRepoId} from ${huggingfaceUrl}`
      );

      onProgress?.({
        status: "starting",
        message: "Preparing to download model...",
        modelRepoId,
      });

      const process = spawn("git", ["clone", huggingfaceUrl, modelDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      onProgress?.({
        status: "cloning",
        message: "Downloading model files...",
        modelRepoId,
      });

      process.stdout?.on("data", (data) => {
        const line = data.toString();
        console.log("Model clone output:", line);
        onLog?.(line);
      });

      process.stderr?.on("data", (data) => {
        const line = data.toString();
        console.log("Model clone progress:", line);
        onLog?.(line);
      });

      process.on("close", (code) => {
        if (code === 0 && existsSync(modelDir)) {
          console.log(
            `Model ${modelRepoId} cloned successfully to ${modelDir}`
          );
          onProgress?.({
            status: "complete",
            message: "Model downloaded successfully",
            modelRepoId,
          });
          resolve(true);
        } else {
          console.error(`Model clone failed with code ${code}`);
          onProgress?.({
            status: "error",
            message: `Download failed with code ${code}`,
            modelRepoId,
          });
          reject(new Error(`Model clone failed with code ${code}`));
        }
      });

      process.on("error", (error) => {
        console.error(`Failed to start git clone: ${error.message}`);
        onProgress?.({
          status: "error",
          message: `Download failed: ${error.message}`,
          modelRepoId,
        });
        onLog?.(String(error.message || error));
        reject(error);
      });
    });
  }

  getModelDirectory(modelRepoId: string): string {
    return this.getModelPath(modelRepoId);
  }

  async downloadModel(
    modelRepoId: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    return this.cloneModel(modelRepoId, onProgress, onLog);
  }

  /** List downloaded models and their sizes (in bytes). */
  listDownloadedModels(): Array<{
    repoId: string;
    dirPath: string;
    sizeBytes: number;
  }> {
    const modelsDir = this.config.getModelsDir();
    if (!existsSync(modelsDir)) return [];
    const entries = readdirSync(modelsDir, { withFileTypes: true });
    const result: Array<{
      repoId: string;
      dirPath: string;
      sizeBytes: number;
    }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(modelsDir, entry.name);
      const repoId = entry.name.replace(/--/g, "/");
      result.push({
        repoId,
        dirPath,
        sizeBytes: this.getDirectorySize(dirPath),
      });
    }
    return result;
  }

  deleteModel(repoId: string): void {
    const dir = this.getModelDirectory(repoId);
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error("Failed to delete model directory:", dir, e);
    }
  }

  private getDirectorySize(dirPath: string): number {
    try {
      let total = 0;
      const stack: string[] = [dirPath];
      while (stack.length) {
        const current = stack.pop() as string;
        const items = readdirSync(current, { withFileTypes: true });
        for (const item of items) {
          const p = join(current, item.name);
          if (item.isDirectory()) stack.push(p);
          else total += statSync(p).size;
        }
      }
      return total;
    } catch (e) {
      return 0;
    }
  }
}
