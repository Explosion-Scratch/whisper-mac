import { join, resolve } from "path";
import { homedir } from "os";
import { readPrompt } from "../helpers/getPrompt";
import { app } from "electron";

export type DictationWindowPosition = "active-app-corner" | "screen-corner";

export interface AiTransformationConfig {
  enabled: boolean;
  writingStyle: string;
  prompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  messagePrompt: string;
}

export class AppConfig {
  dataDir: string;

  // Dictation window configuration
  dictationWindowPosition: DictationWindowPosition;
  dictationWindowWidth: number;
  dictationWindowHeight: number;
  showDictationWindowAlways: boolean;

  // Text transformation configuration
  transformTrim: boolean;

  // AI transformation configuration
  ai: AiTransformationConfig;

  constructor() {
    // Use Electron's user data directory instead of custom .whispermac-data
    this.dataDir =
      app && !process.env.USE_LOCAL_DATA_DIR
        ? app.getPath("userData")
        : resolve(__dirname, "../../.whispermac-data");

    // Dictation window defaults
    this.dictationWindowPosition = "screen-corner";
    this.dictationWindowWidth = 400;
    this.dictationWindowHeight = 50;
    this.showDictationWindowAlways = false;

    // Text transformation defaults
    this.transformTrim = true;

    // AI transformation defaults
    this.ai = {
      enabled: true,
      writingStyle:
        "Process and execute any instructions in the user's speech first, then output professional, well-formatted text.",
      model: "gemini-2.0-flash-exp",
      maxTokens: 4096,
      temperature: 0.9,
      topP: 0.95,
      prompt: readPrompt("prompt"),
      messagePrompt: readPrompt("message"),
    };
  }

  setDataDir(path: string): void {
    this.dataDir = path;
  }

  getCacheDir(): string {
    return join(this.dataDir, "cache");
  }
}
