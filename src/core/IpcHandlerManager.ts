import { ipcMain } from "electron";
import { TranscriptionPluginManager } from "../plugins";
import { UnifiedModelDownloadService } from "../services/UnifiedModelDownloadService";
import { TextInjectionService } from "../services/TextInjectionService";
import { SettingsService } from "../services/SettingsService";
import { AppConfig } from "../config/AppConfig";
import { SettingsManager } from "../config/SettingsManager";
import { DefaultActionsConfig } from "../types/ActionTypes";
import { ErrorManager } from "./ErrorManager";
import { AppStateManager } from "./AppStateManager";

export class IpcHandlerManager {
  constructor(
    private transcriptionPluginManager: TranscriptionPluginManager,
    private unifiedModelDownloadService: UnifiedModelDownloadService,
    private textInjector: TextInjectionService,
    private settingsService: SettingsService,
    private config: AppConfig,
    private settingsManager: SettingsManager,
    private errorManager: ErrorManager,
    private appStateManager: AppStateManager,
    private onStartDictation: () => Promise<void>,
    private onStopDictation: () => Promise<void>,
    private onCancelDictation: () => Promise<void>,
    private onOnboardingComplete?: () => void
  ) {}

  setupIpcHandlers(): void {
    this.setupDictationHandlers();
    this.setupModelDownloadHandlers();
    this.setupPluginHandlers();
    console.log("IPC Handlers set up");
  }

  setupOnboardingIpc(): void {
    this.setupOnboardingStateHandlers();
    this.setupOnboardingActionHandlers();
    this.setupOnboardingSetupHandlers();
  }

  cleanupIpcHandlers(): void {
    console.log("=== Cleaning up IPC handlers ===");

    ipcMain.removeAllListeners("start-dictation");
    ipcMain.removeAllListeners("stop-dictation");
    ipcMain.removeAllListeners("cancel-dictation");
    ipcMain.removeAllListeners("close-dictation-window");
    ipcMain.removeAllListeners("download-model");

    console.log("=== IPC handlers cleaned up ===");
  }

  private setupDictationHandlers(): void {
    ipcMain.on("start-dictation", async (event: Electron.IpcMainEvent) => {
      await this.onStartDictation();
      event.reply("dictation-started");
    });

    ipcMain.on("stop-dictation", async (event: Electron.IpcMainEvent) => {
      await this.onStopDictation();
      event.reply("dictation-stopped");
    });

    ipcMain.on("cancel-dictation", async () => {
      console.log("Cancelling dictation via IPC...");
      await this.onCancelDictation();
    });

    ipcMain.on("close-dictation-window", () => {
      console.log("Closing dictation window via IPC, cancelling flow...");
      this.onCancelDictation();
    });
  }

  private setupModelDownloadHandlers(): void {
    ipcMain.on(
      "download-model",
      async (event: Electron.IpcMainEvent, modelRepoId: string) => {
        try {
          console.log(`Starting download of model: ${modelRepoId}`);
          this.appStateManager.setSetupStatus("downloading-models");
          event.reply("download-model-progress", {
            status: "starting",
            modelRepoId,
          });

          const activePlugin =
            this.config.get("transcriptionPlugin") || "whisper-cpp";

          const success =
            await this.unifiedModelDownloadService.ensureModelForPlugin(
              activePlugin,
              modelRepoId,
              (progress) => {
                if (progress.status === "starting") {
                  this.appStateManager.setSetupStatus("downloading-models");
                } else if (progress.status === "downloading") {
                  this.appStateManager.setSetupStatus("downloading-models");
                } else if (progress.status === "complete") {
                  this.appStateManager.setSetupStatus("idle");
                } else if (progress.status === "error") {
                  this.appStateManager.setSetupStatus("idle");
                }

                event.reply("download-model-progress", {
                  status: progress.status,
                  modelRepoId: progress.modelRepoId,
                  message: progress.message,
                });
              }
            );

          if (success) {
            event.reply("download-model-complete", {
              status: "success",
              modelRepoId,
            });
          } else {
            event.reply("download-model-complete", {
              status: "error",
              modelRepoId,
              error: "Download failed",
            });
          }
        } catch (error) {
          console.error("Model download error:", error);
          event.reply("download-model-complete", {
            status: "error",
            modelRepoId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        } finally {
          this.appStateManager.setSetupStatus("idle");
        }
      }
    );
  }

  private setupPluginHandlers(): void {
    ipcMain.handle(
      "plugin:switch",
      async (event, payload: { pluginName: string; modelName?: string }) => {
        try {
          const { pluginName, modelName } = payload;
          console.log(
            `Switching to plugin: ${pluginName}, model: ${modelName}`
          );

          const onProgress = (progress: any) => {
            event.sender.send("plugin:switchProgress", progress);
          };

          const onLog = (line: string) => {
            event.sender.send("plugin:switchLog", { line });
          };

          const success = await this.unifiedModelDownloadService.switchToPlugin(
            pluginName,
            modelName,
            onProgress,
            onLog
          );

          return { success };
        } catch (error: any) {
          console.error("Plugin switch error:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    ipcMain.handle("unified:isDownloading", async () => {
      const isDownloading = this.unifiedModelDownloadService.isDownloading();
      const currentDownload =
        this.unifiedModelDownloadService.getCurrentDownload();
      return {
        isDownloading,
        currentDownload,
      };
    });
  }

  private setupOnboardingStateHandlers(): void {
    ipcMain.handle("onboarding:getInitialState", () => ({
      ai: this.config.ai,
      model: this.config.get("whisperCppModel") || "ggml-base.en.bin",
      voskModel: this.config.get("voskModel") || "vosk-model-small-en-us-0.15",
      plugin: this.config.get("transcriptionPlugin") || "yap",
    }));

    ipcMain.handle("onboarding:getPluginOptions", () => {
      const plugins = this.transcriptionPluginManager
        .getPlugins()
        .map((plugin) => ({
          name: plugin.name,
          displayName: plugin.displayName,
          description: plugin.description,
          version: plugin.version,
          supportsRealtime: plugin.supportsRealtime,
          supportsBatchProcessing: plugin.supportsBatchProcessing,
        }));

      const options = this.transcriptionPluginManager.getAllPluginOptions();

      return {
        plugins,
        options,
      };
    });
  }

  private setupOnboardingActionHandlers(): void {
    ipcMain.handle("onboarding:checkAccessibility", async () => {
      const ok = await this.textInjector.ensureAccessibilityPermissions();
      return ok;
    });

    ipcMain.handle("onboarding:resetAccessibilityCache", () => {
      this.textInjector.resetAccessibilityCache();
      return true;
    });

    ipcMain.handle("onboarding:setModel", (_e, modelName: string) => {
      this.config.set("whisperCppModel", modelName);

      const sm = this.settingsService.getSettingsManager();
      sm.set("plugin.whisper-cpp.model", modelName);
      sm.saveSettings();

      const whisperPlugin =
        this.transcriptionPluginManager.getPlugin("whisper-cpp");
      if (whisperPlugin && "updateModelPath" in whisperPlugin) {
        (whisperPlugin as any).updateModelPath();
      }
    });

    ipcMain.handle("onboarding:setVoskModel", (_e, modelName: string) => {
      this.config.set("voskModel", modelName);

      const sm = this.settingsService.getSettingsManager();
      sm.set("plugin.vosk.model", modelName);
      sm.saveSettings();

      const voskPlugin = this.transcriptionPluginManager.getPlugin("vosk");
      if (voskPlugin) {
        voskPlugin.configure({ model: modelName });
      }
    });

    ipcMain.handle(
      "onboarding:setPlugin",
      async (
        _e,
        payload: { pluginName: string; options?: Record<string, any> }
      ) => {
        const { pluginName, options = {} } = payload;
        this.config.set("transcriptionPlugin", pluginName);

        const sm = this.settingsService.getSettingsManager();
        sm.set("transcriptionPlugin", pluginName);
        Object.keys(options).forEach((key) => {
          const settingKey = `plugin.${pluginName}.${key}`;
          sm.set(settingKey, options[key]);
        });
        sm.saveSettings();

        try {
          await this.transcriptionPluginManager.setActivePlugin(
            pluginName,
            options
          );
        } catch {}
      }
    );

    ipcMain.handle("onboarding:setAiEnabled", async (_e, enabled: boolean) => {
      if (enabled) {
        const { AiValidationService } = await import(
          "../services/AiValidationService"
        );
        const validationService = new AiValidationService();
        const validationResult =
          await validationService.validateAiConfiguration(
            this.config.ai.baseUrl,
            this.config.ai.model
          );

        if (!validationResult.isValid) {
          throw new Error(`Cannot enable AI: ${validationResult.error}`);
        }
      }

      this.settingsService.getSettingsManager().set("ai.enabled", enabled);
      this.settingsService.getSettingsManager().saveSettings();
      this.config.ai.enabled = enabled;
    });

    ipcMain.handle(
      "onboarding:setAiProvider",
      async (_e, payload: { baseUrl: string; model: string }) => {
        const { baseUrl, model } = payload;

        if (this.config.ai.enabled) {
          const { AiValidationService } = await import(
            "../services/AiValidationService"
          );
          const validationService = new AiValidationService();
          const validationResult =
            await validationService.validateAiConfiguration(baseUrl, model);

          if (!validationResult.isValid) {
            throw new Error(
              `Invalid AI configuration: ${validationResult.error}`
            );
          }
        }

        this.settingsService.getSettingsManager().set("ai.baseUrl", baseUrl);
        this.settingsService.getSettingsManager().set("ai.model", model);
        this.settingsService.getSettingsManager().saveSettings();
        this.config.ai.baseUrl = baseUrl;
        this.config.ai.model = model;
      }
    );

    ipcMain.handle(
      "onboarding:saveApiKey",
      async (_e, payload: { apiKey: string }) => {
        const { SecureStorageService } = await import(
          "../services/SecureStorageService"
        );
        const secure = new SecureStorageService();
        await secure.setApiKey(payload.apiKey);
        return { success: true };
      }
    );

    ipcMain.handle("onboarding:complete", async () => {
      // Mark onboarding complete and continue normal init
      this.settingsService.getSettingsManager().set("onboardingComplete", true);
      this.settingsService.getSettingsManager().saveSettings();

      // Call the onboarding completion handler to continue initialization
      if (this.onOnboardingComplete) {
        this.onOnboardingComplete();
      }

      return { success: true };
    });
  }

  private setupOnboardingSetupHandlers(): void {
    ipcMain.handle("onboarding:runSetup", async (event) => {
      try {
        const sendLog = (line: string) =>
          event.sender.send("onboarding:log", { line });

        const onProgress = (progress: any) => {
          event.sender.send("onboarding:progress", {
            status: "downloading-models",
            message:
              progress.message ||
              `Preparing ${progress.pluginType || "model"}...`,
            percent: progress.percent || 0,
          });
        };

        const activePlugin = this.config.get("transcriptionPlugin") || "yap";
        sendLog(`Setting up ${activePlugin} plugin`);

        if (activePlugin === "whisper-cpp") {
          const modelName =
            this.config.get("whisperCppModel") || "ggml-base.en.bin";

          await this.unifiedModelDownloadService.ensureModelForPlugin(
            "whisper-cpp",
            modelName,
            onProgress,
            sendLog
          );

          event.sender.send("onboarding:progress", {
            status: "service-ready",
            message: "Whisper.cpp ready",
            percent: 100,
          });
        } else if (activePlugin === "vosk") {
          const modelName =
            this.config.get("voskModel") || "vosk-model-small-en-us-0.15";

          await this.unifiedModelDownloadService.ensureModelForPlugin(
            "vosk",
            modelName,
            onProgress,
            sendLog
          );

          event.sender.send("onboarding:progress", {
            status: "service-ready",
            message: "Vosk ready",
            percent: 100,
          });
        } else {
          event.sender.send("onboarding:progress", {
            status: "service-ready",
            message: "YAP transcription ready",
            percent: 100,
          });
        }

        await this.transcriptionPluginManager.setActivePlugin(activePlugin);

        event.sender.send("onboarding:progress", {
          status: "complete",
          message: "Setup complete",
          percent: 100,
        });

        return { success: true };
      } catch (e: any) {
        event.sender.send("onboarding:progress", {
          status: "error",
          message: e?.message || "Setup failed",
        });
        return { success: false, error: e?.message };
      }
    });
  }
}
