import { globalShortcut } from "electron";
import { TranscriptionPluginManager } from "../plugins";
import { promiseManager } from "./PromiseManager";

export interface Cleanable {
  cleanup(): void | Promise<void>;
}

export class CleanupManager {
  private finishingTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly cleanables: (Cleanable | null)[] = []) {}

  setFinishingTimeout(timeout: NodeJS.Timeout | null): void {
    this.finishingTimeout = timeout;
  }

  async cleanup(): Promise<void> {
    console.log("=== Starting comprehensive app cleanup ===");

    const cleanupId = `app:cleanup:${Date.now()}`;
    promiseManager.start(cleanupId);

    // Safety timeout to ensure app exits even if cleanup hangs
    const cleanupTimeout = setTimeout(() => {
      console.log("Cleanup timeout reached, forcing exit...");
      process.exit(0);
    }, 10000);

    try {
      // Step 1: Clear application timeouts
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }

      // Step 2: Cleanup all other registered components and services
      console.log("Step 1: Cleaning up registered components and services...");
      for (const component of this.cleanables) {
        try {
          if (component) {
            await component.cleanup();
          }
        } catch (err) {
          console.error("Error cleaning up component:", err);
        }
      }

      // Step 3: Final environment cleanup
      console.log("Step 2: Final environment cleanup...");
      globalShortcut.unregisterAll();

      // Best-effort GC
      if (typeof global !== "undefined" && (global as any).gc) {
        (global as any).gc();
      }

      console.log("=== App cleanup completed successfully ===");
      promiseManager.resolve(cleanupId);
    } catch (error) {
      console.error("Cleanup failed:", error);
      promiseManager.reject(cleanupId, error);
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }
}
