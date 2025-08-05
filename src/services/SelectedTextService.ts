import { keyboard, Key } from "@nut-tree-fork/nut-js";
import { clipboard } from "electron";

export interface SelectedTextResult {
  text: string;
  hasSelection: boolean;
  originalClipboard: string;
}

export interface ActiveWindowInfo {
  title: string;
  appName: string;
}

export class SelectedTextService {
  getClipboardContent(): string {
    return clipboard.readText();
  }

  setClipboardContent(text: string): void {
    clipboard.writeText(text);
  }

  async getActiveWindowInfo(): Promise<ActiveWindowInfo> {
    return new Promise((resolve) => {
      const { execFile } = require("child_process");

      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set frontWindow to first window of frontApp
          set windowTitle to name of frontWindow
          set appName to name of frontApp
          return windowTitle & "|" & appName
        end tell
      `;

      execFile("osascript", ["-e", script], (error: any, stdout: string) => {
        if (error) {
          console.error("AppleScript error getting window info:", error);
          resolve({ title: "", appName: "" });
          return;
        }

        try {
          const parts = stdout.trim().split("|");
          if (parts.length === 2) {
            resolve({
              title: parts[0] || "",
              appName: parts[1] || "",
            });
          } else {
            resolve({ title: "", appName: "" });
          }
        } catch (parseError) {
          console.error("Failed to parse window info:", parseError);
          resolve({ title: "", appName: "" });
        }
      });
    });
  }

  async getSelectedText(): Promise<SelectedTextResult> {
    console.log("=== SelectedTextService.getSelectedText ===");

    const originalClipboard = this.getClipboardContent();

    try {
      // Set a unique marker to detect if clipboard changes
      const marker = "1z4*5eiur_45r|uyt}r4";
      this.setClipboardContent(marker);

      // Reduced delay from 50ms to 20ms
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Copy selected text using keyboard shortcut
      await keyboard.pressKey(Key.LeftCmd, Key.C);
      await keyboard.releaseKey(Key.LeftCmd, Key.C);

      // Reduced delay from 100ms to 50ms
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Read the new clipboard content
      const newClipboard = this.getClipboardContent();
      const trimmedText = newClipboard.trim();

      console.log("Clipboard-based result:", {
        text: trimmedText,
        hasSelection: trimmedText.length > 0,
        length: trimmedText.length,
        originalClipboard: originalClipboard,
        newClipboard: newClipboard,
      });

      // Check if the clipboard content actually changed (indicating there was a selection)
      // If clipboard still contains our marker, no text was selected
      const clipboardChanged =
        newClipboard !== originalClipboard && newClipboard !== marker;

      let out = {
        text: clipboardChanged ? trimmedText : "",
        hasSelection: trimmedText.length > 0 && clipboardChanged,
        originalClipboard: originalClipboard,
      };
      console.log("SelectedTextService.getSelectedText output:", out);
      return out;
    } catch (error) {
      console.error("Failed to get selected text:", error);
      return {
        text: "",
        originalClipboard: originalClipboard,
        hasSelection: false,
      };
    }
  }
}
