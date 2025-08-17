import { BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { AppConfig } from "../config/AppConfig";
import { SettingsManager } from "../config/SettingsManager";
import { SETTINGS_SCHEMA } from "../config/SettingsSchema";

export class SettingsService {
  private settingsWindow: BrowserWindow | null = null;
  private windowVisibilityCallbacks: Set<(visible: boolean) => void> =
    new Set();
  private settingsManager: SettingsManager;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.settingsManager = new SettingsManager(config);
    this.setupIpcHandlers();

    // Load existing settings on startup
    this.loadSettings();
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

    // AI key validation
    ipcMain.handle(
      "ai:validateKeyAndListModels",
      async (_event, payload: { apiKey: string }) => {
        const { apiKey } = payload || { apiKey: "" };
        const { AiProviderService } = await import(
          "../services/AiProviderService"
        );
        const svc = new AiProviderService();
        return svc.validateAndListModels(apiKey);
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

    // Removed model management in new flow
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

  // Model guards removed

  // Method to listen for settings changes
  onSettingsChanged(callback: (settings: Record<string, any>) => void): void {
    // This could be extended to use EventEmitter for more sophisticated listening
    // For now, services can call getCurrentSettings() when needed
  }
}
