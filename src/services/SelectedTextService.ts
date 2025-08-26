import { clipboard } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
  private injectUtilPath: string;

  constructor() {
    this.injectUtilPath = `${process.cwd()}/dist/injectUtil`;
  }

  getClipboardContent(): string {
    return clipboard.readText();
  }

  setClipboardContent(text: string): void {
    clipboard.writeText(text);
  }

  async getActiveWindowInfo(): Promise<ActiveWindowInfo> {
    try {
      const { stdout, stderr } = await execFileAsync(this.injectUtilPath, [
        "--window-app-details",
      ]);

      if (stderr) {
        console.error("injectUtil stderr:", stderr);
      }

      const parts = stdout.trim().split("|");
      if (parts.length === 2) {
        return {
          title: parts[0] || "",
          appName: parts[1] || "",
        };
      } else {
        return { title: "", appName: "" };
      }
    } catch (error) {
      console.error("Failed to get window info using injectUtil:", error);
      return { title: "", appName: "" };
    }
  }

  async getSelectedText(): Promise<SelectedTextResult> {
    console.log("=== SelectedTextService.getSelectedText ===");

    const originalClipboard = this.getClipboardContent();

    try {
      const { stdout, stderr } = await execFileAsync(this.injectUtilPath, [
        "--get-selection",
      ]);

      if (stderr) {
        console.error("injectUtil stderr:", stderr);
      }

      const selectedText = stdout.trim();
      const hasSelection = selectedText.length > 0;

      console.log("injectUtil-based result:", {
        text: selectedText,
        hasSelection,
        length: selectedText.length,
        originalClipboard,
      });

      const result: SelectedTextResult = {
        text: selectedText,
        hasSelection,
        originalClipboard,
      };

      console.log("SelectedTextService.getSelectedText output:", result);
      return result;
    } catch (error) {
      console.error("Failed to get selected text using injectUtil:", error);
      return {
        text: "",
        originalClipboard: originalClipboard,
        hasSelection: false,
      };
    }
  }
}
