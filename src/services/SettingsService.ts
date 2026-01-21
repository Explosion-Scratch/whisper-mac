import { BrowserWindow, ipcMain, dialog, globalShortcut } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { AppConfig } from "../config/AppConfig";
import { SettingsManager } from "../config/SettingsManager";
import { SETTINGS_SCHEMA } from "../config/SettingsSchema";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { PluginUIFunctions } from "../plugins/TranscriptionPlugin";
import { UnifiedModelDownloadService } from "./UnifiedModelDownloadService";
import { PermissionsManager } from "./PermissionsManager";
import { TextInjectionService } from "./TextInjectionService";
import { MicrophonePermissionService } from "./MicrophonePermissionService";
import { LoginItemService } from "./LoginItemService";

export class SettingsService {
  private settingsWindow: BrowserWindow | null = null;
  private windowVisibilityCallbacks: Set<(visible: boolean) => void> =
    new Set();
  private settingsManager: SettingsManager;
  private config: AppConfig;
  private transcriptionPluginManager: TranscriptionPluginManager | null = null;
  private unifiedModelDownloadService: UnifiedModelDownloadService | null =
    null;
  private permissionsManager: PermissionsManager | null = null;
  private loginItemService: LoginItemService;

  constructor(config: AppConfig) {
    this.config = config;
    this.settingsManager = new SettingsManager(config);
    this.loginItemService = LoginItemService.getInstance();
    this.setupIpcHandlers();

    // Load existing settings on startup
    this.loadSettings();
  }

  /**
   * Set dependencies for permissions management
   */
  setPermissionsDependencies(
    textInjector: TextInjectionService,
    microphoneService?: MicrophonePermissionService,
  ): void {
    const microphone = microphoneService || new MicrophonePermissionService();
    this.permissionsManager = new PermissionsManager(textInjector, microphone);
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

  /**
   * Get the permissions manager instance
   */
  getPermissionsManager(): PermissionsManager {
    if (!this.permissionsManager) {
      throw new Error(
        "Permissions manager not initialized. Call setPermissionsDependencies first.",
      );
    }
    return this.permissionsManager;
  }

  private setupIpcHandlers(): void {
    // Get settings schema
    ipcMain.handle("settings:getSchema", async () => {
      try {
        console.log("Getting settings schema...");

        // Strip out validation functions since they can't be serialized through IPC
        // Also hide internal sections such as onboarding from the UI
        const serializableSchema = SETTINGS_SCHEMA.filter(
          (section) => section.id !== "onboarding",
        ).map((section) => ({
          ...section,
          fields: section.fields.map((field) => {
            const { validation, ...serializableField } = field;

            // Set default microphone options - will be populated by frontend
            if (field.key === "selectedMicrophone") {
              return {
                ...serializableField,
                options: [{ value: "default", label: "System Default" }],
              };
            }

            return serializableField;
          }),
        }));
        return serializableSchema;
      } catch (error) {
        console.error("Failed to get settings schema:", error);
        // Fallback to schema without microphone options
        const serializableSchema = SETTINGS_SCHEMA.filter(
          (section) => section.id !== "onboarding",
        ).map((section) => ({
          ...section,
          fields: section.fields.map((field) => {
            const { validation, ...serializableField } = field;
            return serializableField;
          }),
        }));
        return serializableSchema;
      }
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
          const oldSettings = this.settingsManager.getAll();
          this.settingsManager.setAll(settings);
          this.settingsManager.saveSettings();
          this.settingsManager.applyToConfig();

          // Handle launch at login setting change
          if (oldSettings.launchAtLogin !== settings.launchAtLogin) {
            await this.loginItemService.setLaunchAtLogin(
              settings.launchAtLogin,
            );
          }

          // Reset permission caches when settings change to avoid restart requirement
          if (this.permissionsManager) {
            this.permissionsManager.resetCaches();
          }

          // Update active plugin options if they changed
          if (this.transcriptionPluginManager) {
            const activePlugin =
              this.transcriptionPluginManager.getActivePlugin();
            if (activePlugin) {
              const pluginName = activePlugin.name;
              const oldPluginSettings = oldSettings.plugin?.[pluginName] || {};
              const newPluginSettings = settings.plugin?.[pluginName] || {};

              if (
                JSON.stringify(oldPluginSettings) !==
                JSON.stringify(newPluginSettings)
              ) {
                try {
                  await this.transcriptionPluginManager.updateActivePluginOptions(
                    newPluginSettings,
                  );
                  console.log(
                    `[SettingsService] Updated active plugin (${pluginName}) options after save`,
                  );
                } catch (updateError) {
                  console.warn(
                    `[SettingsService] Failed to update active plugin options:`,
                    updateError,
                  );
                }
              }
            }
          }

          // Notify other windows about settings update
          this.broadcastSettingsUpdate();

          return { success: true };
        } catch (error) {
          console.error("Failed to save settings:", error);
          throw error;
        }
      },
    );

    // Reset all settings
    ipcMain.handle("settings:resetAll", async () => {
      try {
        this.settingsManager.reset();
        this.settingsManager.saveSettings();
        this.settingsManager.applyToConfig();

        // Reset permission caches when settings are reset
        if (this.permissionsManager) {
          this.permissionsManager.resetCaches();
        }

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
      },
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
      },
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

    // Update a single hotkey with conflict detection and auto-save
    ipcMain.handle(
      "settings:updateHotkey",
      async (_event, payload: { key: string; value: string }) => {
        try {
          const { key, value } = payload;

          if (!key.startsWith("hotkeys.")) {
            throw new Error(`Invalid hotkey key: ${key}`);
          }

          const currentSettings = this.settingsManager.getAll();
          const hotkeys = currentSettings.hotkeys || {};
          const hotkeyField = key.replace("hotkeys.", "");

          // Track which fields were cleared due to conflicts
          const clearedConflicts: string[] = [];

          // If setting a non-empty value, check for conflicts with other hotkeys
          if (value && value.trim() !== "") {
            for (const [existingField, existingValue] of Object.entries(
              hotkeys,
            )) {
              if (existingField !== hotkeyField && existingValue === value) {
                // Found a conflict - clear the other hotkey
                console.log(
                  `[SettingsService] Clearing conflicting hotkey: hotkeys.${existingField} (was: ${existingValue})`,
                );
                this.settingsManager.set(`hotkeys.${existingField}`, "");
                clearedConflicts.push(`hotkeys.${existingField}`);
              }
            }
          }

          // Update the target hotkey
          this.settingsManager.set(key, value);
          this.settingsManager.saveSettings();
          this.settingsManager.applyToConfig();

          console.log(
            `[SettingsService] Updated hotkey ${key} = ${value}${clearedConflicts.length > 0 ? `, cleared conflicts: ${clearedConflicts.join(", ")}` : ""}`,
          );

          // Broadcast update to all windows so UI stays in sync
          this.broadcastSettingsUpdate();

          return {
            success: true,
            clearedConflicts,
            settings: this.settingsManager.getAll(),
          };
        } catch (error) {
          console.error("Failed to update hotkey:", error);
          throw error;
        }
      },
    );

    // Suspend shortcuts temporarily (for hotkey input capture)
    ipcMain.handle("shortcuts:suspend", () => {
      console.log(
        "[SettingsService] Suspending global shortcuts for hotkey capture",
      );
      globalShortcut.unregisterAll();
      return { success: true };
    });

    // Resume shortcuts (re-register all hotkeys)
    ipcMain.handle("shortcuts:resume", () => {
      console.log("[SettingsService] Resuming global shortcuts");
      // Emit a synthetic setting-changed event to trigger re-registration in main.ts
      // We use a special key that main.ts will recognize
      this.settingsManager.emit("shortcuts-resume");
      return { success: true };
    });

    // Get launch at login status
    ipcMain.handle("settings:getLaunchAtLoginStatus", () => {
      return this.loginItemService.getCurrentSettings();
    });

    // AI key validation and models listing
    ipcMain.handle(
      "ai:validateKeyAndListModels",
      async (_event, payload: { baseUrl: string; apiKey: string }) => {
        const { baseUrl, apiKey } = payload || { baseUrl: "", apiKey: "" };
        const { AiProviderService } =
          await import("../services/AiProviderService");
        const svc = new AiProviderService();
        return svc.validateAndListModels(baseUrl, apiKey);
      },
    );

    // AI configuration validation
    ipcMain.handle(
      "ai:validateConfiguration",
      async (
        _event,
        payload: { baseUrl: string; model: string; apiKey?: string },
      ) => {
        const { baseUrl, model, apiKey } = payload || {
          baseUrl: "",
          model: "",
          apiKey: "",
        };
        const { AiValidationService } =
          await import("../services/AiValidationService");
        const svc = new AiValidationService();
        return svc.validateAiConfiguration(baseUrl, model, apiKey);
      },
    );

    // Save API key securely from settings
    ipcMain.handle(
      "settings:saveApiKey",
      async (_e, payload: { apiKey: string }) => {
        const { SecureStorageService } =
          await import("../services/SecureStorageService");
        const secure = new SecureStorageService();
        await secure.setSecureValue("ai_service", "api_key", payload.apiKey);
        return { success: true };
      },
    );

    // Get API key securely from settings
    ipcMain.handle("settings:getApiKey", async () => {
      const { SecureStorageService } =
        await import("../services/SecureStorageService");
      const secure = new SecureStorageService();
      return await secure.getSecureValue("ai_service", "api_key");
    });

    // Keychain handlers (used by settings window)
    ipcMain.handle("keychain:saveApiKey", async (_e, apiKey: string) => {
      const { SecureStorageService } =
        await import("../services/SecureStorageService");
      const secure = new SecureStorageService();
      await secure.setSecureValue("ai_service", "api_key", apiKey);
      return { success: true };
    });

    ipcMain.handle("keychain:getApiKey", async () => {
      const { SecureStorageService } =
        await import("../services/SecureStorageService");
      const secure = new SecureStorageService();
      return await secure.getSecureValue("ai_service", "api_key");
    });

    ipcMain.handle("keychain:deleteApiKey", async () => {
      const { SecureStorageService } =
        await import("../services/SecureStorageService");
      const secure = new SecureStorageService();
      await secure.deleteSecureValue("ai_service", "api_key");
      return { success: true };
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
            onLog,
          );

          // Save the active plugin setting
          this.settingsManager.set("transcriptionPlugin", pluginName);
          this.settingsManager.saveSettings();

          this.broadcastSettingsUpdate();
          return { success: true };
        } catch (error: any) {
          throw new Error(error.message || "Plugin switch failed");
        }
      },
    );

    // Test plugin activation without actually switching
    ipcMain.handle(
      "settings:testPluginActivation",
      async (
        event,
        payload: { pluginName: string; options?: Record<string, any> },
      ) => {
        if (!this.transcriptionPluginManager) {
          return { canActivate: false, error: "Plugin manager not available" };
        }

        const { pluginName, options = {} } = payload;
        return await this.transcriptionPluginManager.testPluginActivation(
          pluginName,
          options,
        );
      },
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

      const schemas = this.transcriptionPluginManager.getAllPluginSchemas();

      return {
        plugins,
        schemas,
      };
    });

    // Plugin schema and options handlers
    ipcMain.handle("settings:getPluginSchemas", async () => {
      try {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
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

        const schemas = this.transcriptionPluginManager.getAllPluginSchemas();

        return {
          plugins,
          schemas,
        };
      } catch (error) {
        console.error("Error getting plugin schemas:", error);
        throw error;
      }
    });

    ipcMain.handle(
      "settings:getPluginSchema",
      async (event, pluginName: string) => {
        try {
          if (!this.transcriptionPluginManager) {
            throw new Error("Plugin manager not initialized");
          }
          return this.transcriptionPluginManager.getPluginSchema(pluginName);
        } catch (error) {
          console.error(
            `Error getting schema for plugin ${pluginName}:`,
            error,
          );
          throw error;
        }
      },
    );

    // Get active plugin AI capabilities (for determining if transformation settings are overridden)
    ipcMain.handle("settings:getActivePluginAiCapabilities", () => {
      if (!this.transcriptionPluginManager) {
        return {
          isAiPlugin: false,
          supportsCombinedMode: false,
          processingMode: null,
          transformationSettingsKeys: [],
        };
      }
      return this.transcriptionPluginManager.getActivePluginAiCapabilities();
    });

    // Check if active plugin overrides transformation settings
    ipcMain.handle("settings:activePluginOverridesTransformation", () => {
      if (!this.transcriptionPluginManager) {
        return false;
      }
      return this.transcriptionPluginManager.activePluginOverridesTransformation();
    });

    // Get AI capabilities for a specific plugin
    ipcMain.handle(
      "settings:getPluginAiCapabilities",
      (_event, pluginName: string) => {
        if (!this.transcriptionPluginManager) {
          return {
            isAiPlugin: false,
            supportsCombinedMode: false,
            processingMode: null,
            transformationSettingsKeys: [],
          };
        }
        return this.transcriptionPluginManager.getPluginAiCapabilities(
          pluginName,
        );
      },
    );

    // Validate plugin API key
    ipcMain.handle(
      "settings:validatePluginApiKey",
      async (event, payload: { pluginName: string; apiKey: string }) => {
        try {
          if (!this.transcriptionPluginManager) {
            return { valid: false, error: "Plugin manager not available" };
          }

          const { pluginName, apiKey } = payload;
          const plugin = this.transcriptionPluginManager.getPlugin(pluginName);

          if (!plugin) {
            return { valid: false, error: `Plugin ${pluginName} not found` };
          }

          // Check if the plugin has a validateApiKey method
          if (typeof (plugin as any).validateApiKey === "function") {
            const result = await (plugin as any).validateApiKey(apiKey);

            // If valid, store the API key securely
            if (result.valid) {
              await plugin.setSecureValue("api_key", apiKey);
            }

            return result;
          }

          // Fallback: just store the key if no validation method exists
          await plugin.setSecureValue("api_key", apiKey);
          return { valid: true };
        } catch (error: any) {
          console.error(
            `Error validating API key for plugin ${payload?.pluginName}:`,
            error,
          );
          return { valid: false, error: error.message || "Validation failed" };
        }
      },
    );

    ipcMain.handle(
      "settings:setPluginOptions",
      async (event, pluginName: string, options: Record<string, any>) => {
        try {
          if (!this.transcriptionPluginManager) {
            throw new Error("Plugin manager not initialized");
          }
          await this.transcriptionPluginManager.setPluginOptions(
            pluginName,
            options,
          );
        } catch (error) {
          console.error(
            `Error setting options for plugin ${pluginName}:`,
            error,
          );
          throw error;
        }
      },
    );

    ipcMain.handle(
      "settings:getPluginOptions",
      async (event, pluginName: string) => {
        try {
          if (!this.transcriptionPluginManager) {
            throw new Error("Plugin manager not initialized");
          }
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

    ipcMain.handle(
      "settings:verifyPluginOptions",
      async (event, pluginName: string, options: Record<string, any>) => {
        try {
          if (!this.transcriptionPluginManager) {
            throw new Error("Plugin manager not initialized");
          }
          return await this.transcriptionPluginManager.verifyPluginOptions(
            pluginName,
            options,
          );
        } catch (error) {
          console.error(
            `Error verifying options for plugin ${pluginName}:`,
            error,
          );
          throw error;
        }
      },
    );

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
            uiFunctions,
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
      },
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
          await plugin.deleteAllData();
          return { success: true };
        } catch (error: any) {
          throw new Error(error.message || "Failed to delete plugin");
        }
      },
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
      },
    );

    // Secure storage management handlers
    ipcMain.handle(
      "plugins:getSecureStorageInfo",
      async (event, payload: { pluginName: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(
          payload.pluginName,
        );
        if (!plugin) {
          throw new Error(`Plugin ${payload.pluginName} not found`);
        }

        const keys = await plugin.listSecureKeys();
        const dataSize = await plugin.getDataSize();

        return {
          keys: keys.map((key) => ({ name: key, type: "secure" })),
          totalSize: dataSize,
          hasSecureData: keys.length > 0,
        };
      },
    );

    ipcMain.handle(
      "plugins:clearSecureData",
      async (event, payload: { pluginName: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(
          payload.pluginName,
        );
        if (!plugin) {
          throw new Error(`Plugin ${payload.pluginName} not found`);
        }

        await plugin.clearSecureData();
        return { success: true };
      },
    );

    // New data management handlers
    ipcMain.handle(
      "plugins:listData",
      async (event, payload: { pluginName: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(
          payload.pluginName,
        );
        if (!plugin) {
          throw new Error(`Plugin ${payload.pluginName} not found`);
        }

        return await plugin.listData();
      },
    );

    ipcMain.handle(
      "plugins:deleteDataItem",
      async (event, payload: { pluginName: string; itemId: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(
          payload.pluginName,
        );
        if (!plugin) {
          throw new Error(`Plugin ${payload.pluginName} not found`);
        }

        await plugin.deleteDataItem(payload.itemId);
        return { success: true };
      },
    );

    ipcMain.handle(
      "plugins:deleteAllData",
      async (event, payload: { pluginName: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(
          payload.pluginName,
        );
        if (!plugin) {
          throw new Error(`Plugin ${payload.pluginName} not found`);
        }

        await plugin.deleteAllData();
        return { success: true };
      },
    );

    ipcMain.handle(
      "plugins:exportSecureData",
      async (event, payload: { pluginName: string }) => {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        const plugin = this.transcriptionPluginManager.getPlugin(
          payload.pluginName,
        );
        if (!plugin) {
          throw new Error(`Plugin ${payload.pluginName} not found`);
        }

        const keys = await plugin.listSecureKeys();
        const data: Record<string, any> = {};

        for (const key of keys) {
          data[key] = await plugin.getSecureData(key);
        }

        return { data, timestamp: new Date().toISOString() };
      },
    );

    // Clear all plugin data
    ipcMain.handle("settings:clearAllPluginData", async () => {
      try {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        console.log("Clearing all plugin data...");
        await this.transcriptionPluginManager.clearAllPluginData();

        // Get updated plugin data info
        const updatedPluginDataInfo =
          await this.transcriptionPluginManager.getPluginDataInfo();

        console.log("All plugin data cleared successfully");
        return {
          success: true,
          message: "All plugin data cleared successfully",
          pluginDataInfo: updatedPluginDataInfo,
        };
      } catch (error: any) {
        console.error("Failed to clear all plugin data:", error);
        return {
          success: false,
          message: error.message || "Failed to clear all plugin data",
        };
      }
    });

    // Clear all plugin data with fallback activation
    ipcMain.handle("settings:clearAllPluginDataWithFallback", async () => {
      try {
        if (!this.transcriptionPluginManager) {
          throw new Error("Plugin manager not initialized");
        }

        console.log("Clearing all plugin data with fallback activation...");
        const result =
          await this.transcriptionPluginManager.clearAllPluginDataWithFallback({
            showProgress: (message: string, percent: number) => {
              // Send progress updates to renderer if settings window is open
              if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                this.settingsWindow.webContents.send("settings:clearProgress", {
                  message,
                  percent,
                });
              }
            },
            showError: (error: string) => {
              console.error("Plugin activation error during fallback:", error);
            },
            showSuccess: (message: string) => {
              console.log("Plugin activation success:", message);
            },
            hideProgress: () => {
              // Hide progress in renderer
              if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                this.settingsWindow.webContents.send("settings:hideProgress");
              }
            },
          } as any);

        console.log(
          "All plugin data cleared with fallback activation completed:",
          {
            success: result.success,
            pluginChanged: result.pluginChanged,
            newActivePlugin: result.newActivePlugin,
            failedPlugins: result.failedPlugins,
          },
        );

        return result;
      } catch (error: any) {
        console.error("Failed to clear all plugin data with fallback:", error);
        throw new Error(
          error.message || "Failed to clear all plugin data with fallback",
        );
      }
    });

    // App information
    ipcMain.handle("app:getVersion", () => {
      try {
        const packageJson = require("../../package.json");
        return packageJson.version;
      } catch (error) {
        console.error("Failed to get app version:", error);
        return "1.0.0";
      }
    });

    ipcMain.handle("app:getPackageInfo", () => {
      try {
        const packageJson = require("../../package.json");
        const repoUrl =
          packageJson.repository?.url ||
          "git+https://github.com/explosion-scratch/whisper-mac.git";
        const cleanRepoUrl = repoUrl.replace("git+", "").replace(".git", "");

        return {
          name: packageJson.build?.productName || packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          author: packageJson.author,
          repository: packageJson.repository,
          homepage: packageJson.homepage || cleanRepoUrl,
          license: packageJson.license,
          bugs: packageJson.bugs || { url: `${cleanRepoUrl}/issues` },
          keywords: packageJson.keywords || [],
        };
      } catch (error) {
        console.error("Failed to get package info:", error);
        return {
          name: "WhisperMac",
          version: "1.0.0",
          description:
            "AI-powered dictation for Mac using multiple transcription engines",
          author: "Explosion Scratch",
          repository: {
            type: "git",
            url: "git+https://github.com/explosion-scratch/whisper-mac.git",
          },
          homepage: "https://github.com/explosion-scratch/whisper-mac",
          license: "MIT",
          bugs: {
            url: "https://github.com/explosion-scratch/whisper-mac/issues",
          },
          keywords: [],
        };
      }
    });

    ipcMain.handle("app:openExternalUrl", async (_event, url: string) => {
      try {
        const { shell } = require("electron");
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        console.error("Failed to open external URL:", error);
        return { success: false, error: (error as Error).message };
      }
    });

    // Permissions management
    ipcMain.handle("permissions:getAll", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        return await this.permissionsManager.getAllPermissions();
      } catch (error) {
        console.error("Failed to get all permissions:", error);
        throw error;
      }
    });

    ipcMain.handle("permissions:checkAccessibility", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        return await this.permissionsManager.checkAccessibilityPermissions();
      } catch (error) {
        console.error("Failed to check accessibility permissions:", error);
        throw error;
      }
    });

    ipcMain.handle("permissions:checkMicrophone", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        return await this.permissionsManager.checkMicrophonePermissions();
      } catch (error) {
        console.error("Failed to check microphone permissions:", error);
        throw error;
      }
    });

    ipcMain.handle("permissions:resetCaches", () => {
      if (!this.permissionsManager) {
        return {
          success: false,
          error: "Permissions manager not initialized",
        };
      }
      try {
        this.permissionsManager.resetCaches();
        return { success: true };
      } catch (error) {
        console.error("Failed to reset permission caches:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    ipcMain.handle("permissions:openSystemPreferences", async () => {
      if (!this.permissionsManager) {
        return {
          success: false,
          error: "Permissions manager not initialized",
        };
      }
      try {
        await this.permissionsManager.openSystemPreferences();
        return { success: true };
      } catch (error) {
        console.error("Failed to open system preferences:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    // Quiet permission checking (no prompts)
    ipcMain.handle("permissions:getAllQuiet", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        return await this.permissionsManager.getAllPermissionsQuiet();
      } catch (error) {
        console.error("Failed to get all permissions quietly:", error);
        throw error;
      }
    });

    ipcMain.handle("permissions:checkAccessibilityQuiet", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        return await this.permissionsManager.checkAccessibilityPermissionsQuiet();
      } catch (error) {
        console.error(
          "Failed to check accessibility permissions quietly:",
          error,
        );
        throw error;
      }
    });

    ipcMain.handle("permissions:checkMicrophoneQuiet", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        return await this.permissionsManager.checkMicrophonePermissionsQuiet();
      } catch (error) {
        console.error("Failed to check microphone permissions quietly:", error);
        throw error;
      }
    });

    // Open specific system preferences
    ipcMain.handle("permissions:openAccessibilitySettings", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        await this.permissionsManager.openAccessibilityPreferences();
        return { success: true };
      } catch (error) {
        console.error("Failed to open accessibility settings:", error);
        throw error;
      }
    });

    ipcMain.handle("permissions:openMicrophoneSettings", async () => {
      if (!this.permissionsManager) {
        throw new Error("Permissions manager not initialized");
      }
      try {
        await this.permissionsManager.openMicrophonePreferences();
        return { success: true };
      } catch (error) {
        console.error("Failed to open microphone settings:", error);
        throw error;
      }
    });

    // Open settings window to specific section
    ipcMain.handle(
      "settings:openToSection",
      async (_event, sectionId: string) => {
        try {
          this.openSettingsWindow(sectionId);
          return { success: true };
        } catch (error) {
          console.error("Failed to open settings to section:", error);
          throw error;
        }
      },
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

  openSettingsWindow(sectionId?: string): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      try {
        if (this.settingsWindow.isMinimized()) {
          this.settingsWindow.restore();
        }
        // Ensure hidden window is shown on reopen
        this.settingsWindow.show();
        this.settingsWindow.focus();
        // Send section to navigate to if specified
        if (sectionId) {
          this.settingsWindow.webContents.send(
            "settings:navigateToSection",
            sectionId,
          );
        }
      } catch {}
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      maxWidth: 700,
      maxHeight: 1000,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      visualEffectState: "followWindow",
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 10, y: 12 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/rendererAppPreload.js"),
        backgroundThrottling: false,
      },
      show: false,
    });

    this.settingsWindow.loadFile(
      join(__dirname, "../renderer-app/index.html"),
      { hash: "/settings" },
    );

    // Show window when ready
    this.settingsWindow.once("ready-to-show", () => {
      this.settingsWindow?.show();
      this.emitWindowVisibility(true);
      // Send section to navigate to if specified
      if (sectionId) {
        this.settingsWindow?.webContents.send(
          "settings:navigateToSection",
          sectionId,
        );
      }
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

    this.clearWindowVisibilityCallbacks();

    const { ipcMain } = require("electron");

    ipcMain.removeHandler("settings:getSchema");
    ipcMain.removeHandler("settings:get");
    ipcMain.removeHandler("settings:save");
    ipcMain.removeHandler("settings:resetAll");
    ipcMain.removeHandler("settings:resetSection");
    ipcMain.removeHandler("settings:import");
    ipcMain.removeHandler("settings:export");
    ipcMain.removeHandler("settings:closeWindow");
    ipcMain.removeHandler("settings:saveApiKey");
    ipcMain.removeHandler("settings:getApiKey");
    ipcMain.removeHandler("keychain:saveApiKey");
    ipcMain.removeHandler("keychain:getApiKey");
    ipcMain.removeHandler("keychain:deleteApiKey");
    ipcMain.removeHandler("settings:clearAllPluginData");
    ipcMain.removeHandler("settings:clearAllPluginDataWithFallback");

    ipcMain.removeHandler("dialog:showOpenDialog");
    ipcMain.removeHandler("dialog:showSaveDialog");
    ipcMain.removeHandler("dialog:showDirectoryDialog");

    ipcMain.removeHandler("ai:validateKeyAndListModels");
    ipcMain.removeHandler("ai:validateConfiguration");

    ipcMain.removeHandler("settings:switchPlugin");
    ipcMain.removeHandler("settings:testPluginActivation");
    ipcMain.removeHandler("settings:validatePluginApiKey");
    ipcMain.removeHandler("settings:getActivePluginAiCapabilities");
    ipcMain.removeHandler("settings:activePluginOverridesTransformation");
    ipcMain.removeHandler("settings:getPluginAiCapabilities");

    ipcMain.removeHandler("plugins:getOptions");
    ipcMain.removeHandler("plugins:getActive");
    ipcMain.removeHandler("plugins:updateActiveOptions");
    ipcMain.removeHandler("plugins:deleteInactive");
    ipcMain.removeHandler("settings:getPluginDataInfo");

    ipcMain.removeHandler("settings:getPluginSchemas");
    ipcMain.removeHandler("settings:getPluginSchema");
    ipcMain.removeHandler("settings:setPluginOptions");
    ipcMain.removeHandler("settings:getPluginOptions");
    ipcMain.removeHandler("settings:verifyPluginOptions");

    ipcMain.removeHandler("plugins:listData");
    ipcMain.removeHandler("plugins:deleteDataItem");
    ipcMain.removeHandler("plugins:deleteAllData");
    ipcMain.removeHandler("plugins:getSecureStorageInfo");
    ipcMain.removeHandler("plugins:clearSecureData");
    ipcMain.removeHandler("plugins:exportSecureData");

    ipcMain.removeHandler("app:getVersion");
    ipcMain.removeHandler("app:getPackageInfo");
    ipcMain.removeHandler("app:openExternalUrl");

    ipcMain.removeHandler("permissions:getAll");
    ipcMain.removeHandler("permissions:checkAccessibility");
    ipcMain.removeHandler("permissions:checkMicrophone");
    ipcMain.removeHandler("permissions:resetCaches");
    ipcMain.removeHandler("permissions:openSystemPreferences");
    ipcMain.removeHandler("permissions:getAllQuiet");
    ipcMain.removeHandler("permissions:checkAccessibilityQuiet");
    ipcMain.removeHandler("permissions:checkMicrophoneQuiet");
    ipcMain.removeHandler("permissions:openAccessibilitySettings");
    ipcMain.removeHandler("permissions:openMicrophoneSettings");

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.destroy();
    }

    this.settingsWindow = null;

    console.log("=== SettingsService cleanup completed ===");
  }

  private clearWindowVisibilityCallbacks(): void {
    this.windowVisibilityCallbacks.clear();
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
   * Remove all event listeners for cleanup
   */
  removeAllListeners(): void {
    this.windowVisibilityCallbacks.clear();
  }

  /**
   * Before changing the default model, prompt about deleting older models.
   * The caller should present a dialog to the user with names and sizes and then call deleteModelsIfConfirmed.
   */
  formatDownloadedModelsForPrompt(
    models: Array<{ repoId: string; sizeBytes: number }>,
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
