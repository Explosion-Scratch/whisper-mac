import { EventEmitter } from "events";
import { join } from "path";
import { existsSync } from "fs";
import { AppConfig } from "../config/AppConfig";
import { ModelManager, ModelDownloadProgress } from "./ModelManager";
import { VoskTranscriptionPlugin } from "../plugins/VoskTranscriptionPlugin";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";

export interface UnifiedModelDownloadProgress extends ModelDownloadProgress {
  pluginType: "whisper-cpp" | "vosk";
}

export class UnifiedModelDownloadService extends EventEmitter {
  private config: AppConfig;
  private modelManager: ModelManager;
  private transcriptionPluginManager: TranscriptionPluginManager | null = null;
  private activeDownload: { plugin: string; model: string } | null = null;

  constructor(config: AppConfig, modelManager: ModelManager) {
    super();
    this.config = config;
    this.modelManager = modelManager;
  }

  setTranscriptionPluginManager(manager: TranscriptionPluginManager): void {
    this.transcriptionPluginManager = manager;
  }

  async ensureModelForPlugin(
    pluginName: string,
    modelName: string,
    onProgress?: (progress: UnifiedModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    if (this.activeDownload) {
      throw new Error(
        `Another model (${this.activeDownload.plugin}:${this.activeDownload.model}) is already downloading`
      );
    }

    if (!this.transcriptionPluginManager) {
      throw new Error("Transcription plugin manager not available");
    }

    const plugin = this.transcriptionPluginManager.getPlugin(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not available`);
    }

    // YAP doesn't need model downloads
    if (pluginName === "yap") {
      onLog?.(`YAP plugin doesn't require model downloads`);
      return true;
    }

    this.activeDownload = { plugin: pluginName, model: modelName };

    try {
      const wrappedProgress = onProgress
        ? (progress: ModelDownloadProgress) => {
            onProgress({ ...progress, pluginType: pluginName as any });
          }
        : undefined;

      // Create unified UI functions interface for the plugin
      const uiFunctions = {
        showProgress: (message: string, percent: number) => {
          wrappedProgress?.({
            status: "downloading",
            progress: percent,
            message,
            modelRepoId: modelName,
          });
        },
        hideProgress: () => {},
        showDownloadProgress: (progress: ModelDownloadProgress) => {
          wrappedProgress?.(progress);
        },
        showError: (error: string) => {
          onLog?.(`Error: ${error}`);
        },
        showSuccess: (message: string) => {
          onLog?.(message);
        },
        confirmAction: async (message: string) => true,
      };

      // Use the plugin's download method - each plugin handles its own requirements
      await (plugin as any).downloadModel(modelName, uiFunctions);
      return true;
    } finally {
      this.activeDownload = null;
    }
  }

  async switchToPlugin(
    pluginName: string,
    modelName?: string,
    onProgress?: (progress: UnifiedModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    if (!this.transcriptionPluginManager) {
      throw new Error("Transcription plugin manager not available");
    }

    onLog?.(`Switching to ${pluginName} plugin`);

    // Determine the model name based on plugin
    let targetModel = modelName;
    if (!targetModel) {
      switch (pluginName) {
        case "whisper-cpp":
          targetModel =
            this.config.get("whisperCppModel") || "ggml-base.en.bin";
          break;
        case "vosk":
          targetModel =
            this.config.get("voskModel") || "vosk-model-small-en-us-0.15";
          break;
        case "yap":
          // YAP doesn't need model downloads
          break;
        default:
          throw new Error(`Unknown plugin: ${pluginName}`);
      }
    }

    // Download model if needed (except for YAP)
    if (pluginName !== "yap" && targetModel) {
      const downloaded = await this.ensureModelForPlugin(
        pluginName,
        targetModel,
        onProgress,
        onLog
      );

      if (!downloaded) {
        throw new Error(`Failed to download model for ${pluginName}`);
      }
    }

    // Switch to the plugin (re-check availability inside setActivePlugin)
    await this.transcriptionPluginManager.setActivePlugin(pluginName);
    this.config.set("transcriptionPlugin", pluginName);

    onLog?.(`Successfully switched to ${pluginName} plugin`);
    return true;
  }

  isDownloading(): boolean {
    return this.activeDownload !== null || this.modelManager.isDownloading();
  }

  getCurrentDownload(): { plugin: string; model: string } | null {
    if (this.activeDownload) {
      return this.activeDownload;
    }

    const whisperDownload = this.modelManager.getCurrentDownload();
    if (whisperDownload) {
      return { plugin: "whisper-cpp", model: whisperDownload };
    }

    return null;
  }
}
