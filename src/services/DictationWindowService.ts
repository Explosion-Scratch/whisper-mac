import { BrowserWindow, screen, app } from "electron";
import { join } from "path";
import { AppConfig } from "../config/AppConfig";
import { SelectedTextResult } from "./SelectedTextService";
import { TranscriptionSegment, TranscriptionUpdate } from "./WhisperLiveClient";

export interface WindowPosition {
  x: number;
  y: number;
}

export class DictationWindowService {
  private dictationWindow: BrowserWindow | null = null;
  private config: AppConfig;
  private currentSegments: TranscriptionSegment[] = [];
  private currentStatus: "listening" | "transforming" = "listening";

  constructor(config: AppConfig) {
    this.config = config;
  }

  async showDictationWindow(
    selectedTextResult: SelectedTextResult
  ): Promise<void> {
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.show();
      return;
    }

    const position = await this.calculateWindowPosition();

    this.dictationWindow = new BrowserWindow({
      width: this.config.dictationWindowWidth,
      height: this.config.dictationWindowHeight,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      opacity: this.config.dictationWindowOpacity,
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

    // Initialize the window with selected text data
    this.dictationWindow.webContents.send("initialize-dictation", {
      selectedText: selectedTextResult.text,
      hasSelection: selectedTextResult.hasSelection,
    });

    // Show the window with a fade-in effect
    this.dictationWindow.show();

    console.log("Dictation window shown at position:", position);
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
            this.closeDictationWindow();
            break;
          case "cancel-dictation":
            console.log("Handling cancel-dictation IPC");
            this.cancelDictation();
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

  updateTranscription(update: TranscriptionUpdate): void {
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

  clearTranscription(): void {
    this.currentSegments = [];
    this.currentStatus = "listening";
    if (this.dictationWindow && !this.dictationWindow.isDestroyed()) {
      this.dictationWindow.webContents.send("dictation-clear");
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
    this.closeDictationWindow();
    // Emit cancellation event if needed
    console.log("Dictation cancelled by user");
  }

  isWindowOpen(): boolean {
    return this.dictationWindow !== null && !this.dictationWindow.isDestroyed();
  }

  getCurrentTranscription(): string {
    // Return the full text from all segments
    return this.currentSegments.map((segment) => segment.text).join(" ");
  }

  getCurrentSegments(): TranscriptionSegment[] {
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
      this.dictationWindow.show();
      this.dictationWindow.focus();
    }
  }
}
