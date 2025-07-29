import { keyboard, Key } from "@nut-tree-fork/nut-js";
import { execFile } from "child_process";

export interface SelectedTextResult {
  text: string;
  hasSelection: boolean;
}

export class SelectedTextService {
  private async getClipboardContent(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("osascript", ["-e", "the clipboard"], (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  private async setClipboardContent(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Escape special characters for AppleScript
      const escapedText = text.replace(/"/g, '\\"');
      const script = `set the clipboard to "${escapedText}"`;

      execFile("osascript", ["-e", script], (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async getSelectedText(): Promise<SelectedTextResult> {
    console.log("=== SelectedTextService.getSelectedText ===");

    try {
      // Store original clipboard content
      const originalClipboard = await this.getClipboardContent();
      console.log("Original clipboard content:", originalClipboard);

      // Set a unique marker to detect if clipboard changes
      const marker = "1z4*5eiur_45r|uyt}r4";
      await this.setClipboardContent(marker);

      // Small delay to ensure clipboard is set
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Copy selected text using keyboard shortcut
      await keyboard.pressKey(Key.LeftCmd, Key.C);
      await keyboard.releaseKey(Key.LeftCmd, Key.C);

      // Wait for clipboard to update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Read the new clipboard content
      const newClipboard = await this.getClipboardContent();
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

      // Restore original clipboard content
      setTimeout(async () => {
        try {
          await this.setClipboardContent(originalClipboard);
          console.log("Clipboard restored to original content");
        } catch (error) {
          console.error("Failed to restore clipboard:", error);
        }
      }, 200);

      return {
        text: trimmedText,
        hasSelection: trimmedText.length > 0 && clipboardChanged,
      };
    } catch (error) {
      console.error("Failed to get selected text:", error);
      return {
        text: "",
        hasSelection: false,
      };
    }
  }
}
