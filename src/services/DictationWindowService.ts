import { BrowserWindow, screen, app } from "electron";
import { join } from "path";
import { EventEmitter } from "events";
import { AppConfig } from "../config/AppConfig";
import { appEventBus } from "./AppEventBus";
import { Segment, SegmentUpdate } from "../types/SegmentTypes";
import { appStore } from "../core/AppStore";

export interface WindowPosition {
  x: number;
  y: number;
}

export type DictationStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "transforming"
  | "injecting"
  | "complete";

export class DictationWindowService extends EventEmitter {
  private dictationWindow: BrowserWindow | null = null;
  private config: AppConfig;
  private currentSegments: Segment[] = [];
  private currentStatus: DictationStatus = "idle";

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  async showDictationWindow(isRunOnAll: boolean = false): Promise<void> {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      // Window already exists, just show it
      this.dictationWindow.showInactive();

      // Trigger the animation in the renderer process
      this.dictationWindow.webContents.send("animate-in");
      appEventBus.emit("dictation-window-shown");

      // Wait a moment for the window to be ready, then initialize
      if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
        this.dictationWindow.webContents.send("initialize-dictation", {
          selectedText: "",
          hasSelection: false,
          isRunOnAll,
        });
      }

      return;

      return;
    }

    // Create new window if pre-loaded one doesn't exist
    await this.createDictationWindow();

    // Wait for the window to be ready before initializing
    this.dictationWindow!.webContents.once("did-finish-load", () => {
      this.dictationWindow!.webContents.send("initialize-dictation", {
        selectedText: "",
        hasSelection: false,
        isRunOnAll,
      });
    });

    this.dictationWindow!.showInactive();

    // Trigger the animation in the renderer process
    this.dictationWindow!.webContents.send("animate-in");
    appEventBus.emit("dictation-window-shown");

    console.log(
      "Dictation window shown at position:",
      this.calculateWindowPositionSync(),
    );
  }

  async preloadWindow(): Promise<void> {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      // Window already exists
      return;
    }

    console.log("Pre-loading dictation window...");
    await this.createDictationWindow();
    console.log("Dictation window pre-loaded successfully");
  }

  private async createDictationWindow(): Promise<void> {
    const DEBUG = true;
    const position = this.calculateWindowPositionSync();

    this.dictationWindow = new BrowserWindow({
      width: DEBUG ? 400 : this.config.dictationWindowWidth,
      height: DEBUG ? 800 : this.config.dictationWindowHeight,
      x: position.x,
      y: position.y,
      frame: DEBUG ? true : false,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "sidebar",
      visualEffectState: "active",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: DEBUG ? true : false,
      minimizable: false,
      maximizable: false,
      closable: true,
      movable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: DEBUG ? true : false,
        backgroundThrottling: false,
        preload: join(__dirname, "../preload/rendererAppPreload.js"),
      },
      show: false,
    });
    this.dictationWindow.setVisibleOnAllWorkspaces(true);

    await this.dictationWindow.loadFile(
      join(__dirname, "../renderer-app/index.html"),
      { hash: "/dictation" }
    );

    this.setupWindowEventHandlers();
  }

  private setupWindowEventHandlers(): void {
  if (!this.dictationWindow) return;

    this.dictationWindow.on("closed", () => {
      this.dictationWindow = null;
    });

    this.dictationWindow.on("close", (event) => {
      console.log("Close event details:", event);
    });

    this.dictationWindow.on("hide", () => {
      this.dictationWindow?.webContents.send("window-hidden");
    });

    this.dictationWindow.webContents.on(
      "ipc-message",
      (event, channel, ...args) => {
        if (channel === "__ELECTRON_LOG__") {
          return;
        }

        console.log("Channel:", channel);

        switch (channel) {
          case "close-dictation-window":
            // Don't hide window here - let DictationFlowManager.finishCurrentDictation()
            // handle the window lifecycle after transformation/injection completes.
            // The IpcHandlerManager will call finishCurrentDictation() which properly
            // shows status updates (transcribing, transforming, injecting, complete)
            // and hides the window at the end.
            this.emit("close-requested");
            break;
          case "cancel-dictation":
            this.hideAndReloadWindow();
            break;
          case "minimize-dictation-window":
            this.dictationWindow?.minimize();
            break;
          case "dictation-log":
            console.log("Dictation window log:", args[0]);
            break;
          case "vad-audio-segment":
            console.log(
              "Received VAD audio segment:",
              args[0]?.length || 0,
              "samples",
            );
            this.emit("vad-audio-segment", new Float32Array(args[0]));
            break;
          case "dictation-window-ready":
            console.log("Dictation window signaled ready");
            break;
          default:
            console.log("Unknown IPC channel:", channel);
        }
      },
    );
  }

  private async calculateWindowPosition(): Promise<WindowPosition> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } =
      primaryDisplay.workAreaSize;

    if (this.config.dictationWindowPosition === "screen-corner") {
      // Position in screen corner (bottom-right)
      return {
        x: screenWidth - this.config.dictationWindowWidth - 20,
        y: screenHeight - this.config.dictationWindowHeight - 20,
      };
    } else {
      // Position relative to active application window
      return await this.getActiveAppWindowPosition();
    }
  }

  private async getActiveAppWindowPosition(): Promise<WindowPosition> {
    try {
      // Try to get the active window bounds using AppleScript
      const bounds = await this.getActiveWindowBounds();

      if (bounds) {
        // Position in bottom-right corner of active window
        return {
          x: bounds.x + bounds.width - this.config.dictationWindowWidth - 20,
          y: bounds.y + bounds.height - this.config.dictationWindowHeight - 20,
        };
      }
    } catch (error) {
      console.error("Failed to get active window position:", error);
    }

    // Fallback to screen corner
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } =
      primaryDisplay.workAreaSize;

    return {
      x: screenWidth - this.config.dictationWindowWidth - 20,
      y: screenHeight - this.config.dictationWindowHeight - 20,
    };
  }

  private async getActiveWindowBounds(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> {
    return new Promise((resolve) => {
      const { execFile } = require("child_process");

      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set frontWindow to first window of frontApp
          set windowBounds to bounds of frontWindow
          return windowBounds
        end tell
      `;

      execFile("osascript", ["-e", script], (error: any, stdout: string) => {
        if (error) {
          console.error("AppleScript error:", error);
          resolve(null);
          return;
        }

        try {
          // Parse bounds: "x1, y1, x2, y2"
          const bounds = stdout.trim().split(", ").map(Number);
          if (bounds.length === 4) {
            resolve({
              x: bounds[0],
              y: bounds[1],
              width: bounds[2] - bounds[0],
              height: bounds[3] - bounds[1],
            });
          } else {
            resolve(null);
          }
        } catch (parseError) {
          console.error("Failed to parse window bounds:", parseError);
          resolve(null);
        }
      });
    });
  }

  startRecording(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.setStatus("recording");
      this.dictationWindow.webContents.send("dictation-start-recording");
    }
  }

  stopRecording(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-stop-recording");
    }
  }

  sendAudioLevel(level: number): void {
      if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
          this.dictationWindow.webContents.send("dictation-audio-level", level);
      }
  }

  sendSpeechStart(): void {
      if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
          this.dictationWindow.webContents.send("dictation-speech-start");
      }
  }

  sendSpeechEnd(): void {
      if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
          this.dictationWindow.webContents.send("dictation-speech-end");
      }
  }

  async flushPendingAudio(): Promise<void> {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("[DictationWindowService] Flushing pending audio...");
      this.dictationWindow.webContents.send("dictation-flush-pending-audio");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  updateTranscription(update: SegmentUpdate): void {
    this.currentSegments = update.segments;
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-transcription-update", {
        segments: this.currentSegments,
      });
    }
  }

  completeDictation(finalText: string): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.setStatus("complete");
      this.dictationWindow.webContents.send("dictation-complete", finalText);
    }
  }

  setStatus(status: DictationStatus): void {
    this.currentStatus = status;
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-set-status", status);
    }
  }

  clearTranscription(): void {
    this.currentSegments = [];
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-clear");
      this.setStatus("idle");
    }
  }

  clearTranscriptionDisplay(): void {
    this.currentSegments = [];
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-clear");
    }
  }

  closeDictationWindow(): void {
    console.log("=== DictationWindowService.closeDictationWindow ===");
    console.log("Window exists:", this.dictationWindow !== null);
    console.log("Window destroyed:", this.dictationWindow?.isDestroyed());

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("Hiding dictation window...");
      // Send message to play end sound before hiding
      this.dictationWindow.webContents.send("play-end-sound");
      this.dictationWindow.hide();
      console.log("Hide command sent to window");
    } else {
      console.log("Window is null or already destroyed");
    }

    // Don't clear the window reference - keep it for reuse
    this.currentSegments = [];
    this.setStatus("idle");
    console.log("Transcription reset, window kept for reuse");
  }

  cancelDictation(): void {
    this.hideWindow();
    // Emit cancellation event if needed
    console.log("Dictation cancelled by user");
  }

  hideAndReloadWindow(): void {
    console.log("=== DictationWindowService.hideAndReloadWindow ===");

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("Hiding dictation window...");
      // Send message to play end sound before hiding
      this.dictationWindow.webContents.send("play-end-sound");
      this.dictationWindow.hide();

      // Clear current state
      this.currentSegments = [];
      this.setStatus("idle");

      // Don't reload the window content - keep it ready for reuse
      console.log("Window hidden successfully");
    } else {
      console.log("Window is null or already destroyed");
    }
  }

  isWindowOpen(): boolean {
    return this.dictationWindow !== null && !this.dictationWindow.isDestroyed();
  }

  getCurrentTranscription(): string {
    // Return the full text from all segments
    return this.currentSegments.map((segment) => segment.text).join(" ");
  }

  getCurrentSegments(): Segment[] {
    return this.currentSegments;
  }

  getCurrentStatus(): DictationStatus {
    return this.currentStatus;
  }

  focusWindow(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.focus();
    }
  }

  hideWindow(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.hide();
      appStore.setUIState({ dictationWindowVisible: false });
      appEventBus.emit("dictation-window-hidden");
    }
  }

  showWindow(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.showInactive();
      appStore.setUIState({ dictationWindowVisible: true });
      appEventBus.emit("dictation-window-shown");
    }
  }

  isWindowVisible(): boolean {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      try {
        return this.dictationWindow.isVisible();
      } catch { }
    }
    return false;
  }

  cleanup(): void {
    console.log("=== Cleaning up DictationWindowService ===");

    // Remove all event listeners
    this.removeAllListeners();

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("Destroying dictation window...");
      // Send cleanup signal to renderer before destroying
      try {
        this.dictationWindow.webContents.send("cleanup-before-destroy");
      } catch (error) {
        // Ignore errors if webContents is not available
      }
      this.dictationWindow.destroy();
    }

    this.dictationWindow = null;
    this.currentSegments = [];
    this.currentStatus = "idle";

    console.log("=== DictationWindowService cleanup completed ===");
  }

  // New synchronous method for screen-corner positioning
  private calculateWindowPositionSync(): WindowPosition {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } =
      primaryDisplay.workAreaSize;

    if (this.config.dictationWindowPosition === "screen-corner") {
      // Position in screen corner (bottom-right) - synchronous
      return {
        x: screenWidth - this.config.dictationWindowWidth - 20,
        y: screenHeight - this.config.dictationWindowHeight - 20,
      };
    } else {
      // For active-app-corner, fall back to screen corner for now
      // This avoids the AppleScript bottleneck
      return {
        x: screenWidth - this.config.dictationWindowWidth - 20,
        y: screenHeight - this.config.dictationWindowHeight - 20,
      };
    }
  }
}
