import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
} from "electron";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { AudioCaptureService } from "./services/AudioCaptureService";
import { WhisperLiveClient } from "./services/WhisperLiveClient";
import { TextInjectionService } from "./services/TextInjectionService";
import { TransformationService } from "./services/TransformationService";
import { ModelManager } from "./services/ModelManager";
import { AppConfig } from "./config/AppConfig";
import { SelectedTextService } from "./services/SelectedTextService";
import { DictationWindowService } from "./services/DictationWindowService";
import { SegmentManager } from "./services/SegmentManager";
import { Segment, SegmentUpdate } from "./types/SegmentTypes";

class WhisperMacApp {
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private modelManagerWindow: BrowserWindow | null = null;
  private audioService: AudioCaptureService;
  private whisperClient: WhisperLiveClient;
  private textInjector: TextInjectionService;
  private transformationService: TransformationService;
  private modelManager: ModelManager;
  private config: AppConfig;
  private selectedTextService: SelectedTextService;
  private dictationWindowService: DictationWindowService;
  private segmentManager: SegmentManager;

  // Dictation state
  private isRecording = false;

  constructor() {
    this.config = new AppConfig();
    this.audioService = new AudioCaptureService(this.config);
    this.modelManager = new ModelManager(this.config);
    this.whisperClient = new WhisperLiveClient(this.config, this.modelManager);
    this.textInjector = new TextInjectionService();
    this.transformationService = new TransformationService();
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);
    this.segmentManager = new SegmentManager(
      this.transformationService,
      this.textInjector
    );
  }

  async initialize() {
    await app.whenReady();

    // Initialize data directories
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!existsSync(this.config.getCacheDir())) {
      mkdirSync(this.config.getCacheDir(), { recursive: true });
    }

    // Check accessibility permissions early
    console.log("Checking accessibility permissions...");
    await this.textInjector.ensureAccessibilityPermissions();

    // Check and download Whisper model on first launch
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
      await this.startDictation();
      event.reply("dictation-started");
    });
    ipcMain.on("stop-dictation", async (event: Electron.IpcMainEvent) => {
      await this.stopDictation();
      event.reply("dictation-stopped");
    });

    // Dictation window control handlers
    ipcMain.on("cancel-dictation", async () => {
      console.log("Cancelling dictation via IPC...");
      await this.cancelDictationFlow();
    });

    ipcMain.on("close-dictation-window", () => {
      console.log("Closing dictation window via IPC, cancelling flow...");
      this.cancelDictationFlow();
    });

    // Model download handlers
    ipcMain.on(
      "download-model",
      async (event: Electron.IpcMainEvent, modelRepoId: string) => {
        try {
          console.log(`Starting download of model: ${modelRepoId}`);
          event.reply("download-model-progress", {
            status: "starting",
            modelRepoId,
          });

          const success = await this.modelManager.downloadModel(modelRepoId);
          if (success) {
            event.reply("download-model-complete", {
              status: "success",
              modelRepoId,
            });
          } else {
            event.reply("download-model-complete", {
              status: "error",
              modelRepoId,
              error: "Download failed",
            });
          }
        } catch (error) {
          console.error("Model download error:", error);
          event.reply("download-model-complete", {
            status: "error",
            modelRepoId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

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
      }
    );

    // Log if registration failed
    if (!success1) {
      console.error("Failed to register CommandOrControl+Shift+D shortcut");
    }

    if (!success2) {
      console.error(
        "Failed to register CommandOrControl+Option+Space shortcut"
      );
    }

    // Log all registered shortcuts
    console.log(
      "Registered shortcuts:",
      globalShortcut.isRegistered("CommandOrControl+Shift+D")
    );
  }

  private async toggleRecording() {
    console.log("=== Toggle dictation called ===");
    console.log("Current recording state:", this.isRecording);

    if (this.isRecording) {
      console.log("Stopping dictation...");
      await this.stopDictation();
    } else {
      console.log("Starting dictation...");
      await this.startDictation();
    }
  }

  private async startDictation() {
    if (this.isRecording) return;
    try {
      console.log("=== Starting dictation process ===");

      // 1. Clear any existing segments
      this.segmentManager.clearAllSegments();

      // 2. Get selected text and add as selected segment
      const selectedTextResult =
        await this.selectedTextService.getSelectedText();
      console.log("Selected text result:", selectedTextResult);

      // Add selected text as a segment
      this.segmentManager.addSelectedSegment(
        selectedTextResult.text,
        selectedTextResult.hasSelection
      );

      // 3. Show dictation window
      await this.dictationWindowService.showDictationWindow(selectedTextResult);

      // 4. Start recording visuals and audio capture
      this.isRecording = true;
      this.updateTrayIcon("recording");
      this.dictationWindowService.startRecording();
      await this.audioService.startCapture();

      // 5. Start WhisperLive transcription with real-time updates
      await this.whisperClient.startTranscription(async (update) => {
        // Update dictation window with real-time transcription
        this.dictationWindowService.updateTranscription(update);
        // Process segments and flush completed ones
        await this.processSegments(update);
      });

      // 6. Connect audio data from capture service to WhisperLive client
      this.audioService.setAudioDataCallback((audioData: Float32Array) => {
        this.whisperClient.sendAudioData(audioData);
      });

      console.log("=== Dictation started successfully ===");
    } catch (error) {
      console.error("Failed to start dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async processSegments(update: SegmentUpdate): Promise<void> {
    // Add new transcribed segments to the segment manager
    const transcribedSegments = update.segments.filter(
      (s) => s.type === "transcribed"
    );

    for (const segment of transcribedSegments) {
      if (segment.type === "transcribed") {
        this.segmentManager.addTranscribedSegment(
          segment.text,
          segment.completed,
          segment.start,
          segment.end,
          segment.confidence
        );
      }
    }

    // Get all segments for display
    const allSegments = this.segmentManager.getAllSegments();

    // Update dictation window with all segments
    this.dictationWindowService.updateTranscription({
      segments: allSegments,
      status: update.status,
    });

    // Flush completed segments if any exist
    const completedSegments =
      this.segmentManager.getCompletedTranscribedSegments();
    if (completedSegments.length > 0) {
      console.log(`Flushing ${completedSegments.length} completed segments`);
      const flushResult = await this.segmentManager.flushSegments();

      if (flushResult.success) {
        console.log(
          `Successfully flushed ${flushResult.segmentsProcessed} segments`
        );
      } else {
        console.error("Flush failed:", flushResult.error);
      }
    }
  }

  private async stopDictation() {
    if (!this.isRecording) return;
    try {
      console.log("=== Stopping dictation process ===");

      this.isRecording = false;
      this.updateTrayIcon("idle");
      this.dictationWindowService.stopRecording();

      await this.audioService.stopCapture();

      // Give a moment for final server updates
      await new Promise((r) => setTimeout(r, 250));

      // Flush all remaining segments (including in-progress ones)
      const flushResult = await this.segmentManager.flushAllSegments();

      if (flushResult.success) {
        console.log(
          `Successfully flushed ${flushResult.segmentsProcessed} segments on stop`
        );
      } else {
        console.error("Final flush failed:", flushResult.error);
      }

      await this.whisperClient.stopTranscription();

      const finalText = flushResult.transformedText;
      console.log("Final transcription:", finalText);

      if (finalText) {
        this.dictationWindowService.completeDictation(finalText);
        setTimeout(() => {
          this.dictationWindowService.clearTranscription();
        }, 1500);
      } else {
        this.dictationWindowService.closeDictationWindow();
      }

      // Clear all segments
      this.segmentManager.clearAllSegments();

      console.log("=== Dictation stopped successfully ===");
    } catch (error) {
      console.error("Failed to stop dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async cancelDictationFlow() {
    console.log("=== Cancelling dictation flow ===");

    const wasRecording = this.isRecording;
    this.isRecording = false;
    this.updateTrayIcon("idle");

    if (wasRecording) {
      await this.audioService.stopCapture();
      await this.whisperClient.stopTranscription();
    }

    this.dictationWindowService.closeDictationWindow();

    // Clear all segments
    this.segmentManager.clearAllSegments();

    console.log("=== Dictation flow cancelled and cleaned up ===");
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

// Prevent app from quitting when all windows are closed (menu bar app)
app.on("window-all-closed", (event: Electron.Event) => {
  event.preventDefault();
  console.log("All windows closed, but keeping app running (menu bar app)");
});

// Prevent accidental quitting - only allow through tray menu
app.on("before-quit", (event: Electron.Event) => {
  // Only allow quitting if explicitly requested through tray menu
  // For now, we'll allow it but log it
  console.log("App quit requested");
});

// Handle app activation (macOS)
app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // We don't need this for a menu bar app, but keeping it for completeness
});
