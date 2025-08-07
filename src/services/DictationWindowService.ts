import { BrowserWindow, screen, app } from "electron";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";
import { Segment, SegmentUpdate } from "../types/SegmentTypes";

export interface WindowPosition {
  x: number;
  y: number;
}

export class DictationWindowService {
  private dictationWindow: BrowserWindow | null = null;
  private config: AppConfig;
  private currentSegments: Segment[] = [];
  private currentStatus: "listening" | "transforming" = "listening";

  constructor(config: AppConfig) {
    this.config = config;
  }

  async showDictationWindow(): Promise<void> {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      // Window already exists, just show it
      this.dictationWindow.showInactive();

      // Initialize the window with empty data (no selected text)
      this.dictationWindow.webContents.send("initialize-dictation", {
        selectedText: "",
        hasSelection: false,
      });

      return;
    }

    // Create new window if pre-loaded one doesn't exist
    await this.createDictationWindow();

    // Initialize the window with empty data (no selected text)
    this.dictationWindow!.webContents.send("initialize-dictation", {
      selectedText: "",
      hasSelection: false,
    });

    this.dictationWindow!.showInactive();

    console.log(
      "Dictation window shown at position:",
      this.calculateWindowPositionSync()
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
    // Optimize: Use synchronous position calculation for screen-corner
    const position = this.calculateWindowPositionSync();

    this.dictationWindow = new BrowserWindow({
      width: this.config.dictationWindowWidth,
      height: this.config.dictationWindowHeight,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true, // Set to true to make window floating across all desktops
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      opacity: this.config.dictationWindowOpacity,
      movable: true, // Ensure window is movable
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/dictationPreload.js"),
      },
      show: false, // Don't show immediately
    });

    // Load the dictation window HTML
    await this.dictationWindow.loadFile(
      join(__dirname, "../renderer/dictationWindow.html")
    );

    // Set up window event handlers
    this.setupWindowEventHandlers();
  }

  private setupWindowEventHandlers(): void {
    if (!this.dictationWindow) return;

    // Handle window close
    this.dictationWindow.on("closed", () => {
      console.log("=== DictationWindowService: Window closed event ===");
      this.dictationWindow = null;
      console.log("Dictation window closed and reference cleared");
    });

    // Handle window close request
    this.dictationWindow.on("close", (event) => {
      console.log("=== DictationWindowService: Window close request ===");
      console.log("Close event details:", event);
    });

    // Handle IPC messages from renderer
    this.dictationWindow.webContents.on(
      "ipc-message",
      (event, channel, ...args) => {
        console.log("=== DictationWindowService: IPC message received ===");
        console.log("Channel:", channel);
        console.log("Args:", args);

        switch (channel) {
          case "close-dictation-window":
            console.log("Handling close-dictation-window IPC");
            this.hideAndReloadWindow();
            break;
          case "cancel-dictation":
            console.log("Handling cancel-dictation IPC");
            this.hideAndReloadWindow();
            break;
          case "minimize-dictation-window":
            console.log("Handling minimize-dictation-window IPC");
            this.dictationWindow?.minimize();
            break;
          case "dictation-log":
            console.log("Dictation window log:", args[0]);
            break;
          default:
            console.log("Unknown IPC channel:", channel);
        }
      }
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
      this.dictationWindow.webContents.send("dictation-start-recording");
    }
  }

  stopRecording(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-stop-recording");
    }
  }

  updateTranscription(update: SegmentUpdate): void {
    this.currentSegments = update.segments;
    this.currentStatus = update.status;

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send(
        "dictation-transcription-update",
        update
      );
    }
  }

  completeDictation(finalText: string): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-complete", finalText);
    }
  }

  setTransformingStatus(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-transcription-update", {
        segments: this.currentSegments,
        status: "transforming",
      });
    }
  }

  clearTranscription(): void {
    this.currentSegments = [];
    this.currentStatus = "listening";
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-clear");
      // Also send an explicit status update to ensure UI reflects the change
      this.dictationWindow.webContents.send("dictation-transcription-update", {
        segments: [],
        status: "listening",
      });
    }
  }

  closeDictationWindow(): void {
    console.log("=== DictationWindowService.closeDictationWindow ===");
    console.log("Window exists:", this.dictationWindow !== null);
    console.log("Window destroyed:", this.dictationWindow?.isDestroyed());

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("Closing dictation window...");
      this.dictationWindow.close();
      console.log("Close command sent to window");
    } else {
      console.log("Window is null or already destroyed");
    }

    this.dictationWindow = null;
    this.currentSegments = [];
    this.currentStatus = "listening";
    console.log("Window reference cleared and transcription reset");
  }

  cancelDictation(): void {
    this.hideAndReloadWindow();
    // Emit cancellation event if needed
    console.log("Dictation cancelled by user");
  }

  hideAndReloadWindow(): void {
    console.log("=== DictationWindowService.hideAndReloadWindow ===");

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("Hiding dictation window...");
      this.dictationWindow.hide();

      // Clear current state
      this.currentSegments = [];
      this.currentStatus = "listening";

      // Reload the window content
      console.log("Reloading window content...");
      this.dictationWindow.webContents.reload();

      console.log("Window hidden and reloaded successfully");
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

  getCurrentStatus(): "listening" | "transforming" {
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
    }
  }

  showWindow(): void {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.showInactive();
    }
  }

  cleanup(): void {
    console.log("=== Cleaning up DictationWindowService ===");

    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      console.log("Destroying dictation window...");
      this.dictationWindow.destroy();
    }

    this.dictationWindow = null;
    this.currentSegments = [];
    this.currentStatus = "listening";

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
