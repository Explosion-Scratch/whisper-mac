import { app } from "electron";
import { TrayService } from "../services/TrayService";
import { SettingsService } from "../services/SettingsService";
import { DictationWindowService } from "../services/DictationWindowService";
import { WindowManager } from "./WindowManager";
import { AppStateManager } from "./AppStateManager";

export class TrayInteractionManager {
  private pendingToggle = false;

  constructor(
    private trayService: TrayService,
    private settingsService: SettingsService,
    private dictationWindowService: DictationWindowService,
    private windowManager: WindowManager,
    private appStateManager: AppStateManager,
    private onToggleRecording: () => void
  ) {
    this.setupStatusChangeHandler();
  }

  private setupStatusChangeHandler(): void {
    this.appStateManager.onSetupStatusChange((status) => {
      if (status === "idle" && this.pendingToggle) {
        this.pendingToggle = false;
        this.onToggleRecording();
      }
    });
  }

  public handleTrayClick(): void {
    try {
      const settings = this.settingsService.getCurrentSettings();
      const isOnboardingComplete = !!settings?.onboardingComplete;

      if (!isOnboardingComplete) {
        this.windowManager.openOnboardingWindow();
        return;
      }

      this.onToggleRecording();
    } catch (e) {
      console.error("Error handling tray click:", e);
    }
  }

  public handleDockClick(): void {
    try {
      const settings = this.settingsService.getCurrentSettings();
      this.trayService.handleDockClick(
        () => !settings?.onboardingComplete,
        () => this.windowManager.openOnboardingWindow(),
        () => this.dictationWindowService.showDictationWindow()
      );
    } catch (e) {
      console.error("Error handling dock click:", e);
    }
  }

  setPendingToggle(pending: boolean): void {
    this.pendingToggle = pending;
  }

  isPendingToggle(): boolean {
    return this.pendingToggle;
  }

  setupSettingsWindowVisibilityHandler(): void {
    try {
      this.settingsService.onWindowVisibilityChange((visible) => {
        try {
          if (visible) {
            this.trayService.showDock(true);
          } else {
            const onboardingVisible = !!(
              this.windowManager.getOnboardingWindow() &&
              !this.windowManager.getOnboardingWindow()?.isDestroyed() &&
              (this.windowManager.getOnboardingWindow() as any).isVisible &&
              (this.windowManager.getOnboardingWindow() as any).isVisible()
            );
            if (!onboardingVisible) this.trayService.showDock(false);
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  hideDockAfterOnboarding(): void {
    try {
      const settingsVisible = this.settingsService.isWindowVisible();
      if (!settingsVisible) app.dock?.hide();
    } catch (e) {}
  }

  showDockAfterOnboarding(): void {
    try {
      app.dock?.show();
    } catch (e) {}
  }
}
