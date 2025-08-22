import { execFile } from "child_process";
import { join } from "path";
import fs from "fs";
import { existsSync } from "fs";
import { NotificationService } from "./NotificationService";

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

  private resolveInjectUtilPath(): void {
    const paths = [
      join(__dirname, "../injectUtil"),
      join(process.resourcesPath, "injectUtil"),
    ];
    let i = paths.find((i) => existsSync(i));
    if (i) {
      this.injectUtilPath = i;
    } else {
      console.error("Failed to resolve injectUtil path");
    }
  }

  async insertText(text: string): Promise<void> {
    if (!text?.trim()) {
      throw new Error("Text cannot be empty");
    }

    try {
      const hasAccessibility = await this.checkAccessibilityPermissions();

      if (hasAccessibility) {
        await this.injectTextWithUtil(text);
      } else {
        await this.copyToClipboardOnly(text);
      }
    } catch (error) {
      console.error("Text insertion failed:", error);
      throw new Error(
        `Failed to insert text: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async injectTextWithUtil(text: string): Promise<void> {
    if (!this.injectUtilPath) {
      throw new Error("injectUtil binary path not resolved");
    }

    if (!existsSync(this.injectUtilPath)) {
      throw new Error(`injectUtil binary not found at: ${this.injectUtilPath}`);
    }

    const result = await this.executeProcess(this.injectUtilPath, [text]);

    if (!result.success) {
      throw new Error(`injectUtil failed: ${result.error}`);
    }
  }

  private async copyToClipboardOnly(text: string): Promise<void> {
    try {
      // Try injectUtil first
      if (this.injectUtilPath && existsSync(this.injectUtilPath)) {
        const result = await this.executeProcess(this.injectUtilPath, [
          "--copy",
          text,
        ]);
        if (result.success) {
          await this.notificationService.sendClipboardNotification();
          return;
        }
      }
    } catch (error) {
      console.warn("injectUtil copy failed:", error);
    }

    // If injectUtil copy fails, just show notification
    await this.notificationService.sendClipboardNotification();
  }

  private async checkAccessibilityPermissions(): Promise<boolean> {
    console.log("Is enabled: ", this.accessibilityEnabled);
    if (this.accessibilityEnabled !== null) {
      return this.accessibilityEnabled;
    }

    try {
      if (!this.injectUtilPath || !existsSync(this.injectUtilPath)) {
        console.log("Can't find inject util");
        this.accessibilityEnabled = false;
        return false;
      }

      const result = await this.executeProcess(this.injectUtilPath, [
        "--check-perms",
      ]);
      this.accessibilityEnabled =
        result.success && result.output?.trim() === "true";
      console.log("Accessibility check result:", this.accessibilityEnabled);
      return this.accessibilityEnabled;
    } catch (error) {
      console.warn("Accessibility check failed:", error);
      this.accessibilityEnabled = false;
      return false;
    }
  }

  private async executeProcess(
    command: string,
    args: string[]
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
        }
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
    const hasAccessibility = await this.checkAccessibilityPermissions();

    if (!hasAccessibility) {
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
        "Accessibility permissions required - check System Preferences"
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
        "Failed to open System Preferences"
      );
    }
  }

  resetAccessibilityCache(): void {
    this.accessibilityEnabled = null;
  }
}
