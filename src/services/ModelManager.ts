import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { app } from "electron";
import { spawn } from "child_process";
import { AppConfig } from "../config/AppConfig";

export class ModelManager {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  private getModelsDir(): string {
    return this.config.modelPath || join(__dirname, "../../models");
  }

  private ensureModelsDirectory(): void {
    const modelsDir = this.getModelsDir();
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
    }
  }

  async ensureModelExists(modelSize: string): Promise<boolean> {
    this.ensureModelsDirectory();
    const modelPath = join(this.getModelsDir(), `${modelSize}.pt`);
    if (existsSync(modelPath)) {
      return true;
    }
    return await this.downloadModel(modelSize);
  }

  private async downloadModel(modelSize: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Use WhisperLive's downloader
      const pythonScript = join(__dirname, "../../python/download_model.py");
      const modelsDir = this.getModelsDir();

      const process = spawn(
        "python3",
        [pythonScript, "--model", modelSize, "--output", modelsDir],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      process.stdout?.on("data", (data) => {
        console.log("Model download output:", data.toString());
      });

      process.stderr?.on("data", (data) => {
        // console.error("Model download error:", data.toString());
      });

      process.on("close", (code) => {
        const modelPath = join(modelsDir, `${modelSize}.pt`);
        if (code === 0 && existsSync(modelPath)) {
          console.log(`Model ${modelSize} downloaded successfully`);
          resolve(true);
        } else {
          console.error(`Model download failed with code ${code}`);
          reject(new Error(`Model download failed with code ${code}`));
        }
      });
    });
  }
}
