import {
  TrayService,
  SetupStatus as TraySetupStatus,
} from "../services/TrayService";

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

export class AppStateManager {
  private currentSetupStatus: SetupStatus = "idle";
  private setupStatusCallbacks: ((status: SetupStatus) => void)[] = [];
  private trayService: TrayService | null = null;

  setTrayService(trayService: TrayService) {
    this.trayService = trayService;
  }

  setSetupStatus(status: SetupStatus) {
    this.currentSetupStatus = status;
    this.setupStatusCallbacks.forEach((callback) => callback(status));
    this.trayService?.updateTrayMenu(status as TraySetupStatus);
  }

  getCurrentStatus(): SetupStatus {
    return this.currentSetupStatus;
  }

  onSetupStatusChange(callback: (status: SetupStatus) => void) {
    this.setupStatusCallbacks.push(callback);
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
      case "idle":
      default:
        return "WhisperMac - AI Dictation";
    }
  }

  isIdle(): boolean {
    return this.currentSetupStatus === "idle";
  }
}
