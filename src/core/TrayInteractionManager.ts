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
    private onToggleRecording: () => void,
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
        () => this.dictationWindowService.showDictationWindow(),
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
        } catch (error) {
          console.error("Error in dock visibility check:", error);
        }
      });
    } catch (error) {
      console.error("Error setting up dock visibility monitoring:", error);
    }
  }

  hideDockAfterOnboarding(): void {
    try {
      // Add delay to ensure onboarding window is fully closed and app is stable
      setTimeout(() => {
        try {
          const settings = this.settingsService.getCurrentSettings();
          const isOnboardingComplete = !!settings?.onboardingComplete;
          const settingsVisible = this.settingsService.isWindowVisible();

          // Only hide dock if onboarding is complete and settings window is not visible
          if (isOnboardingComplete && !settingsVisible) {
            console.log("Hiding dock icon after onboarding completion");
            app.dock?.hide();
          }
        } catch (error) {
          console.error("Error hiding dock after onboarding:", error);
        }
      }, 2000); // Increased timeout to ensure app is fully initialized
    } catch (error) {
      console.error("Error in hideDockAfterOnboarding:", error);
    }
  }

  showDockAfterOnboarding(): void {
    try {
      app.dock?.show();
    } catch (error) {
      console.error("Error showing dock after onboarding:", error);
    }
  }
}
