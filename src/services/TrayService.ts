import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  Notification,
} from "electron";
import { join } from "path";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { NotificationService } from "./NotificationService";
import { SettingsManager } from "../config/SettingsManager";

export type SetupStatus =
  | "idle"
  | "downloading-models"
  | "setting-up-whisper"
  | "preparing-app"
  | "checking-permissions"
  | "starting-server"
  | "loading-windows"
  | "initializing-plugins"
  | "service-ready";

export class TrayService {
  private tray: Tray | null = null;
  private trayMenu: Menu | null = null;
  private currentStatus: SetupStatus = "idle";

  constructor(
    private readonly trayIconIdleRelPath: string,
    private readonly trayIconRecordingRelPath: string,
    private readonly dockIconRelPath: string,
    private readonly getStatusMessage: (s: SetupStatus) => string,
    private readonly onLeftClick: () => void,
    private readonly onShowSettings: () => void,
    private readonly pluginManager: TranscriptionPluginManager,
    private readonly notificationService: NotificationService,
    private readonly settingsManager: SettingsManager,
  ) {}

  createTray() {
    const initialIconPath = join(__dirname, this.trayIconIdleRelPath);
    this.tray = new Tray(initialIconPath);
    this.setTrayIcon(this.trayIconIdleRelPath);
    // Dock icon is now handled by the .icns file in electron-builder config
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.on("click", () => {
      if (this.currentStatus !== "idle") {
        try {
          if (this.trayMenu) this.tray?.popUpContextMenu(this.trayMenu);
        } catch (e) {}
        return;
      }
      this.onLeftClick();
    });
    this.tray.on("right-click", () => {
      try {
        if (this.trayMenu) this.tray?.popUpContextMenu(this.trayMenu);
      } catch (e) {}
    });
  }

  /**
   * Generate plugin selection submenu with available plugins
   */
  private async generatePluginSubmenu(): Promise<
    Electron.MenuItemConstructorOptions[]
  > {
    try {
      const allPlugins = this.pluginManager.getPlugins();
      const availablePlugins = await this.pluginManager.getAvailablePlugins();
      const activePluginName = this.pluginManager.getActivePluginName();

      // If no plugins available, show disabled message
      if (availablePlugins.length === 0) {
        return [
          {
            label: "No plugins available",
            enabled: false,
          },
        ];
      }

      // Create menu items for available plugins
      const pluginItems: Electron.MenuItemConstructorOptions[] =
        availablePlugins.map((plugin) => ({
          label: `${plugin.displayName}${
            activePluginName === plugin.name ? " ✓" : ""
          }`,
          type: "normal",
          enabled: activePluginName !== plugin.name, // Disable current active plugin
          click: () => this.activatePlugin(plugin.name),
        }));

      return pluginItems;
    } catch (error) {
      console.error("Error generating plugin submenu:", error);
      return [
        {
          label: "Error loading plugins",
          enabled: false,
        },
      ];
    }
  }

  /**
   * Activate a plugin using the fallback system
   */
  private async activatePlugin(pluginName: string): Promise<void> {
    try {
      console.log(`Attempting to activate plugin: ${pluginName}`);
      const result = await this.pluginManager.activatePluginWithFallback(
        pluginName,
      );

      if (result.success) {
        console.log(`Successfully activated plugin: ${result.activePlugin}`);

        // Show notification about plugin switch
        const targetPlugin = this.pluginManager.getPlugin(result.activePlugin!);
        if (targetPlugin) {
          if (result.pluginChanged) {
            if (result.activePlugin === pluginName) {
              // Successfully switched to requested plugin
              await this.showPluginSwitchNotification(
                targetPlugin.displayName,
                false,
              );
            } else {
              // Fallback occurred - show notification with settings button
              const requestedPlugin = this.pluginManager.getPlugin(pluginName);
              const requestedDisplayName =
                requestedPlugin?.displayName || pluginName;
              await this.showPluginSwitchNotification(
                targetPlugin.displayName,
                true,
                requestedDisplayName,
              );
            }
          }
        }

        // Update tray menu to reflect the change
        this.updateTrayMenu(this.currentStatus);
      } else {
        console.error(
          `Failed to activate plugin ${pluginName}:`,
          result.errors,
        );
        // Show error notification
        await this.notificationService.sendErrorNotification(
          `Failed to activate ${pluginName}. Please check plugin availability in Settings.`,
        );
      }
    } catch (error) {
      console.error(`Error activating plugin ${pluginName}:`, error);
      await this.notificationService.sendErrorNotification(
        `Error switching to ${pluginName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async updateTrayMenu(status: SetupStatus) {
    if (!this.tray) return;
    this.currentStatus = status;
    const isSetupInProgress = status !== "idle";
    if (isSetupInProgress) {
      const statusMenu = Menu.buildFromTemplate([
        { label: this.getStatusMessage(status), enabled: false },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]);
      this.trayMenu = statusMenu;
      this.tray.setToolTip(this.getStatusMessage(status));
    } else {
      // Generate plugin submenu asynchronously
      const pluginSubmenu = await this.generatePluginSubmenu();

      // Get configured hotkey for start/stop dictation
      const hotkeySettings =
        (this.settingsManager.get("hotkeys") as Record<string, string>) || {};
      const startStopHotkey = hotkeySettings.startStopDictation || "Control+D";

      const contextMenu = Menu.buildFromTemplate([
        {
          label: "Start Dictation",
          click: () => this.onLeftClick(),
          accelerator: startStopHotkey,
        },
        { type: "separator" },
        { label: "Settings", click: () => this.onShowSettings() },
        {
          label: "Select Plugin",
          submenu: pluginSubmenu,
        },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]);
      this.trayMenu = contextMenu;
      this.tray.setToolTip("WhisperMac - AI Dictation");
    }
  }

  /**
   * Refresh the tray menu without changing the status
   */
  async refreshTrayMenu() {
    await this.updateTrayMenu(this.currentStatus);
  }

  updateTrayIcon(state: "idle" | "recording") {
    const iconPath =
      state === "recording"
        ? this.trayIconRecordingRelPath
        : this.trayIconIdleRelPath;
    this.setTrayIcon(iconPath);
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
    this.trayMenu = null;
  }

  showDock(show: boolean) {
    try {
      if (show) app.dock?.show();
      else app.dock?.hide();
    } catch {}
  }

  handleDockClick(
    getOnboardingVisible: () => boolean,
    showOnboarding: () => void,
    showDictationWindow: () => void,
  ) {
    try {
      if (getOnboardingVisible()) {
        showOnboarding();
        return;
      }
      const visibleWindows = BrowserWindow.getAllWindows().filter(
        (w) => !w.isDestroyed() && w.isVisible(),
      );
      if (visibleWindows.length > 0) {
        visibleWindows.forEach((w) => {
          try {
            w.show();
            w.focus();
          } catch {}
        });
        return;
      }
    } catch {}
  }

  private setTrayIcon(assetRelPath: string) {
    const fullPath = join(__dirname, assetRelPath);
    try {
      const image = nativeImage.createFromPath(fullPath);
      image.setTemplateImage(true);
      this.tray?.setImage(image);
    } catch {}
  }

  /**
   * Show notification when switching plugins
   */
  private async showPluginSwitchNotification(
    activePluginName: string,
    isFallback: boolean = false,
    requestedPluginName?: string,
  ): Promise<void> {
    try {
      if (isFallback && requestedPluginName) {
        // For fallback scenarios, show notification with settings button
        const message = `Switched to ${activePluginName} (couldn't switch to ${requestedPluginName})`;

        // Use native notification with action if supported
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: "WhisperMac",
            body: message,
            actions: [
              {
                type: "button",
                text: "Open Settings",
              },
            ],
          });

          notification.on("action", (event, index) => {
            if (index === 0) {
              // Open settings when button is clicked
              this.onShowSettings();
            }
          });

          notification.on("click", () => {
            // Also open settings when notification itself is clicked
            this.onShowSettings();
          });

          notification.show();
        } else {
          // Fallback to basic notification
          await this.notificationService.sendNotification({
            message: `${message}. Click here to open Settings.`,
            sound: "default",
          });
        }
      } else {
        // Regular successful switch notification
        await this.notificationService.sendSuccessNotification(
          `Switched to ${activePluginName}`,
        );
      }
    } catch (error) {
      console.error("Error showing plugin switch notification:", error);
      // Fallback to console log
      console.log(
        `PLUGIN SWITCH: ${
          isFallback ? "Fallback to" : "Switched to"
        } ${activePluginName}`,
      );
    }
  }

  // Dock icon is now handled by the .icns file in electron-builder config
  // No need to manually set it anymore
}
