import { keyboard, Key } from "@nut-tree-fork/nut-js";
import { clipboard } from "electron";

export interface SelectedTextResult {
  text: string;
  hasSelection: boolean;
  originalClipboard: string;
}

export class SelectedTextService {
  getClipboardContent(): string {
    return clipboard.readText();
  }

  setClipboardContent(text: string): void {
    clipboard.writeText(text);
  }

  async getSelectedText(): Promise<SelectedTextResult> {
    console.log("=== SelectedTextService.getSelectedText ===");

    const originalClipboard = this.getClipboardContent();

    try {
      // Set a unique marker to detect if clipboard changes
      const marker = "1z4*5eiur_45r|uyt}r4";
      this.setClipboardContent(marker);

      // Small delay to ensure clipboard is set
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Copy selected text using keyboard shortcut
      await keyboard.pressKey(Key.LeftCmd, Key.C);
      await keyboard.releaseKey(Key.LeftCmd, Key.C);

      // Wait for clipboard to update
      await new Promise((resolve) => setTimeout(resolve, 100));

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
