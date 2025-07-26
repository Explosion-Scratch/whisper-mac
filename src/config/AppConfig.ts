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

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "Systran/faster-whisper-tiny.en";
    this.cachePath = "";
    this.dataDir = join(__dirname, "../../.whispermac-data");

    // Dictation window defaults
    this.dictationWindowPosition = "active-app-corner";
    this.dictationWindowWidth = 300;
    this.dictationWindowHeight = 120;
    this.dictationWindowOpacity = 0.95;
    this.showDictationWindowAlways = false;
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
