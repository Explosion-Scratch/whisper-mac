import { BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { AppConfig } from "../config/AppConfig";
import { SettingsManager } from "../config/SettingsManager";
import { SETTINGS_SCHEMA } from "../config/SettingsSchema";

export class SettingsService {
  private settingsWindow: BrowserWindow | null = null;
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
      const serializableSchema = SETTINGS_SCHEMA.map((section) => ({
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

    // Close settings window
    ipcMain.handle("settings:closeWindow", () => {
      this.closeSettingsWindow();
    });
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
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      titleBarStyle: "hidden", // Hide native title bar
      trafficLightPosition: { x: 5, y: 10 }, // Position traffic light buttons
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/settingsPreload.js"),
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
    });

    // Clean up when window is closed
    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });

    // Handle window close button
    this.settingsWindow.on("close", (event) => {
      // Hide instead of close on macOS (standard behavior)
      if (process.platform === "darwin") {
        event.preventDefault();
        this.settingsWindow?.hide();
      }
    });
  }

  closeSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
    }
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

  // Method to listen for settings changes
  onSettingsChanged(callback: (settings: Record<string, any>) => void): void {
    // This could be extended to use EventEmitter for more sophisticated listening
    // For now, services can call getCurrentSettings() when needed
  }
}
