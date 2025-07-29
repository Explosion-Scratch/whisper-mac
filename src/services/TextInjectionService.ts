import { execFile } from "child_process";
import { join } from "path";

export class TextInjectionService {
  private accessibilityEnabled: boolean | null = null;

  async insertText(text: string): Promise<void> {
    try {
      // Use AppleScript to insert text into the active application
      const script = `
        tell application "System Events"
          keystroke "${this.escapeText(text)}"
        end tell
      `;

      await this.runAppleScript(script);
    } catch (error) {
      console.error("Failed to insert text:", error);

      // Fallback: Copy to clipboard and paste
      await this.fallbackInsert(text);
    }
  }

  private escapeText(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
  }

  private async runAppleScript(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile("osascript", ["-e", script], (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async fallbackInsert(text: string): Promise<void> {
    const { clipboard } = require("electron");
    const originalClipboard = clipboard.readText();

    clipboard.writeText(text);

    // Send Cmd+V to paste
    const pasteScript = `
      tell application "System Events"
        keystroke "v" using command down
      end tell
    `;

    await this.runAppleScript(pasteScript);

    // Restore original clipboard after a delay
    setTimeout(() => {
      clipboard.writeText(originalClipboard);
    }, 1000);
  }

  /**
   * Check if accessibility permissions are enabled and show instructions if not
   */
  async ensureAccessibilityPermissions(): Promise<boolean> {
    console.log("=== TextInjectionService.ensureAccessibilityPermissions ===");

    const hasAccessibility = await this.checkAccessibilityPermissions();

    if (!hasAccessibility) {
      console.log(
        "Accessibility permissions not enabled, showing instructions..."
      );
      await this.showAccessibilityInstructions();
    }

    return hasAccessibility;
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
   * Show instructions for enabling accessibility permissions
   */
  async showAccessibilityInstructions(): Promise<void> {
    console.log("=== TextInjectionService.showAccessibilityInstructions ===");

    const script = `
      display dialog "WhisperMac needs accessibility permissions to automatically paste text.

To enable:
1. Go to System Preferences > Security & Privacy > Privacy > Accessibility
2. Click the lock icon and enter your password
3. Add WhisperMac to the list of allowed apps
4. Restart WhisperMac

Until then, text will be copied to clipboard for manual pasting." buttons {"OK"} default button "OK" with title "Accessibility Permissions Required"
    `;

    try {
      await this.runAppleScript(script);
      console.log("Accessibility instructions displayed successfully");
    } catch (error) {
      console.error("Failed to show accessibility instructions:", error);
      console.log(
        "ACCESSIBILITY PERMISSIONS REQUIRED - CHECK SYSTEM PREFERENCES"
      );
    }
  }
}
