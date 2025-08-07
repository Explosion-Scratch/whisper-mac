import { join, resolve } from "path";
import { homedir } from "os";
import { readPrompt } from "../helpers/getPrompt";

export type DictationWindowPosition = "active-app-corner" | "screen-corner";

export interface AiTransformationConfig {
  enabled: boolean;
  prompt: string;
  baseUrl: string;
  envKey: string;
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
  dictationWindowOpacity: number;
  showDictationWindowAlways: boolean;

  // Text transformation configuration
  transformTrim: boolean;

  // AI transformation configuration
  ai: AiTransformationConfig;

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "Systran/faster-whisper-tiny.en";
    this.dataDir = resolve(__dirname, "../../.whispermac-data");

    // Dictation window defaults
    this.dictationWindowPosition = "screen-corner";
    this.dictationWindowWidth = 400;
    this.dictationWindowHeight = 50;
    this.dictationWindowOpacity = 0.95;
    this.showDictationWindowAlways = false;

    // Text transformation defaults
    this.transformTrim = true;

    // AI transformation defaults
    this.ai = {
      enabled: true,
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      envKey: "CEREBRAS",
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
