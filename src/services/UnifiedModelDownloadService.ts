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
    onLog?: (line: string) => void,
  ): Promise<boolean> {
    if (this.activeDownload) {
      throw new Error(
        `Another model (${this.activeDownload.plugin}:${this.activeDownload.model}) is already downloading`,
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

      // Use the plugin's ensureModelAvailable method if available, otherwise downloadModel
      if (plugin.ensureModelAvailable) {
        await plugin.ensureModelAvailable(
          { model: modelName },
          wrappedProgress,
          onLog,
        );
      } else if ((plugin as any).downloadModel) {
        await (plugin as any).downloadModel(modelName, uiFunctions);
      } else {
        throw new Error(
          `Plugin ${pluginName} does not support model downloads`,
        );
      }
      return true;
    } finally {
      this.activeDownload = null;
    }
  }

  async switchToPlugin(
    pluginName: string,
    modelName?: string,
    onProgress?: (progress: UnifiedModelDownloadProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<boolean> {
    if (!this.transcriptionPluginManager) {
      throw new Error("Transcription plugin manager not available");
    }

    onLog?.(`Switching to ${pluginName} plugin`);

    // Get plugin and its options from the unified config system
    const plugin = this.transcriptionPluginManager.getPlugin(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    const pluginConfig = this.config.getPluginConfig();
    const pluginOptions = pluginConfig[pluginName] || {};

    // Use provided model name or get from plugin options
    if (modelName) {
      pluginOptions.model = modelName;
    }

    // Let the plugin handle its own model setup if it supports it
    if (plugin.ensureModelAvailable) {
      await plugin.ensureModelAvailable(pluginOptions, onProgress, onLog);
    }

    // Switch to the plugin (re-check availability inside setActivePlugin)
    await this.transcriptionPluginManager.setActivePlugin(
      pluginName,
      pluginOptions,
    );
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
