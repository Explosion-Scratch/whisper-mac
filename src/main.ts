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
  private isRecording = false;
  private currentSelectedText = "";
  private hasSelection = false;
  private completedSegments: string[] = [];

  constructor() {
    this.config = new AppConfig();
    this.audioService = new AudioCaptureService(this.config);
    this.modelManager = new ModelManager(this.config);
    this.whisperClient = new WhisperLiveClient(this.config, this.modelManager);
    this.textInjector = new TextInjectionService();
    this.transformationService = new TransformationService();
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);
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
    ipcMain.on("cancel-dictation", async (event: Electron.IpcMainEvent) => {
      console.log("Cancelling dictation...");
      await this.stopDictation();
      this.dictationWindowService.closeDictationWindow();
    });

    ipcMain.on("close-dictation-window", (event: Electron.IpcMainEvent) => {
      console.log("Closing dictation window...");
      this.dictationWindowService.closeDictationWindow();
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
    try {
      console.log("=== Starting dictation process ===");

      // 1. Get selected text
      console.log("1. Getting selected text...");
      const selectedTextResult =
        await this.selectedTextService.getSelectedText();
      this.currentSelectedText = selectedTextResult.text;
      this.hasSelection = selectedTextResult.hasSelection;

      console.log("Selected text result:", selectedTextResult);

      // 2. Show dictation window
      console.log("2. Showing dictation window...");
      await this.dictationWindowService.showDictationWindow(selectedTextResult);

      // 3. Start recording
      console.log("3. Starting recording...");
      this.isRecording = true;
      this.updateTrayIcon("recording");
      this.dictationWindowService.startRecording();

      // 4. Start audio capture
      console.log("4. Starting audio capture...");
      await this.audioService.startCapture();

      // 5. Start WhisperLive transcription with real-time updates
      console.log("5. Starting WhisperLive transcription...");
      await this.whisperClient.startTranscription((update) => {
        console.log("Received transcription update:", update);

        // Track completed segments for final transformation
        this.updateCompletedSegments(update.segments);

        // Update dictation window with real-time transcription
        this.dictationWindowService.updateTranscription(update);
      });

      // 6. Connect audio data from capture service to WhisperLive client
      console.log("6. Setting up audio data callback...");
      this.audioService.setAudioDataCallback((audioData: Float32Array) => {
        console.log(
          "Sending audio data to WhisperLive:",
          audioData.length,
          "samples"
        );
        this.whisperClient.sendAudioData(audioData);
      });

      console.log("=== Dictation started successfully ===");
    } catch (error) {
      console.error("Failed to start dictation:", error);
      this.isRecording = false;
      this.updateTrayIcon("idle");
      this.dictationWindowService.closeDictationWindow();
    }
  }

  private updateCompletedSegments(segments: any[]): void {
    console.log("=== updateCompletedSegments ===");
    console.log("Current completed segments:", this.completedSegments);
    console.log("New segments from server:", segments);

    // Track completed segments for final transformation
    const newCompletedSegments = segments
      .filter((segment: any) => segment.completed && segment.text)
      .map((segment: any) => segment.text);

    console.log("Filtered completed segments:", newCompletedSegments);

    // Check if we have new completed segments to transform
    if (newCompletedSegments.length > this.completedSegments.length) {
      // Transform the newly completed segments
      const newSegments = newCompletedSegments.slice(
        this.completedSegments.length
      );
      console.log("New segments to transform:", newSegments);

      const transformedNewSegments = newSegments.map((segment) => {
        console.log("Transforming segment:", segment);
        const transformed = this.transformationService.toUppercase(segment);
        console.log("Transformed segment:", transformed);
        return transformed;
      });

      // Update the completed segments with transformed versions
      this.completedSegments = [
        ...this.completedSegments,
        ...transformedNewSegments,
      ];

      console.log("Updated completed segments:", this.completedSegments);
      console.log("Transformed new segments:", transformedNewSegments);
    } else {
      // Just update the completed segments list
      this.completedSegments = newCompletedSegments;
      console.log(
        "Updated completed segments (no new transformations):",
        this.completedSegments
      );
    }
  }

  private async stopDictation() {
    try {
      console.log("=== Stopping dictation process ===");

      this.isRecording = false;
      this.updateTrayIcon("idle");
      this.dictationWindowService.stopRecording();

      // Stop audio capture and transcription
      await this.audioService.stopCapture();
      await this.whisperClient.stopTranscription();

      // Get final transcription from completed segments (already transformed)
      const finalTranscription = this.completedSegments.join(" ");
      console.log(
        "Final transcription from completed segments:",
        finalTranscription
      );
      console.log("Completed segments array:", this.completedSegments);

      if (finalTranscription && finalTranscription.trim()) {
        console.log(
          "Final transcription (already transformed):",
          finalTranscription
        );

        // Complete dictation in window with transformed text
        this.dictationWindowService.completeDictation(finalTranscription);

        // Insert/replace text using paste
        console.log("About to insert text:", finalTranscription);
        await this.textInjector.insertText(finalTranscription);

        console.log("Text pasted successfully");

        // Clear the transcription and reset window for next dictation
        setTimeout(() => {
          this.dictationWindowService.clearTranscription();
        }, 1000);
      } else {
        console.log("No transcription to insert");
        console.log("Final transcription was empty or whitespace only");
        // Clear the transcription even if empty
        this.dictationWindowService.clearTranscription();
      }

      // Reset state
      this.currentSelectedText = "";
      this.hasSelection = false;
      this.completedSegments = [];

      console.log("=== Dictation stopped successfully ===");
    } catch (error) {
      console.error("Failed to stop dictation:", error);
      this.dictationWindowService.closeDictationWindow();
    }
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
