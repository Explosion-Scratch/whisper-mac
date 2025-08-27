import { macInput } from "../native/MacInput";

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
  constructor() {}

  async getActiveWindowInfo(): Promise<ActiveWindowInfo> {
    try {
      const { macInput } = await import("../native/MacInput");
      const details = macInput?.getWindowAppDetails?.();
      if (!details) return { title: "", appName: "" };
      const parts = String(details).trim().split("|");
      if (parts.length === 2) {
        return { title: parts[0] || "", appName: parts[1] || "" };
      }
      return { title: "", appName: "" };
    } catch (error) {
      console.error("Failed to get window info via native addon:", error);
      return { title: "", appName: "" };
    }
  }

  async getSelectedText(): Promise<SelectedTextResult> {
    try {
      const result = macInput?.getSelectedText?.();
      if (!result) {
        return { text: "", hasSelection: false, originalClipboard: "" };
      }
      const text = String(result.text || "");
      const originalFromNative = String(result.originalClipboard || "");
      const hasSelection =
        text.trim().length > 0 && text !== originalFromNative;
      return {
        text,
        hasSelection,
        originalClipboard: originalFromNative,
      };
    } catch (error) {
      console.error("Failed to get selected text via native addon:", error);
      return { text: "", hasSelection: false, originalClipboard: "" };
    }
  }
}
