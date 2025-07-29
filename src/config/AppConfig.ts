import { join } from "path";
import { homedir } from "os";

export type DictationWindowPosition = "active-app-corner" | "screen-corner";

export class AppConfig {
  modelPath: string;
  serverPort: number;
  defaultModel: string;
  cachePath: string;
  dataDir: string;

  // Dictation window configuration
  dictationWindowPosition: DictationWindowPosition;
  dictationWindowWidth: number;
  dictationWindowHeight: number;
  dictationWindowOpacity: number;
  showDictationWindowAlways: boolean;
  skipSelectedTextRetrieval: boolean; // New option for faster startup

  // Text transformation configuration
  transformToUppercase: boolean;
  transformToLowercase: boolean;
  transformCapitalize: boolean;
  transformTrim: boolean;

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "Systran/faster-whisper-tiny.en";
    this.cachePath = "";
    this.dataDir = join(__dirname, "../../.whispermac-data");

    // Dictation window defaults
    this.dictationWindowPosition = "screen-corner";
    this.dictationWindowWidth = 400;
    this.dictationWindowHeight = 50;
    this.dictationWindowOpacity = 0.95;
    this.showDictationWindowAlways = false;
    this.skipSelectedTextRetrieval = false; // Set to true for fastest startup

    // Text transformation defaults
    this.transformToUppercase = true; // Default to uppercase transformation
    this.transformToLowercase = false;
    this.transformCapitalize = false;
    this.transformTrim = true;
  }

  setCachePath(path: string): void {
    this.cachePath = path;
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
