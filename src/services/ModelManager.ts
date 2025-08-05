import { join } from "path";
import { existsSync, mkdirSync } from "fs";
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

  private async ensureGitLFS(): Promise<void> {
    return new Promise((resolve, reject) => {
      // First check if git-lfs is installed
      const checkProcess = spawn("git", ["lfs", "version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      checkProcess.on("close", (code) => {
        if (code === 0) {
          // Git LFS is installed, just run git lfs install
          const installProcess = spawn("git", ["lfs", "install"], {
            stdio: ["ignore", "pipe", "pipe"],
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
          });

          brewProcess.stderr?.on("data", (data) => {
            console.log("Brew install progress:", data.toString());
          });

          brewProcess.on("close", (brewCode) => {
            if (brewCode === 0) {
              // Now run git lfs install
              const installProcess = spawn("git", ["lfs", "install"], {
                stdio: ["ignore", "pipe", "pipe"],
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
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<boolean> {
    this.ensureDataDirectory();
    const modelDir = this.getModelPath(modelRepoId);
    if (existsSync(modelDir)) {
      return true;
    }

    // Ensure Git LFS is available before cloning
    await this.ensureGitLFS();

    return await this.cloneModel(modelRepoId, onProgress);
  }

  private getModelPath(modelRepoId: string): string {
    // Convert repo ID to safe directory name (e.g., "Systran/faster-whisper-tiny.en" -> "Systran--faster-whisper-tiny.en")
    const safeName = modelRepoId.replace(/\//g, "--");
    return join(this.config.getModelsDir(), safeName);
  }

  private async cloneModel(
    modelRepoId: string,
    onProgress?: (progress: ModelDownloadProgress) => void
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
        console.log("Model clone output:", data.toString());
      });

      process.stderr?.on("data", (data) => {
        console.log("Model clone progress:", data.toString());
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
        reject(error);
      });
    });
  }

  getModelDirectory(modelRepoId: string): string {
    return this.getModelPath(modelRepoId);
  }

  async downloadModel(
    modelRepoId: string,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<boolean> {
    return this.cloneModel(modelRepoId, onProgress);
  }
}
