import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { join } from "path";

export type SetupStatus =
  | "idle"
  | "downloading-models"
  | "setting-up-whisper"
  | "preparing-app"
  | "checking-permissions"
  | "starting-server"
  | "loading-windows";

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
    private readonly onShowModels: () => void,
  ) {}

  createTray() {
    const initialIconPath = join(__dirname, this.trayIconIdleRelPath);
    this.tray = new Tray(initialIconPath);
    this.setTrayIcon(this.trayIconIdleRelPath);
    this.setDockIconToAppIcon();
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

  updateTrayMenu(status: SetupStatus) {
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
      const contextMenu = Menu.buildFromTemplate([
        {
          label: "Start Dictation",
          click: () => this.onLeftClick(),
          accelerator: "Ctrl+D",
        },
        { type: "separator" },
        { label: "Settings", click: () => this.onShowSettings() },
        { label: "Download Models", click: () => this.onShowModels() },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]);
      this.trayMenu = contextMenu;
      this.tray.setToolTip("WhisperMac - AI Dictation");
    }
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
      showDictationWindow();
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

  private setDockIconToAppIcon() {
    try {
      const primaryPath = join(__dirname, this.dockIconRelPath);
      let dockImage = nativeImage.createFromPath(primaryPath);
      if (dockImage.isEmpty()) {
        const devPath = join(__dirname, "..", "assets", "icon.png");
        const devImage = nativeImage.createFromPath(devPath);
        if (!devImage.isEmpty()) dockImage = devImage;
      }
      if (!dockImage.isEmpty() && app.dock) app.dock.setIcon(dockImage);
    } catch {}
  }
}
