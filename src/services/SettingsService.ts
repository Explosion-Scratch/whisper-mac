import { BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { AppConfig } from "../config/AppConfig";
import { SettingsManager } from "../config/SettingsManager";
import { SETTINGS_SCHEMA } from "../config/SettingsSchema";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { PluginUIFunctions } from "../plugins/TranscriptionPlugin";
import { UnifiedModelDownloadService } from "./UnifiedModelDownloadService";

export class SettingsService {
  private settingsWindow: BrowserWindow | null = null;
  private windowVisibilityCallbacks: Set<(visible: boolean) => void> =
    new Set();
  private settingsManager: SettingsManager;
  private config: AppConfig;
  private transcriptionPluginManager: TranscriptionPluginManager | null = null;
  private unifiedModelDownloadService: UnifiedModelDownloadService | null =
    null;

  constructor(config: AppConfig) {
    this.config = config;
    this.settingsManager = new SettingsManager(config);
    this.setupIpcHandlers();

    // Load existing settings on startup
    this.loadSettings();
  }

  /**
   * Set the transcription plugin manager reference
   */
  setTranscriptionPluginManager(manager: TranscriptionPluginManager): void {
    this.transcriptionPluginManager = manager;
  }

  setUnifiedModelDownloadService(service: UnifiedModelDownloadService): void {
    this.unifiedModelDownloadService = service;
  }

  private setupIpcHandlers(): void {
    // Get settings schema
    ipcMain.handle("settings:getSchema", () => {
      // Strip out validation functions since they can't be serialized through IPC
      // Also hide internal sections such as onboarding from the UI
      const serializableSchema = SETTINGS_SCHEMA.filter(
        (section) => section.id !== "onboarding"
      ).map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          const { validation, ...serializableField } = field;
          return serializableField;
        }),
      }));
      return serializableSchema;
    });

    // Get current settings
    ipcMain.handle("settings:get", () => {
      return this.settingsManager.getAll();
    });

    // Save settings
    ipcMain.handle(
      "settings:save",
      async (_event, settings: Record<string, any>) => {
        try {
          this.settingsManager.setAll(settings);
          this.settingsManager.saveSettings();
          this.settingsManager.applyToConfig();

          // Notify other windows about settings update
          this.broadcastSettingsUpdate();

          return { success: true };
        } catch (error) {
          console.error("Failed to save settings:", error);
          throw error;
        }
      }
    );

    // Reset all settings
    ipcMain.handle("settings:resetAll", async () => {
      try {
        this.settingsManager.reset();
        this.settingsManager.saveSettings();
        this.settingsManager.applyToConfig();

        this.broadcastSettingsUpdate();

        return this.settingsManager.getAll();
      } catch (error) {
        console.error("Failed to reset settings:", error);
        throw error;
      }
    });

    // Reset settings section
    ipcMain.handle(
      "settings:resetSection",
      async (_event, sectionId: string) => {
        try {
          this.settingsManager.resetSection(sectionId);
          this.settingsManager.saveSettings();
          this.settingsManager.applyToConfig();

          this.broadcastSettingsUpdate();

          return this.settingsManager.getAll();
        } catch (error) {
          console.error("Failed to reset settings section:", error);
          throw error;
        }
      }
    );

    // Import settings
    ipcMain.handle("settings:import", async (_event, filePath: string) => {
      try {
        const data = readFileSync(filePath, "utf8");
        this.settingsManager.importSettings(data);
        this.settingsManager.saveSettings();
        this.settingsManager.applyToConfig();

        this.broadcastSettingsUpdate();

        return this.settingsManager.getAll();
      } catch (error) {
        console.error("Failed to import settings:", error);
        throw error;
      }
    });

    // Export settings
    ipcMain.handle(
      "settings:export",
      async (_event, filePath: string, settings: Record<string, any>) => {
        try {
          const data = JSON.stringify(settings, null, 2);
          writeFileSync(filePath, data);
          return { success: true };
        } catch (error) {
          console.error("Failed to export settings:", error);
          throw error;
        }
      }
    );

    // File dialogs
    ipcMain.handle("dialog:showOpenDialog", async (_event, options) => {
      return dialog.showOpenDialog(options);
    });

    ipcMain.handle("dialog:showSaveDialog", async (_event, options) => {
      return dialog.showSaveDialog(options);
    });

    ipcMain.handle("dialog:showDirectoryDialog", async (_event, options) => {
      return dialog.showOpenDialog({
        ...options,
        properties: ["openDirectory"],
      });
    });

    // Close settings window
    ipcMain.handle("settings:closeWindow", () => {
      this.closeSettingsWindow();
    });

    // AI key validation and models listing
    ipcMain.handle(
      "ai:validateKeyAndListModels",
      async (_event, payload: { baseUrl: string; apiKey: string }) => {
        const { baseUrl, apiKey } = payload || { baseUrl: "", apiKey: "" };
        const { AiProviderService } = await import(
          "../services/AiProviderService"
        );
        const svc = new AiProviderService();
        return svc.validateAndListModels(baseUrl, apiKey);
      }
    );

    // Save API key securely from settings
    ipcMain.handle(
      "settings:saveApiKey",
      async (_e, payload: { apiKey: string }) => {
        const { SecureStorageService } = await import(
          "../services/SecureStorageService"
        );
        const secure = new SecureStorageService();
        await secure.setApiKey(payload.apiKey);
        return { success: true };
      }
    );

    // Get API key securely from settings
    ipcMain.handle("settings:getApiKey", async () => {
      const { SecureStorageService } = await import(
        "../services/SecureStorageService"
      );
      const secure = new SecureStorageService();
      return await secure.getApiKey();
    });

    // Model management helpers
    ipcMain.handle("models:listDownloaded", async () => {
      const { ModelManager } = await import("./ModelManager");
      const mgr = new ModelManager(this.config);
      return mgr.listDownloadedModels();
    });
    ipcMain.handle("models:delete", async (_e, repoIds: string[]) => {
      const { ModelManager } = await import("./ModelManager");
      const mgr = new ModelManager(this.config);
      for (const id of repoIds || []) mgr.deleteModel(id);
      return { success: true };
    });

    // Model downloading with progress
    ipcMain.handle("models:download", async (event, modelName: string) => {
      if (!this.unifiedModelDownloadService) {
        throw new Error("Unified model download service not available");
      }

      if (this.unifiedModelDownloadService.isDownloading()) {
        const currentDownload =
          this.unifiedModelDownloadService.getCurrentDownload();
        throw new Error(
          `Another model (${currentDownload?.plugin}:${currentDownload?.model}) is already downloading`
        );
      }

      const onProgress = (progress: any) => {
        event.sender.send("models:downloadProgress", progress);
      };

      const onLog = (line: string) => {
        event.sender.send("models:downloadLog", { line });
      };

      try {
        // Determine which plugin should handle this download
        const activePlugin =
          this.config.get("transcriptionPlugin") || "whisper-cpp";

        await this.unifiedModelDownloadService.ensureModelForPlugin(
          activePlugin,
          modelName,
          onProgress,
          onLog
        );
        return { success: true };
      } catch (error: any) {
        throw new Error(error.message || "Download failed");
      }
    });

    // Check if download is in progress
    ipcMain.handle("models:isDownloading", async () => {
      if (!this.unifiedModelDownloadService) {
        return {
          isDownloading: false,
          currentDownload: null,
        };
      }

      return {
        isDownloading: this.unifiedModelDownloadService.isDownloading(),
        currentDownload: this.unifiedModelDownloadService.getCurrentDownload(),
      };
    });

    // Handle plugin switching with model downloads
    ipcMain.handle(
      "settings:switchPlugin",
      async (event, payload: { pluginName: string; modelName?: string }) => {
        if (!this.unifiedModelDownloadService) {
          throw new Error("Unified model download service not available");
        }

        const { pluginName, modelName } = payload;

        const onProgress = (progress: any) => {
          event.sender.send("settings:pluginSwitchProgress", progress);
        };

        const onLog = (line: string) => {
          event.sender.send("settings:pluginSwitchLog", { line });
        };

        try {
          await this.unifiedModelDownloadService.switchToPlugin(
            pluginName,
            modelName,
            onProgress,
            onLog
          );

          // Save the active plugin setting
          this.settingsManager.set("transcriptionPlugin", pluginName);
          this.settingsManager.saveSettings();

          this.broadcastSettingsUpdate();
          return { success: true };
        } catch (error: any) {
          throw new Error(error.message || "Plugin switch failed");
        }
      }
    );

    // Unified plugin management handlers
    ipcMain.handle("plugins:getOptions", () => {
      if (!this.transcriptionPluginManager) {
        return { plugins: [], options: {} };
      }

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

    ipcMain.handle("plugins:getActive", () => {
      if (!this.transcriptionPluginManager) {
        return null;
      }
      return this.transcriptionPluginManager.getActivePlugin()?.name || null;
    });

    ipcMain.handle(
      "plugins:updateActiveOptions",
      async (event, payload: { options: Record<string, any> }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Transcription plugin manager not available");
        }

        const { options } = payload;

        try {
          // Provide UI functions for the plugin
          const uiFunctions: PluginUIFunctions = {
            showProgress: (message: string, percent: number) => {
              event.sender.send("settings:pluginOptionProgress", {
                message,
                percent,
              });
            },
            hideProgress: () => {
              event.sender.send("settings:pluginOptionProgress", {
                message: "",
                percent: 100,
              });
            },
            showDownloadProgress: (progress: any) => {
              event.sender.send("settings:pluginOptionProgress", progress);
            },
            showError: (error: string) => {
              event.sender.send("settings:pluginOptionLog", {
                line: `ERROR: ${error}`,
              });
            },
            showSuccess: (message: string) => {
              event.sender.send("settings:pluginOptionLog", {
                line: `SUCCESS: ${message}`,
              });
            },
            confirmAction: async (message: string) => {
              return true;
            },
          };

          await this.transcriptionPluginManager.updateActivePluginOptions(
            options,
            uiFunctions
          );

          // Save the updated plugin options to settings
          const activePlugin =
            this.transcriptionPluginManager.getActivePlugin();
          if (activePlugin) {
            const pluginName = activePlugin.name;
            Object.keys(options).forEach((key) => {
              const settingKey = `plugin.${pluginName}.${key}`;
              this.settingsManager.set(settingKey, options[key]);
            });
            this.settingsManager.saveSettings();
          }

          this.broadcastSettingsUpdate();
          return { success: true };
        } catch (error: any) {
          throw new Error(error.message || "Plugin option update failed");
        }
      }
    );

    ipcMain.handle(
      "plugins:deleteInactive",
      async (_event, payload: { pluginName: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Transcription plugin manager not available");
        }

        const { pluginName } = payload;
        const activePlugin = this.transcriptionPluginManager.getActivePlugin();

        if (activePlugin && activePlugin.name === pluginName) {
          throw new Error("Cannot delete the currently active plugin");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(pluginName);

        if (!plugin) {
          throw new Error(`Plugin ${pluginName} not found`);
        }

        try {
          await plugin.clearData();
          return { success: true };
        } catch (error: any) {
          throw new Error(error.message || "Failed to delete plugin");
        }
      }
    );

    // Get plugin data information
    ipcMain.handle(
      "settings:getPluginDataInfo",
      async (): Promise<
        Array<{
          name: string;
          displayName: string;
          isActive: boolean;
          dataSize: number;
          dataPath: string;
        }>
      > => {
        try {
          if (!this.transcriptionPluginManager) {
            throw new Error("Plugin manager not initialized");
          }
          return await this.transcriptionPluginManager.getPluginDataInfo();
        } catch (error: any) {
          console.error("Failed to get plugin data info:", error);
          throw new Error(error.message || "Failed to get plugin data info");
        }
      }
    );
  }

  private broadcastSettingsUpdate(): void {
    const settings = this.settingsManager.getAll();

    // Send to all windows (if any other windows exist)
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("settings:updated", settings);
      }
    });
  }

  openSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      try {
        if (this.settingsWindow.isMinimized()) {
          this.settingsWindow.restore();
        }
        // Ensure hidden window is shown on reopen
        this.settingsWindow.show();
        this.settingsWindow.focus();
      } catch {}
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      visualEffectState: "followWindow",
      titleBarStyle: "hidden", // Hide native title bar
      trafficLightPosition: { x: 10, y: 12 }, // Position traffic light buttons
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/settingsPreload.js"),
        backgroundThrottling: false, // Prevent background throttling for better vibrancy
      },
      show: false, // Don't show until ready-to-show
    });

    // Load the settings window HTML
    this.settingsWindow.loadFile(
      join(__dirname, "../renderer/settingsWindow.html")
    );

    // Show window when ready
    this.settingsWindow.once("ready-to-show", () => {
      this.settingsWindow?.show();
      this.emitWindowVisibility(true);
    });

    // Clean up when window is closed
    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
      this.emitWindowVisibility(false);
    });

    // Handle window close button
    this.settingsWindow.on("close", (event) => {
      // Hide instead of close on macOS (standard behavior)
      if (process.platform === "darwin") {
        event.preventDefault();
        this.settingsWindow?.hide();
        this.emitWindowVisibility(false);
      }
    });
  }

  closeSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
    }
  }

  /**
   * Register a callback to be notified when the settings window visibility changes.
   * Returns an unsubscribe function.
   */
  onWindowVisibilityChange(callback: (visible: boolean) => void): () => void {
    this.windowVisibilityCallbacks.add(callback);
    return () => this.windowVisibilityCallbacks.delete(callback);
  }

  private emitWindowVisibility(visible: boolean) {
    this.windowVisibilityCallbacks.forEach((cb) => {
      try {
        cb(visible);
      } catch (e) {}
    });
  }

  /**
   * Returns whether the settings window is currently visible.
   */
  isWindowVisible(): boolean {
    return !!(
      this.settingsWindow &&
      !this.settingsWindow.isDestroyed() &&
      this.settingsWindow.isVisible()
    );
  }

  cleanup(): void {
    console.log("=== Cleaning up SettingsService ===");

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      console.log("Destroying settings window...");
      this.settingsWindow.destroy();
    }

    this.settingsWindow = null;

    console.log("=== SettingsService cleanup completed ===");
  }

  private loadSettings(): void {
    // Load settings from disk and apply to config
    this.settingsManager.applyToConfig();
  }

  getSettingsManager(): SettingsManager {
    return this.settingsManager;
  }

  // Method to get current settings (useful for other services)
  getCurrentSettings(): Record<string, any> {
    return this.settingsManager.getAll();
  }

  /** Utility to ensure at least one Whisper model exists. */
  ensureDefaultModelGuard(modelManager: {
    listDownloadedModels: () => any[];
  }): {
    ok: boolean;
    message?: string;
  } {
    const downloaded = modelManager.listDownloadedModels();
    if (!downloaded || downloaded.length === 0) {
      return {
        ok: false,
        message:
          "At least one transcription model must be downloaded for the app to work.",
      };
    }
    return { ok: true };
  }

  /**
   * Before changing the default model, prompt about deleting older models.
   * The caller should present a dialog to the user with names and sizes and then call deleteModelsIfConfirmed.
   */
  formatDownloadedModelsForPrompt(
    models: Array<{ repoId: string; sizeBytes: number }>
  ): string {
    const fmt = (n: number) => {
      const units = ["B", "KB", "MB", "GB"];
      let i = 0;
      let v = n;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${v.toFixed(1)} ${units[i]}`;
    };
    return models.map((m) => `${m.repoId} — ${fmt(m.sizeBytes)}`).join("\n");
  }

  // Method to listen for settings changes
  onSettingsChanged(callback: (settings: Record<string, any>) => void): void {
    // This could be extended to use EventEmitter for more sophisticated listening
    // For now, services can call getCurrentSettings() when needed
  }
}
