import { execFile } from "child_process";
import { join } from "path";

export interface SelectedTextResult {
  text: string;
  hasSelection: boolean;
}

export class SelectedTextService {
  async getSelectedText(): Promise<SelectedTextResult> {
    try {
      const script = `
        tell application "System Events"
          set selectedText to ""
          try
            keystroke "c" using command down
            delay 0.1
            set selectedText to the clipboard
          end try
          return selectedText
        end tell
      `;

      const result = await this.runAppleScript(script);
      return {
        text: result.trim(),
        hasSelection: result.trim().length > 0,
      };
    } catch (error) {
      console.error("AppleScript failed:", error);
      return {
        text: "",
        hasSelection: false,
      };
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
