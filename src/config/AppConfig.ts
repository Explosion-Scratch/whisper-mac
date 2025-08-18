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

  // Plugin configuration storage
  private pluginConfig: Record<string, any> = {};

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
      writingStyle: readPrompt("writing_style"),
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

  /**
   * Generic getter for plugin configuration
   */
  get(key: string): any {
    return this.pluginConfig[key];
  }

  /**
   * Generic setter for plugin configuration
   */
  set(key: string, value: any): void {
    this.pluginConfig[key] = value;
  }

  /**
   * Check if a plugin config key exists
   */
  has(key: string): boolean {
    return key in this.pluginConfig;
  }

  /**
   * Delete a plugin config key
   */
  delete(key: string): boolean {
    if (key in this.pluginConfig) {
      delete this.pluginConfig[key];
      return true;
    }
    return false;
  }

  /**
   * Get all plugin configuration
   */
  getPluginConfig(): Record<string, any> {
    return { ...this.pluginConfig };
  }

  /**
   * Set multiple plugin config values
   */
  setPluginConfig(config: Record<string, any>): void {
    this.pluginConfig = { ...this.pluginConfig, ...config };
  }
}
