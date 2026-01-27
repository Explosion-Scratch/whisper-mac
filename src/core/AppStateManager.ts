import {
  TrayService,
  SetupStatus as TraySetupStatus,
} from "../services/TrayService";
import { appStore, SetupStatus } from "./AppStore";

export { SetupStatus } from "./AppStore";

export class AppStateManager {
  private trayService: TrayService | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.unsubscribe = appStore.subscribe(
      (state) => state.app.status,
      (status) => {
        this.trayService?.updateTrayMenu(status as TraySetupStatus);
      },
    );
  }

  setTrayService(trayService: TrayService) {
    this.trayService = trayService;
  }

  setSetupStatus(status: SetupStatus) {
    appStore.setAppStatus(status);
  }

  getCurrentStatus(): SetupStatus {
    return appStore.select((state) => state.app.status);
  }

  onSetupStatusChange(callback: (status: SetupStatus) => void): () => void {
    return appStore.subscribe(
      (state) => state.app.status,
      (status) => callback(status),
    );
  }

  getStatusMessage(status: SetupStatus): string {
    switch (status) {
      case "downloading-models":
        return "Downloading models...";
      case "setting-up-whisper":
        return "Setting up Whisper...";
      case "preparing-app":
        return "Preparing app...";
      case "checking-permissions":
        return "Checking permissions...";
      case "starting-server":
        return "Starting server...";
      case "loading-windows":
        return "Loading windows...";
      case "initializing-plugins":
        return "Initializing plugins...";
      case "service-ready":
        return "Ready";
      case "idle":
      default:
        return "WhisperMac - AI Dictation";
    }
  }

  isIdle(): boolean {
    return appStore.select((state) => state.app.status) === "idle";
  }

  isServiceReady(): boolean {
    return appStore.select((state) => state.app.status) === "service-ready";
  }

  cleanup(): void {
    console.log("Cleaning up AppStateManager...");
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
