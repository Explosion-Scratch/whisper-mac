import { app } from "electron";
import log from "electron-log/main";

export class LoginItemService {
  private static instance: LoginItemService;
  private currentEnabledState: boolean = false;

  private constructor() {
    // Initialize with current state
    this.updateCurrentState();
  }

  static getInstance(): LoginItemService {
    if (!LoginItemService.instance) {
      LoginItemService.instance = new LoginItemService();
    }
    return LoginItemService.instance;
  }

  /**
   * Get current login item settings
   */
  getCurrentSettings(): { openAtLogin: boolean; status?: string } {
    try {
      const settings = app.getLoginItemSettings();
      log.info("Current login item settings:", settings);
      return {
        openAtLogin: settings.openAtLogin,
        status: (settings as any).status,
      };
    } catch (error) {
      log.error("Failed to get login item settings:", error);
      return { openAtLogin: false };
    }
  }

  /**
   * Set launch at login preference
   */
  async setLaunchAtLogin(enabled: boolean): Promise<boolean> {
    try {
      log.info(`Setting launch at login to: ${enabled}`);

      // For macOS, use the simple approach
      app.setLoginItemSettings({
        openAtLogin: enabled,
      });

      // Verify the setting was applied
      const currentSettings = this.getCurrentSettings();
      this.currentEnabledState = currentSettings.openAtLogin;

      log.info(
        `Launch at login set successfully. Current state: ${this.currentEnabledState}`,
      );
      return this.currentEnabledState === enabled;
    } catch (error) {
      log.error("Failed to set launch at login:", error);
      return false;
    }
  }

  /**
   * Check if launch at login is currently enabled
   */
  isCurrentlyEnabled(): boolean {
    return this.currentEnabledState;
  }

  /**
   * Update internal state from system
   */
  private updateCurrentState(): void {
    const settings = this.getCurrentSettings();
    this.currentEnabledState = settings.openAtLogin;
    log.info(
      `Login item service initialized. Current state: ${this.currentEnabledState}`,
    );
  }

  /**
   * Handle app startup - check if we were launched at login
   */
  wasOpenedAtLogin(): boolean {
    try {
      const settings = app.getLoginItemSettings();
      return settings.wasOpenedAtLogin || false;
    } catch (error) {
      log.error("Failed to check if opened at login:", error);
      return false;
    }
  }
}
