import { join } from "path";
import { homedir } from "os";

export class AppConfig {
  modelPath: string;
  serverPort: number;
  defaultModel: string;
  cachePath: string;
  dataDir: string;

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "Systran/faster-whisper-tiny.en";
    this.cachePath = "";
    this.dataDir = join(__dirname, "../../.whispermac-data");
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
