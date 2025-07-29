import { EventEmitter } from "events";
import { BrowserWindow } from "electron";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";

export class AudioCaptureService extends EventEmitter {
  private audioWindow: BrowserWindow | null = null;
  private config: AppConfig;
  private isRecording = false;
  private onAudioDataCallback: ((audioData: Float32Array) => void) | null =
    null;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  /**
   * Set callback for audio data processing
   */
  setAudioDataCallback(callback: (audioData: Float32Array) => void): void {
    this.onAudioDataCallback = callback;
  }

  async startCapture(): Promise<void> {
    try {
      if (this.audioWindow && !this.audioWindow.isDestroyed()) {
        // Window already exists, just start capture
        console.log("Using pre-loaded audio capture window...");
        this.audioWindow.webContents.send("start-audio-capture");
        return;
      }

      // Create new window if pre-loaded one doesn't exist
      await this.createAudioWindow();

      console.log("Sending start capture command...");
      this.audioWindow!.webContents.send("start-audio-capture");

      console.log("Audio capture setup complete");
    } catch (error) {
      let errMsg = "Unknown error";
      if (error instanceof Error) {
        errMsg = error.message;
      }
      console.error("Failed to start audio capture:", errMsg);
      throw new Error(`Failed to start audio capture: ${errMsg}`);
    }
  }

  async preloadWindow(): Promise<void> {
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      // Window already exists
      return;
    }

    console.log("Pre-loading audio capture window...");
    await this.createAudioWindow();
    console.log("Audio capture window pre-loaded successfully");
  }

  private async createAudioWindow(): Promise<void> {
    console.log("Creating audio capture window...");

    // Create a hidden window for audio capture
    this.audioWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: join(__dirname, "../preload/audioPreload.js"),
      },
    });

    console.log("Loading audio capture HTML...");

    // Load a simple HTML file for audio capture
    await this.audioWindow.loadFile(
      join(__dirname, "../renderer/audioCapture.html")
    );

    // Listen for audio data from renderer
    this.audioWindow.webContents.on(
      "ipc-message",
      (event, channel, ...args) => {
        if (channel === "audio-data") {
          const audioData = args[0] as Float32Array;
          this.emit("audioData", audioData);

          // Forward to callback if set
          if (this.onAudioDataCallback) {
            this.onAudioDataCallback(audioData);
          }
        } else if (channel === "audio-error") {
          console.error("Audio capture error:", args[0]);
          this.emit("error", new Error(args[0]));
        } else if (channel === "audio-capture-started") {
          console.log("Audio capture started successfully");
          this.isRecording = true;
          this.emit("captureStarted");
        } else if (channel === "audio-capture-stopped") {
          console.log("Audio capture stopped successfully");
          this.isRecording = false;
          this.emit("captureStopped");
        }
      }
    );
  }

  async stopCapture(): Promise<void> {
    console.log("Stopping audio capture...");

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
    this.onAudioDataCallback = null;
    console.log("Audio capture stopped");
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }
}
