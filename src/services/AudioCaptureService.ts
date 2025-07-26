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
