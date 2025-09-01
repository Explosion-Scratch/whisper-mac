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
    windowManager: WindowManager,
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
    }, 10000); // Increased timeout to 10 seconds

    try {
      // Step 1: Stop any ongoing transcription immediately
      console.log("Step 1: Stopping transcription...");
      await this.stopTranscription();

      // Step 2: Unregister global shortcuts
      console.log("Step 2: Unregistering shortcuts...");
      this.unregisterShortcuts();

      // Step 3: Clear timeouts and intervals
      console.log("Step 3: Clearing timeouts...");
      this.clearTimeouts();

      // Step 4: Cleanup services (remove event listeners, etc.)
      console.log("Step 4: Cleaning up services...");
      this.cleanupServices();

      // Step 5: Close all windows gracefully
      console.log("Step 5: Closing windows...");
      this.closeWindows();

      // Step 6: Wait a moment for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 7: Force close any remaining windows
      console.log("Step 7: Force closing remaining windows...");
      this.forceCloseRemainingWindows();

      // Step 8: Final cleanup
      console.log("Step 8: Final cleanup...");
      await this.finalCleanup();

      console.log("=== App cleanup completed successfully ===");
    } catch (error) {
      console.error("Error during cleanup:", error);
      // Continue with cleanup even if there are errors
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
    // Best-effort async cleanup; don't await here to keep shutdown fast
    void this.transcriptionPluginManager.cleanup();
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

  private async finalCleanup(): Promise<void> {
    try {
      // Remove event listeners from services that extend EventEmitter
      if (this.transcriptionPluginManager?.removeAllListeners) {
        this.transcriptionPluginManager.removeAllListeners();
      }

      if (this.dictationWindowService?.removeAllListeners) {
        this.dictationWindowService.removeAllListeners();
      }

      // SettingsService doesn't extend EventEmitter, so it doesn't have removeAllListeners
      // Its cleanup is handled by its own cleanup() method

      // Force garbage collection if available
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }

      console.log("All event listeners cleared and final cleanup completed");
    } catch (error) {
      console.error("Error in final cleanup:", error);
      // Don't throw - we want to continue with app shutdown
    }
  }
}
