import { BrowserWindow, app } from "electron";
import { join } from "path";

export type ErrorAction = "ok" | "quit" | "settings" | "later";

export interface ErrorPayload {
  title: string;
  description?: string;
  actions?: ErrorAction[];
}

export class ErrorWindowService {
  private window: BrowserWindow | null = null;
  private onSettingsAction?: () => void;

  /**
   * Set callback for when the settings action is triggered
   */
  setSettingsCallback(callback: () => void): void {
    this.onSettingsAction = callback;
  }

  /**
   * Shows the error window with the provided payload.
   */
  async show(payload: ErrorPayload): Promise<void> {
    await this.ensureWindow();
    if (!this.window) return;
    this.window.webContents.send("error:data", payload);
    this.window.show();
    this.window.focus();
  }

  /**
   * Destroys the error window if present.
   */
  cleanup(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }

  private async ensureWindow(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) return;
    await this.createWindow();
  }

  private async createWindow(): Promise<void> {
    this.window = new BrowserWindow({
      width: 320,
      height: 400,
      resizable: false,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      visualEffectState: "active",
      frame: false,
      titleBarStyle: "hidden",
      alwaysOnTop: true,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/errorPreload.js"),
        backgroundThrottling: false,
      },
      show: false,
    });

    await this.window.loadFile(join(__dirname, "../renderer/error.html"));

    this.window.webContents.on("ipc-message", (_event, channel, ...args) => {
      if (channel === "error:action") {
        const action = String(args[0]) as ErrorAction;
        if (action === "quit") {
          try {
            app.quit();
          } catch {}
        }
        if (action === "ok" || action === "later") {
          try {
            this.window?.hide();
          } catch {}
        }
        if (action === "settings") {
          try {
            this.window?.hide();
            this.onSettingsAction?.();
          } catch {}
        }
      }
    });

    this.window.on("closed", () => {
      this.window = null;
    });
  }
}
