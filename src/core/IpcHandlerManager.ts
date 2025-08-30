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
import { PermissionsManager } from "../services/PermissionsManager";

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
    private permissionsManager: PermissionsManager,
    private onStartDictation: () => Promise<void>,
    private onStopDictation: () => Promise<void>,
    private onFinishDictation: () => Promise<void>,
    private onCancelDictation: () => Promise<void>,
    private onOnboardingComplete?: () => void,
  ) { }

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

    // Remove all dictation handlers
    ipcMain.removeAllListeners("start-dictation");
    ipcMain.removeAllListeners("stop-dictation");
    ipcMain.removeAllListeners("cancel-dictation");
    ipcMain.removeAllListeners("close-dictation-window");
    ipcMain.removeAllListeners("download-model");

    // Remove all plugin handlers
    ipcMain.removeHandler("plugin:switch");
    ipcMain.removeHandler("unified:isDownloading");

    // Remove all onboarding handlers
    ipcMain.removeHandler("onboarding:getInitialState");
    ipcMain.removeHandler("onboarding:getPluginSchemas");
    ipcMain.removeHandler("onboarding:getPluginOptions");
    ipcMain.removeHandler("onboarding:getCurrentPluginInfo");
    ipcMain.removeHandler("onboarding:checkAccessibility");
    ipcMain.removeHandler("onboarding:resetAccessibilityCache");
    ipcMain.removeHandler("onboarding:checkMicrophone");
    ipcMain.removeHandler("onboarding:resetMicrophoneCache");
    ipcMain.removeHandler("onboarding:setPlugin");
    ipcMain.removeHandler("onboarding:setAiEnabled");
    ipcMain.removeHandler("onboarding:setAiProvider");
    ipcMain.removeHandler("onboarding:saveApiKey");
    ipcMain.removeHandler("onboarding:complete");
    ipcMain.removeHandler("onboarding:runSetup");

    // Settings handlers are cleaned up by SettingsService

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
      console.log("Closing dictation window via IPC, finishing flow...");
      this.onFinishDictation();
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
              },
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
      },
    );
  }

  private setupPluginHandlers(): void {
    ipcMain.handle(
      "plugin:switch",
      async (event, payload: { pluginName: string; modelName?: string }) => {
        try {
          const { pluginName, modelName } = payload;
          console.log(
            `Switching to plugin: ${pluginName}, model: ${modelName}`,
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
            onLog,
          );

          return { success };
        } catch (error: any) {
          console.error("Plugin switch error:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
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
    ipcMain.handle("onboarding:getInitialState", () => {
      const activePlugin = this.config.get("transcriptionPlugin") || "yap";
      const pluginOptions =
        this.transcriptionPluginManager.getPluginOptions(activePlugin) || {};

      return {
        ai: this.config.ai,
        plugin: activePlugin,
        pluginOptions: JSON.parse(JSON.stringify(pluginOptions)),
      };
    });

    ipcMain.handle("onboarding:getPluginSchemas", () => {
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

      const schemas = this.transcriptionPluginManager.getAllPluginSchemas();

      return {
        plugins,
        schemas,
      };
    });

    // Get plugin options for onboarding
    ipcMain.handle(
      "onboarding:getPluginOptions",
      async (event, pluginName: string) => {
        try {
          return await this.transcriptionPluginManager.getPluginOptions(
            pluginName,
          );
        } catch (error) {
          console.error(
            `Error getting options for plugin ${pluginName}:`,
            error,
          );
          throw error;
        }
      },
    );

    // Schema and options handlers - these are handled by SettingsService

    ipcMain.handle("onboarding:getCurrentPluginInfo", () => {
      const activePlugin = this.transcriptionPluginManager.getActivePlugin();
      if (!activePlugin) {
        return { hasSkipTransformation: false };
      }

      const criteria = activePlugin.getActivationCriteria();
      return {
        hasSkipTransformation: criteria.skipTransformation || false,
        pluginName: activePlugin.name,
        displayName: activePlugin.displayName,
      };
    });
  }

  private setupOnboardingActionHandlers(): void {
    ipcMain.handle("onboarding:checkAccessibility", async () => {
      console.log("IPC:onboarding:checkAccessibility invoked");
      const startedAt = Date.now();
      try {
        const result = await this.permissionsManager.checkAccessibilityPermissions();
        const durationMs = Date.now() - startedAt;
        console.log(
          "IPC:onboarding:checkAccessibility result",
          JSON.stringify({ ok: result.granted, durationMs }),
        );
        return result.granted;
      } catch (error: any) {
        const durationMs = Date.now() - startedAt;
        console.error(
          "IPC:onboarding:checkAccessibility error",
          JSON.stringify({
            message: error?.message || String(error),
            durationMs,
          }),
        );
        throw error;
      }
    });

    ipcMain.handle("onboarding:resetAccessibilityCache", () => {
      console.log("IPC:onboarding:resetAccessibilityCache invoked");
      this.permissionsManager.resetCaches();
      return true;
    });

    ipcMain.handle("onboarding:checkMicrophone", async () => {
      try {
        const result = await this.permissionsManager.checkMicrophonePermissions();
        return result.granted;
      } catch (error: any) {
        console.error("IPC:onboarding:checkMicrophone error", error);
        throw error;
      }
    });

    ipcMain.handle("onboarding:resetMicrophoneCache", () => {
      console.log("IPC:onboarding:resetMicrophoneCache invoked");
      this.permissionsManager.resetCaches();
      return true;
    });

    ipcMain.handle("onboarding:openSettings", async (_event, section?: string) => {
      try {
        this.settingsService.openSettingsWindow(section);
        return { success: true };
      } catch (error: any) {
        console.error("Failed to open settings:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("onboarding:openSystemPreferences", async (_event, type?: string) => {
      try {
        if (type === "accessibility") {
          await this.permissionsManager.openAccessibilityPreferences();
        } else if (type === "microphone") {
          await this.permissionsManager.openMicrophonePreferences();
        } else {
          await this.permissionsManager.openSystemPreferences();
        }
        return { success: true };
      } catch (error: any) {
        console.error("Failed to open system preferences:", error);
        return { success: false, error: error.message };
      }
    });

    // Legacy handlers removed - now using unified plugin system

    ipcMain.handle(
      "onboarding:setPlugin",
      async (
        _e,
        payload: { pluginName: string; options?: Record<string, any> },
      ) => {
        const { pluginName, options = {} } = payload;
        this.config.set("transcriptionPlugin", pluginName);

        // Store in settings manager for persistence
        const sm = this.settingsService.getSettingsManager();
        sm.set("transcriptionPlugin", pluginName);
        Object.keys(options).forEach((key) => {
          const settingKey = `plugin.${pluginName}.${key}`;
          sm.set(settingKey, options[key]);
        });
        sm.saveSettings();

        // Store in unified plugin config system
        const plugin = this.transcriptionPluginManager.getPlugin(pluginName);
        if (plugin) {
          const currentOptions = plugin.getOptions();
          plugin.setOptions({ ...currentOptions, ...options });
        }

        // Don't activate the plugin during onboarding - just store the configuration
        // Plugin will be activated after onboarding setup is complete
        console.log(
          `Configured plugin ${pluginName} for onboarding - activation will happen after setup`,
        );
      },
    );

    ipcMain.handle("onboarding:setAiEnabled", async (_e, enabled: boolean) => {
      // Check if current plugin has skipTransformation
      const activePlugin = this.transcriptionPluginManager.getActivePlugin();
      if (activePlugin) {
        const criteria = activePlugin.getActivationCriteria();
        if (criteria.skipTransformation) {
          // Plugin handles transformation internally, so AI enhancement is not needed
          console.log(
            `Plugin ${activePlugin.name} has skipTransformation, AI enhancement not needed`,
          );
          return { success: true, skipped: true };
        }
      }

      if (enabled) {
        const { AiValidationService } = await import(
          "../services/AiValidationService"
        );
        const validationService = new AiValidationService();
        const validationResult =
          await validationService.validateAiConfiguration(
            this.config.ai.baseUrl,
            this.config.ai.model,
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
              `Invalid AI configuration: ${validationResult.error}`,
            );
          }
        }

        this.settingsService.getSettingsManager().set("ai.baseUrl", baseUrl);
        this.settingsService.getSettingsManager().set("ai.model", model);
        this.settingsService.getSettingsManager().saveSettings();
        this.config.ai.baseUrl = baseUrl;
        this.config.ai.model = model;
      },
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
      },
    );

    ipcMain.handle("onboarding:complete", async () => {
      try {
        // Now activate the plugin after onboarding is complete
        const activePlugin = this.config.get("transcriptionPlugin") || "yap";
        const pluginOptions =
          (await this.transcriptionPluginManager.getPluginOptions(
            activePlugin,
          )) || {};

        await this.transcriptionPluginManager.setActivePlugin(
          activePlugin,
          pluginOptions,
        );

        // Mark onboarding complete and continue normal init
        this.settingsService
          .getSettingsManager()
          .set("onboardingComplete", true);
        this.settingsService.getSettingsManager().saveSettings();

        // Call the onboarding completion handler to continue initialization
        if (this.onOnboardingComplete) {
          this.onOnboardingComplete();
        }

        return { success: true };
      } catch (error: any) {
        console.error("Onboarding completion error:", error);
        return { success: false, error: error.message || "Completion failed" };
      }
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

        // Get the active plugin and its options
        const plugin = this.transcriptionPluginManager.getPlugin(activePlugin);
        if (!plugin) {
          throw new Error(`Plugin ${activePlugin} not found`);
        }

        // Get plugin configuration from the unified plugin config system
        const pluginOptions =
          (await this.transcriptionPluginManager.getPluginOptions(
            activePlugin,
          )) || {};

        // Let the plugin handle its own setup and model downloading
        if (plugin.ensureModelAvailable) {
          await plugin.ensureModelAvailable(pluginOptions, onProgress, sendLog);
        }

        event.sender.send("onboarding:progress", {
          status: "service-ready",
          message: `${plugin.displayName} ready`,
          percent: 100,
        });

        // Don't activate plugin here - wait until onboarding is complete

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
