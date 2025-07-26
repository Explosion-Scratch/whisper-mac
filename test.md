# Project Context

## Project Structure

```
.
├── assets
├── python
│   ├── download_model.py
│   └── whisper_server.py
├── scripts
│   ├── copy-assets.js
│   └── test-server.js
├── src
│   ├── config
│   │   └── AppConfig.ts
│   ├── preload
│   │   └── audioPreload.ts
│   ├── renderer
│   │   └── audioCapture.html
│   ├── services
│   │   ├── AudioCaptureService.ts
│   │   ├── ModelManager.ts
│   │   ├── TextInjectionService.ts
│   │   └── WhisperLiveClient.ts
│   └── main.ts
├── .aiignore
├── .gitignore
├── icons.js
├── package.json
├── test-server.html
├── test.md
└── tsconfig.json
```

## File Contents

---
### `.aiignore`

```
Pipfile
bun.lock
models
dist
```

---
### `.gitignore`

```
models/
dist/
```

---
### `icons.js`

```javascript
#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

//
// Icon definitions
function getIconUrl(iconName, color = "#000000") {
  const iconMap = {
    "icon-template": "ph:microphone",
    "icon-recording": "ph:record-fill",
  };
  const iconId = iconMap[iconName];
  if (!iconId) {
    throw new Error(`Unknown icon name: ${iconName}`);
  }
  // Encode iconId for URL safety
  const encodedIconId = encodeURIComponent(iconId);
  // Encode color for URL safety
  const encodedColor = encodeURIComponent(color);
  return `https://api.iconify.design/${encodedIconId}.svg?color=${encodedColor}`;
}

const ICONS = {
  "icon-template": getIconUrl("icon-template"),
  "icon-recording": getIconUrl("icon-recording"),
};

// PNG size
const SIZE = "32x32";

// Output directory
const ASSETS_DIR = path.resolve(__dirname, "assets");
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Helper to download SVG
function downloadSVG(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to download ${url}: ${response.statusCode}`),
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

// Main logic
async function main() {
  const iconArg = process.argv[2];
  let iconsToProcess = Object.keys(ICONS);

  if (iconArg) {
    if (!ICONS[iconArg]) {
      console.error(`Invalid icon option: ${iconArg}`);
      process.exit(1);
    }
    iconsToProcess = [iconArg];
  }

  for (const icon of iconsToProcess) {
    const svgUrl = ICONS[icon];
    const svgPath = path.join(ASSETS_DIR, `${icon}.svg`);
    const pngPath = path.join(ASSETS_DIR, `${icon}.png`);

    console.log(`Downloading ${icon} from ${svgUrl}...`);
    await downloadSVG(svgUrl, svgPath);

    console.log(`Converting ${svgPath} to ${pngPath}...`);
    execSync(
      `convert "${svgPath}" -flatten -background white -resize ${SIZE} "${pngPath}"`,
    );
  }

  console.log("Icons downloaded and converted to PNGs in ./assets");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
```

---
### `package.json`

```json
{
  "name": "whispermac",
  "version": "1.0.0",
  "description": "AI-powered dictation for Mac using WhisperLive",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc && node scripts/copy-assets.js",
    "start": "electron dist/main.js",
    "dev": "concurrently \"tsc -w\" \"nodemon --exec electron dist/main.js\" \"node scripts/copy-assets.js\"",
    "pack": "electron-builder",
    "dist": "electron-builder --publish=never"
  },
  "dependencies": {
    "axios": "^1.4.0",
    "electron": "^25.0.0",
    "open": "^10.2.0",
    "ws": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.0.0",
    "electron-builder": "^24.0.0",
    "concurrently": "^8.0.0",
    "nodemon": "^3.0.0"
  },
  "build": {
    "appId": "com.whispermac.app",
    "productName": "WhisperMac",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "python/**/*",
      "assets/**/*"
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "target": "dmg"
    },
    "dmg": {
      "contents": [
        {
          "x": 130,
          "y": 220
        },
        {
          "x": 410,
          "y": 220,
          "type": "link",
          "path": "/Applications"
        }
      ]
    }
  }
}
```

---
### `python/download_model.py`

```python
#!/usr/bin/env python3
import argparse
import os
import subprocess

WHISPER_MODEL_URLS = {
    "tiny.en": "https://openaipublic.azureedge.net/main/whisper/models/d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03/tiny.en.pt",
    "tiny": "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
    "base.en": "https://openaipublic.azureedge.net/main/whisper/models/25a8566e1d0c1e2231d1c762132cd20e0f96a85d16145c3a00adf5d1ac670ead/base.en.pt",
    "base": "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
    "small.en": "https://openaipublic.azureedge.net/main/whisper/models/f953ad0fd29cacd07d5a9eda5624af0f6bcf2258be67c92b79389873d91e0872/small.en.pt",
    "small": "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
    "medium.en": "https://openaipublic.azureedge.net/main/whisper/models/d7440d1dc186f76616474e0ff0b3b6b879abc9d1a4926b7adfa41db2d497ab4f/medium.en.pt",
    "medium": "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
    "large-v2": "https://openaipublic.azureedge.net/main/whisper/models/e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a/large-v2.pt",
    "large-v3": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v3.pt",
    "large": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v3.pt",
}


def get_model_url(model_name):
    return WHISPER_MODEL_URLS.get(model_name)


def download_model(model_name, output_dir):
    url = get_model_url(model_name)
    if not url:
        raise ValueError(f"Unknown model name: {model_name}")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{model_name}.pt")
    if os.path.exists(output_path):
        print(f"Model already exists: {output_path}")
        return output_path
    print(f"Downloading {model_name} from {url} to {output_path}")
    try:
        subprocess.run(["wget", "-O", output_path, url], check=True)
    except Exception as e:
        print(f"Failed to download model: {e}")
        return None
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Download OpenAI Whisper Model"
    )
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Whisper model size (e.g., tiny, base, small, medium, large-v2, large-v3)",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=False,
        default=os.path.expanduser("~/.cache/whisper-live/"),
        help="Directory to save the model",
    )
    args = parser.parse_args()
    download_model(args.model, args.output)
```

---
### `python/whisper_server.py`

```python
import argparse
import sys

from whisper_live.server import TranscriptionServer


def main():
    parser = argparse.ArgumentParser(description="WhisperMac Server")
    parser.add_argument("--port", type=int, default=9090, help="Server port")
    parser.add_argument(
        "--model", type=str, default="tiny", help="Whisper model size"
    )
    parser.add_argument(
        "--model-path",
        type=str,
        default=None,
        help="Path to custom Whisper model",
    )

    args = parser.parse_args()

    # Pass model_path to TranscriptionServer (customize as needed)
    server = TranscriptionServer()

    try:
        server.run(
            host="0.0.0.0",
            port=args.port,
            faster_whisper_custom_model_path=args.model_path,
            backend="faster_whisper",
        )
    except Exception as e:
        print(f"Server error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

---
### `scripts/copy-assets.js`

```javascript
#!/usr/bin/env bun

const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../src/renderer");
const distDir = path.join(__dirname, "../dist/renderer");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.readdirSync(srcDir).forEach((file) => {
  if (file.endsWith(".html")) {
    fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
    console.log(`Copied ${file} to dist/renderer`);
  }
});
```

---
### `scripts/test-server.js`

```javascript
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Paths
const pythonServerPath = path.join(__dirname, "../python/whisper_server.py");
const modelDir = path.join(__dirname, "../models");
const modelName = "tiny.en";
const modelPath = path.join(modelDir, `${modelName}.pt`);
const port = 9090;
const testHtmlPath = path.join(__dirname, "../test-server.html");

// Check if model exists
if (!fs.existsSync(modelPath)) {
  console.error(`Model file not found: ${modelPath}`);
  process.exit(1);
}

// Start Python server
console.log(`Starting Whisper server on port ${port}...`);
const serverProcess = spawn(
  "python3",
  [
    pythonServerPath,
    "--port",
    port.toString(),
    "--model",
    modelName,
    "--model-path",
    modelPath,
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);

serverProcess.stdout.on("data", (data) => {
  console.log(`[server stdout] ${data.toString().trim()}`);
});

serverProcess.stderr.on("data", (data) => {
  console.error(`[server stderr] ${data.toString().trim()}`);
});

serverProcess.on("exit", (code) => {
  console.log(`Whisper server exited with code ${code}`);
  process.exit(code);
});

// Open test HTML file in default browser using CLI
console.log(`Opening test HTML: ${testHtmlPath}`);
spawn("open", [testHtmlPath], { stdio: "ignore" });

// Cleanup on exit
process.on("SIGINT", () => {
  console.log("Shutting down server...");
  serverProcess.kill("SIGTERM");
  process.exit(0);
});
```

---
### `src/config/AppConfig.ts`

```typescript
export class AppConfig {
  modelPath: string;
  serverPort: number;
  defaultModel: string;

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "tiny.en";
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
```

---
### `src/main.ts`

```typescript
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
} from "electron";
import { join } from "path";
import { AudioCaptureService } from "./services/AudioCaptureService";
import { WhisperLiveClient } from "./services/WhisperLiveClient";
import { TextInjectionService } from "./services/TextInjectionService";
import { ModelManager } from "./services/ModelManager";
import { AppConfig } from "./config/AppConfig";

class WhisperMacApp {
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private modelManagerWindow: BrowserWindow | null = null;
  private audioService: AudioCaptureService;
  private whisperClient: WhisperLiveClient;
  private textInjector: TextInjectionService;
  private modelManager: ModelManager;
  private config: AppConfig;
  private isRecording = false;

  constructor() {
    this.config = new AppConfig();
    this.audioService = new AudioCaptureService(this.config);
    this.whisperClient = new WhisperLiveClient(this.config);
    this.textInjector = new TextInjectionService();
    this.modelManager = new ModelManager(this.config);
  }

  async initialize() {
    await app.whenReady();

    // Set the model path in config
    const modelsDir = join(__dirname, "../../models");
    this.config.setModelPath(modelsDir);

    // Check and download Whisper tiny model on first launch
    await this.modelManager.ensureModelExists(this.config.defaultModel);

    // Start WhisperLive server
    await this.whisperClient.startServer(this.config.defaultModel);

    this.createTray();
    this.registerGlobalShortcuts();
    this.setupIpcHandlers();

    // Hide dock icon for menu bar only app
    app.dock?.hide();
  }

  private setupIpcHandlers() {
    // Example: listen for dictation requests from renderer
    ipcMain.on("start-dictation", async (event: Electron.IpcMainEvent) => {
      await this.startRecording();
      event.reply("dictation-started");
    });
    ipcMain.on("stop-dictation", async (event: Electron.IpcMainEvent) => {
      await this.stopRecording();
      event.reply("dictation-stopped");
    });
    // Extend with more handlers as needed
    console.log("IPC Handlers set up");
  }

  private showSettings() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return;
    }
    // Create settings window
    this.settingsWindow = new BrowserWindow({
      width: 400,
      height: 600,
      webPreferences: { nodeIntegration: true },
    });
    this.settingsWindow.loadFile("settings.html"); // Or use loadURL if React/Vue
    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });
  }

  private showModelManager() {
    if (this.modelManagerWindow && !this.modelManagerWindow.isDestroyed()) {
      this.modelManagerWindow.focus();
      return;
    }
    this.modelManagerWindow = new BrowserWindow({
      width: 400,
      height: 400,
      webPreferences: { nodeIntegration: true },
    });
    this.modelManagerWindow.loadFile("model-manager.html");
    this.modelManagerWindow.on("closed", () => {
      this.modelManagerWindow = null;
    });
  }

  private createTray() {
    this.tray = new Tray(join(__dirname, "../assets/icon-template.png"));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Start Dictation",
        click: () => this.toggleRecording(),
        accelerator: "Cmd+Shift+D",
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => this.showSettings(),
      },
      {
        label: "Download Models",
        click: () => this.showModelManager(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip("WhisperMac - AI Dictation");
  }

  private registerGlobalShortcuts() {
    // Unregister any existing shortcuts first
    globalShortcut.unregisterAll();

    // Primary shortcut for dictation
    const success1 = globalShortcut.register("CommandOrControl+Shift+D", () => {
      console.log("CommandOrControl+Shift+D is pressed");
      this.toggleRecording();
    });

    // Alternative shortcut
    const success2 = globalShortcut.register(
      "CommandOrControl+Option+Space",
      () => {
        console.log("CommandOrControl+Option+Space is pressed");
        this.toggleRecording();
      },
    );

    // Log if registration failed
    if (!success1) {
      console.error("Failed to register CommandOrControl+Shift+D shortcut");
    }

    if (!success2) {
      console.error(
        "Failed to register CommandOrControl+Option+Space shortcut",
      );
    }

    // Log all registered shortcuts
    console.log(
      "Registered shortcuts:",
      globalShortcut.isRegistered("CommandOrControl+Shift+D"),
    );
  }

  private async toggleRecording() {
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording() {
    try {
      this.isRecording = true;
      this.updateTrayIcon("recording");

      // Start audio capture
      await this.audioService.startCapture();

      // Connect to WhisperLive
      await this.whisperClient.startTranscription((text: string) => {
        this.textInjector.insertText(text);
      });
    } catch (error) {
      console.error("Failed to start recording:", error);
      this.isRecording = false;
      this.updateTrayIcon("idle");
    }
  }

  private async stopRecording() {
    this.isRecording = false;
    this.updateTrayIcon("idle");

    await this.audioService.stopCapture();
    await this.whisperClient.stopTranscription();
  }

  private updateTrayIcon(state: "idle" | "recording") {
    const iconPath =
      state === "recording"
        ? "../assets/icon-recording.png"
        : "../assets/icon-template.png";
    this.tray?.setImage(join(__dirname, iconPath));
  }

  // Clean up when app quits
  cleanup() {
    globalShortcut.unregisterAll();
    this.whisperClient.stopServer();
  }
}

const appInstance = new WhisperMacApp();
appInstance.initialize();

// Handle app quit
app.on("will-quit", () => {
  appInstance.cleanup();
});

// Handle app activation (macOS)
app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // We don't need this for a menu bar app, but keeping it for completeness
});
```

---
### `src/preload/audioPreload.ts`

```typescript
import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  onAudioData: (callback: (data: Uint8Array) => void) => {
    ipcRenderer.on("audio-data", (_, data) => callback(data));
  },
  onAudioError: (callback: (error: string) => void) => {
    ipcRenderer.on("audio-error", (_, error) => callback(error));
  },
});
```

---
### `src/renderer/audioCapture.html`

```html
<!doctype html>
<html>
    <head>
        <title>Audio Capture</title>
    </head>
    <body>
        <script>
            const { ipcRenderer } = require("electron");

            let mediaRecorder = null;
            let stream = null;

            ipcRenderer.on("start-audio-capture", async () => {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: 16000,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                        },
                    });

                    mediaRecorder = new MediaRecorder(stream, {
                        mimeType: "audio/webm;codecs=opus",
                    });

                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            event.data.arrayBuffer().then((buffer) => {
                                const audioData = new Uint8Array(buffer);
                                ipcRenderer.send("audio-data", audioData);
                            });
                        }
                    };

                    // Send audio data every 100ms
                    mediaRecorder.start(100);
                    console.log("Audio capture started in renderer");
                } catch (error) {
                    console.error("Failed to start audio capture:", error);
                    ipcRenderer.send("audio-error", error.message);
                }
            });

            ipcRenderer.on("stop-audio-capture", () => {
                if (mediaRecorder && mediaRecorder.state !== "inactive") {
                    mediaRecorder.stop();
                }
                if (stream) {
                    stream.getTracks().forEach((track) => track.stop());
                    stream = null;
                }
                console.log("Audio capture stopped in renderer");
            });
        </script>
    </body>
</html>
```

---
### `src/services/AudioCaptureService.ts`

```typescript
import { EventEmitter } from "events";
import { BrowserWindow } from "electron";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";

export class AudioCaptureService extends EventEmitter {
  private audioWindow: BrowserWindow | null = null;
  private config: AppConfig;
  private isRecording = false;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  async startCapture(): Promise<void> {
    try {
      if (this.audioWindow) {
        // Already capturing
        return;
      }

      // Create a hidden window for audio capture
      this.audioWindow = new BrowserWindow({
        width: 1,
        height: 1,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: join(__dirname, "../preload/audioPreload.js"),
        },
      });

      // Load a simple HTML file for audio capture
      await this.audioWindow.loadFile(
        join(__dirname, "../renderer/audioCapture.html"),
      );

      // Send start capture command to renderer
      this.audioWindow.webContents.send("start-audio-capture");

      // Listen for audio data from renderer
      this.audioWindow.webContents.on(
        "ipc-message",
        (event, channel, ...args) => {
          if (channel === "audio-data") {
            this.emit("audioData", args[0]);
          } else if (channel === "audio-error") {
            this.emit("error", new Error(args[0]));
          }
        },
      );

      this.isRecording = true;
      console.log("Audio capture started via renderer process");
    } catch (error) {
      let errMsg = "Unknown error";
      if (error instanceof Error) {
        errMsg = error.message;
      }
      throw new Error(`Failed to start audio capture: ${errMsg}`);
    }
  }

  async stopCapture(): Promise<void> {
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      this.audioWindow.webContents.send("stop-audio-capture");

      // Give it a moment to clean up
      setTimeout(() => {
        if (this.audioWindow && !this.audioWindow.isDestroyed()) {
          this.audioWindow.close();
        }
        this.audioWindow = null;
      }, 100);
    }

    this.isRecording = false;
    console.log("Audio capture stopped");
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }
}
```

---
### `src/services/ModelManager.ts`

```typescript
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { app } from "electron";
import { spawn } from "child_process";
import { AppConfig } from "../config/AppConfig";

export class ModelManager {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  private getModelsDir(): string {
    return this.config.modelPath || join(__dirname, "../../models");
  }

  private ensureModelsDirectory(): void {
    const modelsDir = this.getModelsDir();
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
    }
  }

  async ensureModelExists(modelSize: string): Promise<boolean> {
    this.ensureModelsDirectory();
    const modelPath = join(this.getModelsDir(), `${modelSize}.pt`);
    if (existsSync(modelPath)) {
      return true;
    }
    return await this.downloadModel(modelSize);
  }

  private async downloadModel(modelSize: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Use WhisperLive's downloader
      const pythonScript = join(__dirname, "../../python/download_model.py");
      const modelsDir = this.getModelsDir();

      const process = spawn(
        "python3",
        [pythonScript, "--model", modelSize, "--output", modelsDir],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      process.stdout?.on("data", (data) => {
        console.log("Model download output:", data.toString());
      });

      process.stderr?.on("data", (data) => {
        console.error("Model download error:", data.toString());
      });

      process.on("close", (code) => {
        const modelPath = join(modelsDir, `${modelSize}.pt`);
        if (code === 0 && existsSync(modelPath)) {
          console.log(`Model ${modelSize} downloaded successfully`);
          resolve(true);
        } else {
          console.error(`Model download failed with code ${code}`);
          reject(new Error(`Model download failed with code ${code}`));
        }
      });
    });
  }
}
```

---
### `src/services/TextInjectionService.ts`

```typescript
import { execFile } from 'child_process';
import { join } from 'path';

export class TextInjectionService {
  async insertText(text: string): Promise<void> {
    try {
      // Use AppleScript to insert text into the active application
      const script = `
        tell application "System Events"
          keystroke "${this.escapeText(text)}"
        end tell
      `;
      
      await this.runAppleScript(script);
    } catch (error) {
      console.error('Failed to insert text:', error);
      
      // Fallback: Copy to clipboard and paste
      await this.fallbackInsert(text);
    }
  }

  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  private async runAppleScript(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async fallbackInsert(text: string): Promise<void> {
    const { clipboard } = require('electron');
    const originalClipboard = clipboard.readText();
    
    clipboard.writeText(text);
    
    // Send Cmd+V to paste
    const pasteScript = `
      tell application "System Events"
        keystroke "v" using command down
      end tell
    `;
    
    await this.runAppleScript(pasteScript);
    
    // Restore original clipboard after a delay
    setTimeout(() => {
      clipboard.writeText(originalClipboard);
    }, 1000);
  }
}
```

---
### `src/services/WhisperLiveClient.ts`

```typescript
import { spawn, ChildProcess } from "child_process";
import WebSocket from "ws";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";

export class WhisperLiveClient {
  private serverProcess: ChildProcess | null = null;
  private websocket: WebSocket | null = null;
  private config: AppConfig;
  private onTranscriptionCallback: ((text: string) => void) | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async startServer(modelSize: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const modelPath = join(this.config.modelPath, `${modelSize}.pt`);
      const pythonPath = join(__dirname, "../../python/whisper_server.py");

      console.log(`Starting WhisperLive server with model: ${modelPath}`);

      this.serverProcess = spawn(
        "python3",
        [
          pythonPath,
          "--port",
          this.config.serverPort.toString(),
          "--model",
          modelSize,
          "--model-path",
          modelPath,
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let serverStarted = false;

      setTimeout(() => {
        serverStarted = true;
        resolve();
      }, 1000);
      this.serverProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        console.log("WhisperLive Server:", output);

        if (
          output.includes("Uvicorn running on") ||
          output.includes("Server started")
        ) {
          if (!serverStarted) {
            serverStarted = true;
            resolve();
          }
        }
      });

      this.serverProcess.stderr?.on("data", (data) => {
        const errorOutput = data.toString();
        console.error("WhisperLive Server Error:", errorOutput);

        if (errorOutput.includes("Uvicorn running on") && !serverStarted) {
          serverStarted = true;
          resolve();
        }
      });

      this.serverProcess.on("error", (error) => {
        console.error("Failed to start WhisperLive server:", error);
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      this.serverProcess.on("exit", (code) => {
        console.log(`WhisperLive server exited with code ${code}`);
        if (code !== 0 && !serverStarted) {
          reject(new Error(`Server failed to start, exit code: ${code}`));
        }
      });

      setTimeout(() => {
        if (!serverStarted) {
          reject(new Error("Server startup timeout"));
        }
      }, 30000);
    });
  }

  async startTranscription(
    onTranscription: (text: string) => void,
  ): Promise<void> {
    this.onTranscriptionCallback = onTranscription;

    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.websocket = new WebSocket(`ws://localhost:${this.config.serverPort}`);

    this.websocket.on("open", () => {
      console.log("Connected to WhisperLive server");

      this.websocket?.send(
        JSON.stringify({
          type: "config",
          model: this.config.defaultModel,
          language: "auto",
          task: "transcribe",
        }),
      );
    });

    this.websocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "transcription" && message.text) {
          this.onTranscriptionCallback?.(message.text);
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    });

    this.websocket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    this.websocket.on("close", () => {
      console.log("WebSocket connection closed");
    });
  }

  sendAudioData(audioData: Uint8Array): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(audioData);
    }
  }

  async stopTranscription(): Promise<void> {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  async stopServer(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
  }
}
```

---
### `test-server.html`

```html
<!DOCTYPE html>
<html>
<head>
  <title>Whisper Server Test</title>
</head>
<body>
  <h1>Whisper Server Test</h1>
  <pre id="log"></pre>
  <script>
    function log(msg) {
      document.getElementById('log').textContent += msg + '\n';
      console.log(msg);
    }

    const ws = new WebSocket('ws://localhost:9090');
    ws.onopen = () => {
      log('WebSocket connected');
      ws.send(JSON.stringify({
        type: 'config',
        model: 'tiny.en',
        language: 'en',
        task: 'transcribe'
      }));
      // You can send test audio data here if desired
    };
    ws.onmessage = (event) => {
      log('Received: ' + event.data);
    };
    ws.onerror = (err) => {
      log('WebSocket error: ' + err);
    };
    ws.onclose = () => {
      log('WebSocket closed');
    };
  </script>
</body>
</html>
```

---
### `test.md`

```markdown

```

---
### `tsconfig.json`

```json
{
  "compilerOptions": {
    /* Visit https://aka.ms/tsconfig to read more about this file */

    /* Projects */
    // "incremental": true,                              /* Save .tsbuildinfo files to allow for incremental compilation of projects. */
    // "composite": true,                                /* Enable constraints that allow a TypeScript project to be used with project references. */
    // "tsBuildInfoFile": "./.tsbuildinfo",              /* Specify the path to .tsbuildinfo incremental compilation file. */
    // "disableSourceOfProjectReferenceRedirect": true,  /* Disable preferring source files instead of declaration files when referencing composite projects. */
    // "disableSolutionSearching": true,                 /* Opt a project out of multi-project reference checking when editing. */
    // "disableReferencedProjectLoad": true,             /* Reduce the number of projects loaded automatically by TypeScript. */

    /* Language and Environment */
    "target": "es2016" /* Set the JavaScript language version for emitted JavaScript and include compatible library declarations. */,
    // "lib": [],                                        /* Specify a set of bundled library declaration files that describe the target runtime environment. */
    // "jsx": "preserve",                                /* Specify what JSX code is generated. */
    // "experimentalDecorators": true,                   /* Enable experimental support for legacy experimental decorators. */
    // "emitDecoratorMetadata": true,                    /* Emit design-type metadata for decorated declarations in source files. */
    // "jsxFactory": "",                                 /* Specify the JSX factory function used when targeting React JSX emit, e.g. 'React.createElement' or 'h'. */
    // "jsxFragmentFactory": "",                         /* Specify the JSX Fragment reference used for fragments when targeting React JSX emit e.g. 'React.Fragment' or 'Fragment'. */
    // "jsxImportSource": "",                            /* Specify module specifier used to import the JSX factory functions when using 'jsx: react-jsx*'. */
    // "reactNamespace": "",                             /* Specify the object invoked for 'createElement'. This only applies when targeting 'react' JSX emit. */
    // "noLib": true,                                    /* Disable including any library files, including the default lib.d.ts. */
    // "useDefineForClassFields": true,                  /* Emit ECMAScript-standard-compliant class fields. */
    // "moduleDetection": "auto",                        /* Control what method is used to detect module-format JS files. */

    /* Modules */
    "module": "commonjs" /* Specify what module code is generated. */,
    // "rootDir": "./",                                  /* Specify the root folder within your source files. */
    // "moduleResolution": "node10",                     /* Specify how TypeScript looks up a file from a given module specifier. */
    // "baseUrl": "./",                                  /* Specify the base directory to resolve non-relative module names. */
    // "paths": {},                                      /* Specify a set of entries that re-map imports to additional lookup locations. */
    // "rootDirs": [],                                   /* Allow multiple folders to be treated as one when resolving modules. */
    // "typeRoots": [],                                  /* Specify multiple folders that act like './node_modules/@types'. */
    // "types": [],                                      /* Specify type package names to be included without being referenced in a source file. */
    // "allowUmdGlobalAccess": true,                     /* Allow accessing UMD globals from modules. */
    // "moduleSuffixes": [],                             /* List of file name suffixes to search when resolving a module. */
    // "allowImportingTsExtensions": true,               /* Allow imports to include TypeScript file extensions. Requires '--moduleResolution bundler' and either '--noEmit' or '--emitDeclarationOnly' ... (clipped)
    // "resolvePackageJsonExports": true,                /* Use the package.json 'exports' field when resolving package imports. */
    // "resolvePackageJsonImports": true,                /* Use the package.json 'imports' field when resolving imports. */
    // "customConditions": [],                           /* Conditions to set in addition to the resolver-specific defaults when resolving imports. */
    // "resolveJsonModule": true,                        /* Enable importing .json files. */
    // "allowArbitraryExtensions": true,                 /* Enable importing files with any extension, provided a declaration file is present. */
    // "noResolve": true,                                /* Disallow 'import's, 'require's or '<reference>'s from expanding the number of files TypeScript should add to a project. */

    /* JavaScript Support */
    // "allowJs": true,                                  /* Allow JavaScript files to be a part of your program. Use the 'checkJS' option to get errors from these files. */
    // "checkJs": true,                                  /* Enable error reporting in type-checked JavaScript files. */
    // "maxNodeModuleJsDepth": 1,                        /* Specify the maximum folder depth used for checking JavaScript files from 'node_modules'. Only applicable with 'allowJs'. */

    /* Emit */
    // "declaration": true,                              /* Generate .d.ts files from TypeScript and JavaScript files in your project. */
    // "declarationMap": true,                           /* Create sourcemaps for d.ts files. */
    // "emitDeclarationOnly": true,                      /* Only output d.ts files and not JavaScript files. */
    // "sourceMap": true,                                /* Create source map files for emitted JavaScript files. */
    // "inlineSourceMap": true,                          /* Include sourcemap files inside the emitted JavaScript. */
    // "outFile": "./",                                  /* Specify a file that bundles all outputs into one JavaScript file. If 'declaration' is true, also designates a file that bundles all .d.ts ou... (clipped)
    "outDir": "./dist" /* Specify an output folder for all emitted files. */,
    // "removeComments": true,                           /* Disable emitting comments. */
    // "noEmit": true,                                   /* Disable emitting files from a compilation. */
    // "importHelpers": true,                            /* Allow importing helper functions from tslib once per project, instead of including them per-file. */
    // "importsNotUsedAsValues": "remove",               /* Specify emit/checking behavior for imports that are only used for types. */
    // "downlevelIteration": true,                       /* Emit more compliant, but verbose and less performant JavaScript for iteration. */
    // "sourceRoot": "",                                 /* Specify the root path for debuggers to find the reference source code. */
    // "mapRoot": "",                                    /* Specify the location where debugger should locate map files instead of generated locations. */
    // "inlineSources": true,                            /* Include source code in the sourcemaps inside the emitted JavaScript. */
    // "emitBOM": true,                                  /* Emit a UTF-8 Byte Order Mark (BOM) in the beginning of output files. */
    // "newLine": "crlf",                                /* Set the newline character for emitting files. */
    // "stripInternal": true,                            /* Disable emitting declarations that have '@internal' in their JSDoc comments. */
    // "noEmitHelpers": true,                            /* Disable generating custom helper functions like '__extends' in compiled output. */
    // "noEmitOnError": true,                            /* Disable emitting files if any type checking errors are reported. */
    // "preserveConstEnums": true,                       /* Disable erasing 'const enum' declarations in generated code. */
    // "declarationDir": "./",                           /* Specify the output directory for generated declaration files. */
    // "preserveValueImports": true,                     /* Preserve unused imported values in the JavaScript output that would otherwise be removed. */

    /* Interop Constraints */
    // "isolatedModules": true,                          /* Ensure that each file can be safely transpiled without relying on other imports. */
    // "verbatimModuleSyntax": true,                     /* Do not transform or elide any imports or exports not marked as type-only, ensuring they are written in the output file's format based on the... (clipped)
    // "allowSyntheticDefaultImports": true,             /* Allow 'import x from y' when a module doesn't have a default export. */
    "esModuleInterop": true /* Emit additional JavaScript to ease support for importing CommonJS modules. This enables 'allowSyntheticDefaultImports' for type compatibility. */,
    // "preserveSymlinks": true,                         /* Disable resolving symlinks to their realpath. This correlates to the same flag in node. */
    "forceConsistentCasingInFileNames": true /* Ensure that casing is correct in imports. */,

    /* Type Checking */
    "strict": true /* Enable all strict type-checking options. */,
    // "noImplicitAny": true,                            /* Enable error reporting for expressions and declarations with an implied 'any' type. */
    // "strictNullChecks": true,                         /* When type checking, take into account 'null' and 'undefined'. */
    // "strictFunctionTypes": true,                      /* When assigning functions, check to ensure parameters and the return values are subtype-compatible. */
    // "strictBindCallApply": true,                      /* Check that the arguments for 'bind', 'call', and 'apply' methods match the original function. */
    // "strictPropertyInitialization": true,             /* Check for class properties that are declared but not set in the constructor. */
    // "noImplicitThis": true,                           /* Enable error reporting when 'this' is given the type 'any'. */
    // "useUnknownInCatchVariables": true,               /* Default catch clause variables as 'unknown' instead of 'any'. */
    // "alwaysStrict": true,                             /* Ensure 'use strict' is always emitted. */
    // "noUnusedLocals": true,                           /* Enable error reporting when local variables aren't read. */
    // "noUnusedParameters": true,                       /* Raise an error when a function parameter isn't read. */
    // "exactOptionalPropertyTypes": true,               /* Interpret optional property types as written, rather than adding 'undefined'. */
    // "noImplicitReturns": true,                        /* Enable error reporting for codepaths that do not explicitly return in a function. */
    // "noFallthroughCasesInSwitch": true,               /* Enable error reporting for fallthrough cases in switch statements. */
    // "noUncheckedIndexedAccess": true,                 /* Add 'undefined' to a type when accessed using an index. */
    // "noImplicitOverride": true,                       /* Ensure overriding members in derived classes are marked with an override modifier. */
    // "noPropertyAccessFromIndexSignature": true,       /* Enforces using indexed accessors for keys declared using an indexed type. */
    // "allowUnusedLabels": true,                        /* Disable error reporting for unused labels. */
    // "allowUnreachableCode": true,                     /* Disable error reporting for unreachable code. */

    /* Completeness */
    // "skipDefaultLibCheck": true,                      /* Skip type checking .d.ts files that are included with TypeScript. */
    "skipLibCheck": true /* Skip type checking all .d.ts files. */
  }
}
```

End of file contents
