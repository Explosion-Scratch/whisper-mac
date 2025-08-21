import { globalShortcut } from "electron";
import { TranscriptionPluginManager } from "../plugins";
import { DictationWindowService } from "../services/DictationWindowService";
import { SettingsService } from "../services/SettingsService";
import { TrayService } from "../services/TrayService";
import { WindowManager } from "./WindowManager";

export class CleanupManager {
  private transcriptionPluginManager: TranscriptionPluginManager;
  private dictationWindowService: DictationWindowService;
  private settingsService: SettingsService;
  private trayService: TrayService | null;
  private windowManager: WindowManager;
  private finishingTimeout: NodeJS.Timeout | null = null;

  constructor(
    transcriptionPluginManager: TranscriptionPluginManager,
    dictationWindowService: DictationWindowService,
    settingsService: SettingsService,
    trayService: TrayService | null,
    windowManager: WindowManager
  ) {
    this.transcriptionPluginManager = transcriptionPluginManager;
    this.dictationWindowService = dictationWindowService;
    this.settingsService = settingsService;
    this.trayService = trayService;
    this.windowManager = windowManager;
  }

  setFinishingTimeout(timeout: NodeJS.Timeout | null): void {
    this.finishingTimeout = timeout;
  }

  async cleanup(): Promise<void> {
    console.log("=== Starting app cleanup ===");

    const cleanupTimeout = setTimeout(() => {
      console.log("Cleanup timeout reached, forcing app quit...");
      process.exit(0);
    }, 5000);

    try {
      this.unregisterShortcuts();
      await this.stopTranscription();
      this.closeWindows();
      this.cleanupServices();
      this.clearTimeouts();
      this.forceCloseRemainingWindows();

      console.log("=== App cleanup completed ===");
    } catch (error) {
      console.error("Error during cleanup:", error);
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }

  private unregisterShortcuts(): void {
    globalShortcut.unregisterAll();
    console.log("Global shortcuts unregistered");
  }

  private async stopTranscription(): Promise<void> {
    await this.transcriptionPluginManager.stopTranscription();
    console.log("Transcription stopped");
  }

  private closeWindows(): void {
    this.dictationWindowService.cleanup();
    this.settingsService.cleanup();
    this.windowManager.closeModelManagerWindow();
    console.log("Windows closed");
  }

  private cleanupServices(): void {
    this.transcriptionPluginManager.cleanup();
    this.trayService?.destroy();
    console.log("Services cleaned up");
  }

  private clearTimeouts(): void {
    if (this.finishingTimeout) {
      clearTimeout(this.finishingTimeout);
      this.finishingTimeout = null;
    }
    console.log("Timeouts cleared");
  }

  private forceCloseRemainingWindows(): void {
    this.windowManager.forceCloseAllWindows();
  }
}
