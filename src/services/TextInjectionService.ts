import { execFile } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { NotificationService } from "./NotificationService";
import { systemPreferences, clipboard } from "electron";
import { macInput } from "../native/MacInput";

interface ProcessResult {
  success: boolean;
  output?: string;
  error?: string;
}

export class TextInjectionService {
  private static readonly TIMEOUT_MS = 10000;

  private accessibilityEnabled: boolean | null = null;
  private injectUtilPath: string | null = null;
  private notificationService: NotificationService;

  constructor(notificationService?: NotificationService) {
    this.notificationService = notificationService || new NotificationService();
    this.resolveInjectUtilPath();
  }

  private resolveInjectUtilPath(): void {}

  async insertText(text: string): Promise<void> {
    if (!text?.trim()) {
      throw new Error("Text cannot be empty");
    }

    try {
      const hasAccessibility = await this.checkAccessibilityPermissions();

      if (!hasAccessibility) {
        await this.copyToClipboardOnly(text);
        return;
      }

      if (macInput && typeof macInput.injectText === "function") {
        macInput.injectText(text);
        return;
      }

      if (macInput && typeof macInput.pasteCommandV === "function") {
        await this.injectTextInProcess(text);
        return;
      }

      // As a last resort, copy-only notification
      await this.copyToClipboardOnly(text);
    } catch (error) {
      console.error("Text insertion failed:", error);
      throw new Error(
        `Failed to insert text: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async injectTextInProcess(text: string): Promise<void> {
    const backup = await this.backupClipboard();
    try {
      const copied = await this.copyToClipboard(text);
      if (!copied) throw new Error("Failed to copy to clipboard");
      await this.delay(200);
      const current = await this.readClipboard();
      if (current !== text) throw new Error("Clipboard verification failed");
      macInput.pasteCommandV?.();
      await this.delay(300);
    } finally {
      await this.restoreClipboard(backup);
    }
  }

  private async injectTextWithUtil(_: string): Promise<void> {}

  private async copyToClipboardOnly(text: string): Promise<void> {
    try {
      if (macInput?.copyToClipboard) {
        const ok = macInput.copyToClipboard(text);
        if (ok) {
          await this.notificationService.sendClipboardNotification();
          return;
        }
      }
    } catch {}
    await this.notificationService.sendClipboardNotification();
  }

  private async checkAccessibilityPermissions(): Promise<boolean> {
    console.log(
      "TextInjectionService.checkAccessibilityPermissions cache:",
      this.accessibilityEnabled,
    );
    if (this.accessibilityEnabled !== null) {
      return this.accessibilityEnabled;
    }

    try {
      const startedAt = Date.now();
      const enabled = macInput?.checkPermissions
        ? macInput.checkPermissions()
        : systemPreferences.isTrustedAccessibilityClient(false);
      const durationMs = Date.now() - startedAt;
      this.accessibilityEnabled = Boolean(enabled);
      console.log(
        "TextInjectionService.checkAccessibilityPermissions (in-process) result:",
        { enabled: this.accessibilityEnabled, durationMs },
      );
      return this.accessibilityEnabled;
    } catch (error) {
      console.warn(
        "TextInjectionService.checkAccessibilityPermissions failed:",
        error,
      );
      this.accessibilityEnabled = false;
      return false;
    }
  }

  private async executeProcess(
    command: string,
    args: string[],
  ): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const process = execFile(
        command,
        args,
        { timeout: TextInjectionService.TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              error: stderr || error.message,
              output: stdout,
            });
          } else {
            resolve({
              success: true,
              output: stdout,
              error: stderr,
            });
          }
        },
      );

      process.on("error", (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  async ensureAccessibilityPermissions(): Promise<boolean> {
    console.log("TextInjectionService.ensureAccessibilityPermissions invoked");
    const hasAccessibility = await this.checkAccessibilityPermissions();

    if (!hasAccessibility) {
      console.log(
        "TextInjectionService.ensureAccessibilityPermissions showing instructions",
      );
      await this.showAccessibilityInstructions();
    }

    return hasAccessibility;
  }

  private async showAccessibilityInstructions(): Promise<void> {
    const script = `
      display dialog "WhisperMac needs accessibility permissions to automatically paste text.

To enable:
1. Click 'Open System Preferences' below
2. Go to Privacy & Security > Accessibility
3. Click the lock icon and enter your password
4. Add WhisperMac to the list of allowed apps
5. Return to this window and click 'Check Permission'

The app will automatically detect when permissions are enabled." buttons {"Open System Preferences", "OK"} default button "Open System Preferences" with title "Accessibility Permissions Required"
    `;

    try {
      const result = await this.executeProcess("osascript", ["-e", script]);

      if (
        result.success &&
        result.output?.includes("Open System Preferences")
      ) {
        await this.openSystemPreferences();
      }
    } catch (error) {
      console.error("Failed to show accessibility instructions:", error);
      await this.notificationService.sendErrorNotification(
        "Accessibility permissions required - check System Preferences",
      );
    }
  }

  private async openSystemPreferences(): Promise<void> {
    const script = `
      tell application "System Preferences"
        activate
        set current pane to pane id "com.apple.preference.security"
      end tell
    `;

    try {
      const result = await this.executeProcess("osascript", ["-e", script]);
      if (!result.success) {
        throw new Error(`AppleScript failed: ${result.error}`);
      }
    } catch (error) {
      console.error("Failed to open System Preferences:", error);
      await this.notificationService.sendErrorNotification(
        "Failed to open System Preferences",
      );
    }
  }

  resetAccessibilityCache(): void {
    console.log("TextInjectionService.resetAccessibilityCache called");
    this.accessibilityEnabled = null;
  }

  private async backupClipboard(): Promise<string | null> {
    try {
      return clipboard.readText() ?? null;
    } catch {
      return null;
    }
  }

  private async restoreClipboard(backup: string | null): Promise<void> {
    try {
      if (backup === null) {
        clipboard.clear();
      } else {
        clipboard.writeText(backup);
      }
    } catch {}
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private async readClipboard(): Promise<string | null> {
    try {
      return clipboard.readText() ?? null;
    } catch {
      return null;
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}
