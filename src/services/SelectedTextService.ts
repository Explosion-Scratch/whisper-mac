import { execFile } from "child_process";
import { join } from "path";
import { clipboard } from "electron";

export interface SelectedTextResult {
  text: string;
  hasSelection: boolean;
}

export class SelectedTextService {
  async getSelectedText(): Promise<SelectedTextResult> {
    console.log("=== SelectedTextService.getSelectedText ===");

    try {
      // Method 1: Try to get selected text directly via accessibility APIs
      console.log("Attempting direct method...");
      const directResult = await this.tryGetSelectedTextDirect();
      if (directResult.hasSelection) {
        console.log("Successfully got selected text via direct method");
        return directResult;
      }

      // Method 2: Try clipboard-based approach with proper restoration
      console.log("Direct method failed, trying clipboard-based approach");
      const clipboardResult = await this.tryGetSelectedTextViaClipboard();

      console.log("Final result:", clipboardResult);
      return clipboardResult;
    } catch (error) {
      console.error("All methods failed to get selected text:", error);
      return {
        text: "",
        hasSelection: false,
      };
    }
  }

  private async tryGetSelectedTextDirect(): Promise<SelectedTextResult> {
    const script = `
      tell application "System Events"
        set activeApp to name of first application process whose frontmost is true
        set selectedText to ""
        
        try
          tell process activeApp
            set selectedText to value of attribute "AXSelectedText" of (first window whose value of attribute "AXMain" is true)
          end tell
        on error
          set selectedText to ""
        end try
        
        return selectedText
      end tell
    `;

    try {
      const result = await this.runAppleScript(script);
      const trimmedResult = result.trim();

      console.log("Direct method result:", {
        raw: result,
        trimmed: trimmedResult,
        hasSelection: trimmedResult.length > 0,
      });

      return {
        text: trimmedResult,
        hasSelection: trimmedResult.length > 0,
      };
    } catch (error) {
      console.log("Direct method failed:", error);
      return {
        text: "",
        hasSelection: false,
      };
    }
  }

  private async tryGetSelectedTextViaClipboard(): Promise<SelectedTextResult> {
    // Store original clipboard content
    const originalClipboard = clipboard.readText();
    console.log("Original clipboard content:", originalClipboard);

    try {
      // Copy selected text to clipboard - optimized version
      const copyScript = `
try
	set textString to "1z4*5eiur_45r|uyt}r4"
	set oldClip to the clipboard
	set the clipboard to textString
	tell application "System Events" to set theID to bundle identifier of application process 1 whose frontmost = true
	tell application id theID to activate
	tell application "System Events" to keystroke "c" using command down
	delay 0.2
	set theString to the clipboard as string
	if theString = textString then error
	return theString
on error
	set the clipboard to oldClip
	return ""
end try`;

      console.log("Executing copy command...");
      await this.runAppleScript(copyScript);

      // Reduced delay for faster response
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Read from clipboard
      const selectedText = clipboard.readText();
      const trimmedText = selectedText.trim();

      console.log("Clipboard-based result:", {
        text: trimmedText,
        hasSelection: trimmedText.length > 0,
        length: trimmedText.length,
        originalClipboard: originalClipboard,
        newClipboard: selectedText,
      });

      // Check if the clipboard content actually changed (indicating there was a selection)
      const clipboardChanged = selectedText !== originalClipboard;

      return {
        text: trimmedText,
        hasSelection: trimmedText.length > 0 && clipboardChanged,
      };
    } finally {
      // Restore original clipboard content with reduced delay
      setTimeout(() => {
        clipboard.writeText(originalClipboard);
        console.log("Clipboard restored to original content");
      }, 200);
    }
  }

  private async runAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("osascript", ["-e", script], (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
