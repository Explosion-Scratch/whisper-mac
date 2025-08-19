import { BrowserWindow } from "electron";
import { join } from "path";
import { app } from "electron";

export class WindowManager {
  private settingsWindow: BrowserWindow | null = null;
  private onboardingWindow: BrowserWindow | null = null;
  private modelManagerWindow: BrowserWindow | null = null;

  openOnboardingWindow(): BrowserWindow {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.focus();
      return this.onboardingWindow;
    }

    this.onboardingWindow = new BrowserWindow({
      width: 600,
      height: 520,
      resizable: false,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 10, y: 12 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/onboardingPreload.js"),
        backgroundThrottling: false,
      },
      show: false,
    });

    this.onboardingWindow.loadFile(
      join(__dirname, "../renderer/onboarding.html")
    );

    this.onboardingWindow.once("ready-to-show", () => {
      this.onboardingWindow?.show();
      try {
        app.dock?.show();
      } catch (e) {}
    });

    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = null;
      try {
        app.dock?.hide();
      } catch (e) {}
    });

    return this.onboardingWindow;
  }

  openModelManagerWindow(): BrowserWindow {
    if (this.modelManagerWindow && !this.modelManagerWindow.isDestroyed()) {
      this.modelManagerWindow.focus();
      return this.modelManagerWindow;
    }

    this.modelManagerWindow = new BrowserWindow({
      width: 400,
      height: 400,
      webPreferences: { nodeIntegration: true },
    });

    this.modelManagerWindow.loadFile("model-manager.html");
    this.modelManagerWindow.on("closed", () => {
      this.modelManagerWindow = null;
    });

    return this.modelManagerWindow;
  }

  getOnboardingWindow(): BrowserWindow | null {
    return this.onboardingWindow;
  }

  getModelManagerWindow(): BrowserWindow | null {
    return this.modelManagerWindow;
  }

  closeOnboardingWindow(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.close();
      this.onboardingWindow = null;
    }
  }

  closeModelManagerWindow(): void {
    if (this.modelManagerWindow && !this.modelManagerWindow.isDestroyed()) {
      this.modelManagerWindow.close();
      this.modelManagerWindow = null;
    }
  }

  forceCloseAllWindows(): void {
    console.log("=== Force closing all remaining windows ===");

    const allWindows = BrowserWindow.getAllWindows();
    console.log(`Found ${allWindows.length} remaining windows`);

    allWindows.forEach((window, index) => {
      if (!window.isDestroyed()) {
        console.log(`Force closing window ${index + 1}...`);
        window.destroy();
      }
    });

    console.log("=== All windows force closed ===");
  }
}
