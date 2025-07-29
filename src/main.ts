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
  private isFinishing = false; // New state to track when we're finishing current dictation
  private finishingTimeout: NodeJS.Timeout | null = null; // Timeout to prevent getting stuck

  constructor() {
    this.config = new AppConfig();
    this.audioService = new AudioCaptureService(this.config);
    this.modelManager = new ModelManager(this.config);
    this.whisperClient = new WhisperLiveClient(this.config, this.modelManager);
    this.textInjector = new TextInjectionService();
    this.transformationService = new TransformationService(this.config);
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);
    this.segmentManager = new SegmentManager(
      this.transformationService,
      this.textInjector,
      this.selectedTextService
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

    // Pre-load windows for faster startup
    console.log("Pre-loading windows for faster startup...");
    await this.preloadWindows();

    // Hide dock icon for menu bar only app
    app.dock?.hide();
  }

  private async preloadWindows(): Promise<void> {
    try {
      // Pre-load dictation window
      await this.dictationWindowService.preloadWindow();

      // Pre-load audio capture window
      await this.audioService.preloadWindow();

      console.log("Windows pre-loaded successfully");
    } catch (error) {
      console.error("Failed to pre-load windows:", error);
      // Don't fail the entire initialization if pre-loading fails
    }
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
        accelerator: "Ctrl+D",
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
    const success1 = globalShortcut.register("Control+D", () => {
      console.log("Control+D is pressed");
      this.toggleRecording();
    });

    // Alternative shortcut (keeping one backup)
    const success2 = globalShortcut.register(
      "CommandOrControl+Option+Space",
      () => {
        console.log("CommandOrControl+Option+Space is pressed");
        this.toggleRecording();
      }
    );

    // Log if registration failed
    if (!success1) {
      console.error("Failed to register Control+D shortcut");
    }

    if (!success2) {
      console.error(
        "Failed to register CommandOrControl+Option+Space shortcut"
      );
    }

    // Log all registered shortcuts
    console.log(
      "Registered shortcuts:",
      globalShortcut.isRegistered("Control+D")
    );
  }

  private async toggleRecording() {
    console.log("=== Toggle dictation called ===");
    console.log("Current recording state:", this.isRecording);
    console.log("Current finishing state:", this.isFinishing);

    if (this.isRecording) {
      if (this.isFinishing) {
        console.log("Already finishing dictation, ignoring toggle...");
        return;
      }
      console.log("Finishing current dictation (waiting for completion)...");
      await this.finishCurrentDictation();
    } else {
      console.log("Starting dictation...");
      await this.startDictation();
    }
  }

  private async startDictation() {
    if (this.isRecording) return;
    const startTime = Date.now();
    try {
      console.log("=== Starting dictation process ===");

      // 1. Clear any existing segments and stored selected text
      this.segmentManager.clearAllSegments();

      // // 1b. Get selected text ONCE at the start of dictation
      // if (!this.config.skipSelectedTextRetrieval) {
      //   console.log("Retrieving selected text...");
      //   const selection = await this.selectedTextService.getSelectedText();
      //   if (selection.hasSelection) {
      //     // Store it in the manager instead of adding a segment
      //     this.segmentManager.setInitialSelectedText(selection.text);
      //   }
      //   if (selection.originalClipboard) {
      //     this.segmentManager.setOriginalClipboard(selection.originalClipboard);
      //   }
      // }

      const setupTime = Date.now();
      console.log(`Clear segments & get selection: ${setupTime - startTime}ms`);

      // 2. Show dictation window (pre-loaded for instant display)
      const windowStartTime = Date.now();
      await this.dictationWindowService.showDictationWindow();
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);

      // 3. Start recording visuals and audio capture
      this.isRecording = true;
      this.updateTrayIcon("recording");
      this.dictationWindowService.startRecording();
      await this.audioService.startCapture();

      // 4. Start WhisperLive transcription with real-time updates
      await this.whisperClient.startTranscription(async (update) => {
        // Update dictation window with real-time transcription
        this.dictationWindowService.updateTranscription(update);
        // Process segments and flush completed ones
        await this.processSegments(update);
      });

      // 5. Connect audio data from capture service to WhisperLive client
      this.audioService.setAudioDataCallback((audioData: Float32Array) => {
        this.whisperClient.sendAudioData(audioData);
      });

      const totalTime = Date.now() - startTime;
      console.log(`=== Dictation started successfully in ${totalTime}ms ===`);
    } catch (error) {
      console.error("Failed to start dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async processSegments(update: SegmentUpdate): Promise<void> {
    // Process both transcribed and in-progress segments
    const transcribedSegments = update.segments.filter(
      (s) => s.type === "transcribed"
    );
    const inProgressSegments = update.segments.filter(
      (s) => s.type === "inprogress"
    );

    // Add transcribed segments to segment manager
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

    // Add in-progress segments to segment manager (they will be marked as not completed)
    for (const segment of inProgressSegments) {
      if (segment.type === "inprogress") {
        this.segmentManager.addTranscribedSegment(
          segment.text,
          false, // in-progress segments are not completed
          segment.start,
          segment.end,
          segment.confidence
        );
      }
    }

    // Get all segments for display (including in-progress from update)
    const allSegments = this.segmentManager.getAllSegments();

    // Add in-progress segments from the update to the display
    const displayInProgressSegments = update.segments.filter(
      (s) => s.type === "inprogress"
    );

    const displaySegments = [...allSegments, ...displayInProgressSegments];

    // Update dictation window with all segments
    this.dictationWindowService.updateTranscription({
      segments: displaySegments,
      status: update.status,
    });

    // Flush completed segments if any exist
    const completedSegments =
      this.segmentManager.getCompletedTranscribedSegments();
    if (completedSegments.length > 0) {
      // If we are in finishing mode, the arrival of a completed segment
      // triggers the final flush and completion.
      if (this.isFinishing) {
        console.log(
          "=== Finishing mode: final segment received, completing dictation ==="
        );
        await this.completeDictationAfterFinishing();
        return; // Exit early, the final flush is handled in completeDictationAfterFinishing
      }

      // If not finishing, perform a partial flush for continuous dictation.
      console.log(`Flushing ${completedSegments.length} completed segments`);
      const flushResult = await this.segmentManager.flushSegments(false);

      if (flushResult.success) {
        console.log(
          `Successfully flushed ${flushResult.segmentsProcessed} segments`
        );
        // After successful flush, reset status to "listening" to indicate ready for more transcription
        const remainingSegments = this.segmentManager.getAllSegments();
        this.dictationWindowService.updateTranscription({
          segments: remainingSegments,
          status: "listening",
        });
      } else {
        console.error("Flush failed:", flushResult.error);
      }
    }
  }

  private async stopDictation() {
    if (!this.isRecording) return;
    try {
      console.log("=== Stopping dictation process ===");

      // Clear the finishing timeout if it exists
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }

      this.isRecording = false;
      this.isFinishing = false; // Reset finishing state
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
        // Reset status to listening if no final text
        this.dictationWindowService.updateTranscription({
          segments: [],
          status: "listening",
        });
        setTimeout(() => {
          this.dictationWindowService.closeDictationWindow();
        }, 1000);
      }

      // Clear all segments
      this.segmentManager.clearAllSegments();

      console.log("=== Dictation stopped successfully ===");
    } catch (error) {
      console.error("Failed to stop dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async finishCurrentDictation() {
    if (!this.isRecording || this.isFinishing) return;

    try {
      console.log("=== Checking if we should finish current dictation ===");

      // Check if there are any in-progress segments (meaning audio was recorded)
      const inProgressSegments =
        this.segmentManager.getInProgressTranscribedSegments();
      const completedSegments =
        this.segmentManager.getCompletedTranscribedSegments();

      // We check for initialSelectedText in the manager now
      const selectedText = (this.segmentManager as any).initialSelectedText;

      if (
        !selectedText &&
        inProgressSegments.length === 0 &&
        completedSegments.length === 0
      ) {
        console.log("No segments found, stopping dictation immediately");
        await this.stopDictation();
        return;
      }

      console.log(
        `Found ${inProgressSegments.length} in-progress and ${completedSegments.length} completed segments`
      );
      console.log(
        "=== Finishing current dictation (waiting for completion) ==="
      );

      // Set finishing state
      this.isFinishing = true;

      // 1. Stop audio capture immediately (no new audio will be processed)
      await this.audioService.stopCapture();

      // 2. Hide dictation window
      this.dictationWindowService.closeDictationWindow();

      // 3. Update tray icon to show we're no longer actively recording
      this.updateTrayIcon("idle");

      // 4. Set a 10-second timeout to prevent getting stuck
      this.finishingTimeout = setTimeout(async () => {
        console.log("=== Finishing timeout reached, forcing completion ===");
        await this.completeDictationAfterFinishing();
      }, 10000);

      // Note: We keep transcription running and isRecording=true
      // The processSegments method will handle completion and injection
      // when new completed segments arrive

      console.log(
        "=== Audio stopped, window hidden, waiting for transcription completion ==="
      );
    } catch (error) {
      console.error("Failed to finish current dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async completeDictationAfterFinishing() {
    try {
      console.log("=== Completing dictation after finishing ===");

      // Clear the finishing timeout if it exists
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }

      if (this.isFinishing) {
        // If we are still in finishing mode, it means processSegments didn't trigger a final flush.
        // This can happen if the last utterance doesn't end with a completed segment.
        // We need to trigger a final flush manually.
        console.log(
          "No final completed segment received, performing final flush manually..."
        );
        await this.segmentManager.flushAllSegments();
      }

      // Reset states
      this.isRecording = false;
      this.isFinishing = false;

      // Stop transcription since we're done
      await this.whisperClient.stopTranscription();

      // Clear all segments since they've been processed
      this.segmentManager.clearAllSegments();

      console.log("=== Dictation completed successfully after finishing ===");
    } catch (error) {
      console.error("Failed to complete dictation after finishing:", error);
      await this.cancelDictationFlow();
    }
  }

  private async cancelDictationFlow() {
    console.log("=== Cancelling dictation flow ===");

    // Clear the finishing timeout if it exists
    if (this.finishingTimeout) {
      clearTimeout(this.finishingTimeout);
      this.finishingTimeout = null;
    }

    const wasRecording = this.isRecording;
    this.isRecording = false;
    this.isFinishing = false; // Reset finishing state
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
