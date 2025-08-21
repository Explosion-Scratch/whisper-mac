import { execFile } from "child_process";
import { clipboard } from "electron";

export class TextInjectionService {
  private accessibilityEnabled: boolean | null = null;

  async insertText(text: string): Promise<void> {
    console.log("=== TextInjectionService.insertText ===");
    console.log("Input text:", text);
    console.log("Text length:", text.length);

    try {
      // Check accessibility permissions first
      console.log("Checking accessibility permissions...");
      const hasAccessibility = await this.checkAccessibilityPermissions();
      console.log("Accessibility permissions result:", hasAccessibility);

      if (hasAccessibility) {
        console.log(
          "Accessibility permissions granted, using keystroke approach...",
        );
        // Use simple paste approach - paste will replace selection if any, or insert at cursor
        console.log("Starting paste operation...");
        await this.pasteText(text);
        console.log("Paste operation completed successfully");
      } else {
        console.log(
          "Accessibility permissions not granted, using clipboard-only approach...",
        );
        // Fallback: just copy to clipboard and notify user
        await this.copyToClipboardOnly(text);
        console.log("Clipboard-only operation completed");
      }

      console.log("=== Text insertion completed successfully ===");
    } catch (error) {
      console.error("=== TextInjectionService.insertText ERROR ===");
      console.error("Failed to insert text:", error);
      console.error("Original text:", text);
      throw error;
    }
  }

  /**
   * Check if the application has accessibility permissions
   */
  private async checkAccessibilityPermissions(): Promise<boolean> {
    if (this.accessibilityEnabled !== null) {
      return this.accessibilityEnabled;
    }

    console.log("=== TextInjectionService.checkAccessibilityPermissions ===");

    const script = `
      tell application "System Events"
        return true
      end tell
    `;

    try {
      await this.runAppleScript(script);
      console.log("Accessibility permissions are enabled");
      this.accessibilityEnabled = true;
      return true;
    } catch (error) {
      console.log("Accessibility permissions are not enabled:", error);
      this.accessibilityEnabled = false;
      return false;
    }
  }

  /**
   * Copy text to clipboard only (fallback when accessibility is not available)
   */
  private async copyToClipboardOnly(text: string): Promise<void> {
    console.log("=== TextInjectionService.copyToClipboardOnly ===");
    console.log("Copying text to clipboard only:", text);

    try {
      // Copy new text to clipboard
      clipboard.writeText(text);
      console.log("Text copied to clipboard successfully");
      console.log("User needs to manually paste (Cmd+V) the text");

      // Show a notification or alert to the user
      await this.showClipboardNotification();
    } catch (error) {
      console.error("=== TextInjectionService.copyToClipboardOnly ERROR ===");
      console.error("Failed to copy text to clipboard:", error);
      throw error;
    }
  }

  /**
   * Show notification that text is in clipboard
   */
  private async showClipboardNotification(): Promise<void> {
    console.log("=== TextInjectionService.showClipboardNotification ===");

    const script = `
      display notification "Text copied to clipboard. Press Cmd+V to paste." with title "WhisperMac"
    `;

    try {
      await this.runAppleScript(script);
      console.log("Notification displayed successfully");
    } catch (error) {
      console.error("Failed to show notification:", error);
      // Fallback: just log the message
      console.log("TEXT COPIED TO CLIPBOARD - PRESS CMD+V TO PASTE");
    }
  }

  /**
   * Show instructions for enabling accessibility permissions
   */
  async showAccessibilityInstructions(): Promise<void> {
    console.log("=== TextInjectionService.showAccessibilityInstructions ===");

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
      const result = await this.runAppleScriptWithResult(script);
      console.log("Accessibility instructions displayed successfully");

      // If user clicked "Open System Preferences", open it
      if (result && result.includes("Open System Preferences")) {
        await this.openSystemPreferences();
      }
    } catch (error) {
      console.error("Failed to show accessibility instructions:", error);
      console.log(
        "ACCESSIBILITY PERMISSIONS REQUIRED - CHECK SYSTEM PREFERENCES",
      );
    }
  }

  private async openSystemPreferences(): Promise<void> {
    console.log("=== TextInjectionService.openSystemPreferences ===");

    const script = `
      tell application "System Preferences"
        activate
        set current pane to pane id "com.apple.preference.security"
      end tell
    `;

    try {
      await this.runAppleScript(script);
      console.log("System Preferences opened successfully");
    } catch (error) {
      console.error("Failed to open System Preferences:", error);
    }
  }

  private async runAppleScriptWithResult(script: string): Promise<string> {
    console.log("=== TextInjectionService.runAppleScriptWithResult ===");
    console.log("Script to execute:", script);

    return new Promise((resolve, reject) => {
      console.log("Spawning osascript process...");

      const process = execFile(
        "osascript",
        ["-e", script],
        (error, stdout, stderr) => {
          if (error) {
            console.error(
              "=== TextInjectionService.runAppleScriptWithResult ERROR ===",
            );
            console.error("osascript error:", error);
            console.error("stderr:", stderr);
            reject(error);
          } else {
            console.log("osascript completed successfully");
            console.log("stdout:", stdout);
            resolve(stdout.trim());
          }
        },
      );

      process.on("error", (error) => {
        console.error(
          "=== TextInjectionService.runAppleScriptWithResult PROCESS ERROR ===",
        );
        console.error("Process error:", error);
        reject(error);
      });
    });
  }

  /**
   * Check if accessibility permissions are enabled and show instructions if not
   */
  async ensureAccessibilityPermissions(): Promise<boolean> {
    console.log("=== TextInjectionService.ensureAccessibilityPermissions ===");

    const hasAccessibility = await this.checkAccessibilityPermissions();

    if (!hasAccessibility) {
      console.log(
        "Accessibility permissions not enabled, showing instructions...",
      );
      await this.showAccessibilityInstructions();
    }

    return hasAccessibility;
  }

  /**
   * Reset the accessibility permission cache to force a fresh check
   */
  resetAccessibilityCache(): void {
    console.log("=== TextInjectionService.resetAccessibilityCache ===");
    this.accessibilityEnabled = null;
  }

  /**
   * Paste text using clipboard
   */
  async pasteText(text: string): Promise<void> {
    console.log("=== TextInjectionService.pasteText ===");
    console.log("Text to paste:", text);
    console.log("Text length:", text.length);

    try {
      console.log("Copying text to clipboard...");
      // Copy new text to clipboard
      clipboard.writeText(text);
      await new Promise((resolve) => setTimeout(resolve, 50));
      console.log("Text copied to clipboard successfully");

      // Paste the text (will replace selection if any, or insert at cursor)
      console.log("Executing paste operation...");
      await this.pasteFromClipboard();
      console.log("Paste operation completed successfully");

      console.log("Text pasted successfully:", text);
    } catch (error) {
      console.error("=== TextInjectionService.pasteText ERROR ===");
      console.error("Error during paste operation:", error);
      console.error("Text that failed to paste:", text);
      throw error;
    }
  }

  private async pasteFromClipboard(): Promise<void> {
    console.log("=== TextInjectionService.pasteFromClipboard ===");

    const script = `
      tell application "System Events"
        keystroke "v" using command down
      end tell
    `;

    console.log("Executing AppleScript for paste operation...");
    console.log("AppleScript:", script);

    try {
      await this.runAppleScript(script);
      // WAITING FOR PASTE TO COMPLETE
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("AppleScript paste operation completed successfully");
    } catch (error) {
      console.error("=== TextInjectionService.pasteFromClipboard ERROR ===");
      console.error("AppleScript paste operation failed:", error);
      throw error;
    }
  }

  private async runAppleScript(script: string): Promise<void> {
    console.log("=== TextInjectionService.runAppleScript ===");
    console.log("Script to execute:", script);

    return new Promise((resolve, reject) => {
      console.log("Spawning osascript process...");

      const process = execFile(
        "osascript",
        ["-e", script],
        (error, stdout, stderr) => {
          if (error) {
            console.error("=== TextInjectionService.runAppleScript ERROR ===");
            console.error("osascript error:", error);
            console.error("stderr:", stderr);
            reject(error);
          } else {
            console.log("osascript completed successfully");
            console.log("stdout:", stdout);
            resolve();
          }
        },
      );

      process.on("error", (error) => {
        console.error(
          "=== TextInjectionService.runAppleScript PROCESS ERROR ===",
        );
        console.error("Process error:", error);
        reject(error);
      });
    });
  }
}
