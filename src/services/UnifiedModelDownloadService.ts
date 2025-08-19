import { EventEmitter } from "events";
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

    this.activeDownload = { plugin: pluginName, model: modelName };

    try {
      switch (pluginName) {
        case "whisper-cpp":
          return await this.ensureWhisperModel(modelName, onProgress, onLog);
        case "vosk":
          return await this.ensureVoskModel(modelName, onProgress, onLog);
        default:
          throw new Error(`Unsupported plugin: ${pluginName}`);
      }
    } finally {
      this.activeDownload = null;
    }
  }

  private async ensureWhisperModel(
    modelName: string,
    onProgress?: (progress: UnifiedModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    if (await this.modelManager.isModelDownloaded(modelName)) {
      onLog?.(`Whisper model ${modelName} already downloaded`);
      return true;
    }

    const wrappedProgress = onProgress
      ? (progress: ModelDownloadProgress) => {
          onProgress({ ...progress, pluginType: "whisper-cpp" });
        }
      : undefined;

    return await this.modelManager.downloadModel(
      modelName,
      wrappedProgress,
      onLog
    );
  }

  private async ensureVoskModel(
    modelName: string,
    onProgress?: (progress: UnifiedModelDownloadProgress) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    if (!this.transcriptionPluginManager) {
      throw new Error("Transcription plugin manager not available");
    }

    const voskPlugin = this.transcriptionPluginManager.getPlugin(
      "vosk"
    ) as VoskTranscriptionPlugin;
    if (!voskPlugin) {
      throw new Error("Vosk plugin not available");
    }

    // Check if model is already downloaded
    if (voskPlugin.isModelDownloaded(modelName)) {
      onLog?.(`Vosk model ${modelName} already downloaded`);
      return true;
    }

    const wrappedProgress = onProgress
      ? (progress: ModelDownloadProgress) => {
          onProgress({ ...progress, pluginType: "vosk" });
        }
      : undefined;

    // Use the Vosk plugin's ensureModelAvailable method
    return await voskPlugin.ensureModelAvailable(
      modelName,
      wrappedProgress,
      onLog
    );
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
