import { join, resolve } from "path";
import { homedir } from "os";
import { readPrompt } from "../helpers/getPrompt";
import { app } from "electron";

export type DictationWindowPosition = "active-app-corner" | "screen-corner";

export interface AiTransformationConfig {
  enabled: boolean;
  writingStyle: string;
  prompt: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  messagePrompt: string;
}

export class AppConfig {
  modelPath: string;
  serverPort: number;
  defaultModel: string;
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
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "Systran/faster-whisper-tiny.en";

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
        'I type all lowercase without punctuation except for exclamation points in messaging apps like instagram or imessage. Emails should be very concise, don\'t make them flowery. I frequently dictate instructions like "Set menu bar icon in electron" and in these instances I want you to simply correct and fix grammar or interpret the request but not fulfill it, e.g. you\'d respond "Set menu bar icon in Electron". Only if I explicitly ask you should you fulfill a request I\'m dictating, or when selected text is provided.',
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      model: "qwen-3-32b",
      maxTokens: 16382,
      temperature: 0.6,
      topP: 0.95,
      prompt: readPrompt("prompt"),
      messagePrompt: readPrompt("message"),
    };
  }

  setModelPath(path: string): void {
    this.modelPath = path;
  }

  setServerPort(port: number): void {
    this.serverPort = port;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  setDataDir(path: string): void {
    this.dataDir = path;
  }

  getModelsDir(): string {
    return join(this.dataDir, "models");
  }

  getCacheDir(): string {
    return join(this.dataDir, "cache");
  }

  getWhisperLiveDir(): string {
    return join(this.dataDir, "whisperlive");
  }
}
