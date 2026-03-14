import { app } from "electron";
import log from "electron-log/main";

export class LoginItemService {
  private static instance: LoginItemService;

  private constructor() {}

  static getInstance(): LoginItemService {
    if (!LoginItemService.instance) {
      LoginItemService.instance = new LoginItemService();
    }
    return LoginItemService.instance;
  }

  getCurrentSettings(): { openAtLogin: boolean; status?: string } {
    try {
      const settings = app.getLoginItemSettings({
        path: this.getExecutablePath(),
      });
      log.info("Current login item settings:", settings);
      return {
        openAtLogin: this.isEnabled(settings),
        status: (settings as any).status,
      };
    } catch (error) {
      log.error("Failed to get login item settings:", error);
      return { openAtLogin: false };
    }
  }

  async setLaunchAtLogin(enabled: boolean): Promise<boolean> {
    try {
      log.info(`Setting launch at login to: ${enabled}`);
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: this.getExecutablePath(),
        args: [],
      });
      const currentSettings = this.getCurrentSettings();
      log.info(
        `Launch at login set successfully. Current state: ${currentSettings.openAtLogin}`,
      );
      return currentSettings.openAtLogin === enabled;
    } catch (error) {
      log.error("Failed to set launch at login:", error);
      return false;
    }
  }

  isCurrentlyEnabled(): boolean {
    return this.getCurrentSettings().openAtLogin;
  }

  wasOpenedAtLogin(): boolean {
    try {
      const settings = app.getLoginItemSettings({
        path: this.getExecutablePath(),
      });
      return settings.wasOpenedAtLogin || false;
    } catch (error) {
      log.error("Failed to check if opened at login:", error);
      return false;
    }
  }

  private getExecutablePath(): string {
    return app.getPath("exe") || process.execPath;
  }

  private isEnabled(settings: Electron.LoginItemSettings): boolean {
    const status = (settings as any).status;
    if (typeof status === "string") {
      return status === "enabled";
    }
    return Boolean(settings.openAtLogin);
  }
}
