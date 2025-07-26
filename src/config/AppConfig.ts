export class AppConfig {
  modelPath: string;
  serverPort: number;
  defaultModel: string;
  cachePath: string;

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "tiny.en";
    this.cachePath = "";
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
}
