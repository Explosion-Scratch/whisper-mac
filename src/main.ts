// Electron modules
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
} from "electron";

// Node.js utilities
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// Core services
import { AudioCaptureService } from "./services/AudioCaptureService";
import { TranscriptionClient } from "./services/WhisperLiveClient";
import { TextInjectionService } from "./services/TextInjectionService";
import { TransformationService } from "./services/TransformationService";
import { ModelManager } from "./services/ModelManager";
import { AppConfig } from "./config/AppConfig";
import { SelectedTextService } from "./services/SelectedTextService";
import { DictationWindowService } from "./services/DictationWindowService";
import { SettingsService } from "./services/SettingsService";

// Segment management
import { SegmentManager } from "./services/SegmentManager";
import { SegmentUpdate } from "./types/SegmentTypes";

type SetupStatus =
  | "idle"
  | "downloading-models"
  | "setting-up-whisper"
  | "preparing-app"
  | "checking-permissions"
  | "starting-server"
  | "loading-windows";

class WhisperMacApp {
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private modelManagerWindow: BrowserWindow | null = null;
  private audioService: AudioCaptureService;
  private transcriptionClient: TranscriptionClient;
  private textInjector: TextInjectionService;
  private transformationService: TransformationService;
  private modelManager: ModelManager;
  private config: AppConfig;
  private selectedTextService: SelectedTextService;
  private dictationWindowService: DictationWindowService;
  private segmentManager: SegmentManager;
  private settingsService: SettingsService;

  // Status management
  private currentSetupStatus: SetupStatus = "idle";
  private setupStatusCallbacks: ((status: SetupStatus) => void)[] = [];

  // Dictation state
  private isRecording = false;
  private isFinishing = false; // New state to track when we're finishing current dictation
  private finishingTimeout: NodeJS.Timeout | null = null; // Timeout to prevent getting stuck

  constructor() {
    this.config = new AppConfig();

    // Initialize settings service first so it can load and apply settings to config
    this.settingsService = new SettingsService(this.config);

    // Initialize other services with potentially updated config
    this.audioService = new AudioCaptureService(this.config);
    this.modelManager = new ModelManager(this.config);
    this.transcriptionClient = new TranscriptionClient(
      this.config,
      this.modelManager
    );
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

  private setSetupStatus(status: SetupStatus) {
    this.currentSetupStatus = status;
    this.setupStatusCallbacks.forEach((callback) => callback(status));
    this.updateTrayMenu();
  }

  private onSetupStatusChange(callback: (status: SetupStatus) => void) {
    this.setupStatusCallbacks.push(callback);
  }

  private getStatusMessage(status: SetupStatus): string {
    switch (status) {
      case "downloading-models":
        return "Downloading models...";
      case "setting-up-whisper":
        return "Setting up Whisper...";
      case "preparing-app":
        return "Preparing app...";
      case "checking-permissions":
        return "Checking permissions...";
      case "starting-server":
        return "Starting server...";
      case "loading-windows":
        return "Loading windows...";
      case "idle":
      default:
        return "WhisperMac - AI Dictation";
    }
  }

  private updateTrayMenu() {
    if (!this.tray) return;

    const isSetupInProgress = this.currentSetupStatus !== "idle";

    if (isSetupInProgress) {
      // Show status menu during setup
      const statusMenu = Menu.buildFromTemplate([
        {
          label: this.getStatusMessage(this.currentSetupStatus),
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => app.quit(),
        },
      ]);
      this.tray.setContextMenu(statusMenu);
      this.tray.setToolTip(this.getStatusMessage(this.currentSetupStatus));
    } else {
      // Show normal menu when ready
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
  }

  async initialize() {
    await app.whenReady();

    // Create tray immediately to show status during initialization
    this.createTray();
    this.setSetupStatus("preparing-app");

    // Initialize data directories
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!existsSync(this.config.getCacheDir())) {
      mkdirSync(this.config.getCacheDir(), { recursive: true });
    }

    // Run these operations in parallel to speed up initialization
    console.log("Starting parallel initialization tasks...");
    const initTasks = [
      // Check accessibility permissions early
      this.textInjector
        .ensureAccessibilityPermissions()
        .then(() => {
          console.log("Accessibility permissions checked");
        })
        .catch((error) => {
          console.error("Failed to check accessibility permissions:", error);
        }),

      // Check and download Whisper model on first launch
      this.modelManager
        .ensureModelExists(this.config.defaultModel, (progress) => {
          if (progress.status === "starting" || progress.status === "cloning") {
            this.setSetupStatus("downloading-models");
          } else if (
            progress.status === "complete" ||
            progress.status === "error"
          ) {
            // Don't set to idle here as we still have other tasks running
          }
        })
        .then(() => {
          console.log("Model check completed");
        })
        .catch((error) => {
          console.error("Failed to check model:", error);
        }),

      // Pre-load windows for faster startup
      this.preloadWindows()
        .then(() => {
          console.log("Window preloading completed");
        })
        .catch((error) => {
          console.error("Failed to preload windows:", error);
        }),
    ];

    // Start WhisperLive server (this needs to be done before we can transcribe)
    this.setSetupStatus("starting-server");
    await this.transcriptionClient.startServer(
      this.config.defaultModel,
      (progress) => {
        // Update tray status based on Whisper setup progress
        if (progress.status === "cloning") {
          this.setSetupStatus("setting-up-whisper");
        } else if (progress.status === "installing") {
          this.setSetupStatus("setting-up-whisper");
        } else if (progress.status === "launching") {
          this.setSetupStatus("starting-server");
        } else if (progress.status === "complete") {
          // Don't set to idle here as we still have other tasks running
        } else if (progress.status === "error") {
          // Don't set to idle here as we still have other tasks running
        }
      }
    );

    // Wait for other initialization tasks to complete
    await Promise.allSettled(initTasks);

    this.registerGlobalShortcuts();
    this.setupIpcHandlers();

    // Hide dock icon for menu bar only app
    app.dock?.hide();

    // Set status to idle when everything is ready
    this.setSetupStatus("idle");

    console.log("Initialization completed");
  }

  private async preloadWindows(): Promise<void> {
    try {
      // Pre-load windows in parallel for faster startup
      console.log("Pre-loading windows for faster startup...");
      this.setSetupStatus("loading-windows");
      await Promise.allSettled([
        this.dictationWindowService.preloadWindow(),
        this.audioService.preloadWindow(),
      ]);

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
          this.setSetupStatus("downloading-models");
          event.reply("download-model-progress", {
            status: "starting",
            modelRepoId,
          });

          const success = await this.modelManager.downloadModel(
            modelRepoId,
            (progress) => {
              // Update tray status based on progress
              if (progress.status === "starting") {
                this.setSetupStatus("downloading-models");
              } else if (progress.status === "cloning") {
                this.setSetupStatus("downloading-models");
              } else if (progress.status === "complete") {
                this.setSetupStatus("idle");
              } else if (progress.status === "error") {
                this.setSetupStatus("idle");
              }

              // Send progress update to renderer
              event.reply("download-model-progress", {
                status: progress.status,
                modelRepoId: progress.modelRepoId,
                message: progress.message,
              });
            }
          );

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
        } finally {
          // Reset status to idle when download completes (success or failure)
          this.setSetupStatus("idle");
        }
      }
    );

    // Extend with more handlers as needed
    console.log("IPC Handlers set up");
  }

  private showSettings() {
    this.settingsService.openSettingsWindow();
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
    this.updateTrayMenu(); // Initial call to set the correct menu
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

      // 2. Enable accumulating mode - segments will be displayed but not auto-transformed/injected
      this.segmentManager.setAccumulatingMode(true);

      // 3. Show dictation window (pre-loaded for instant display)
      const windowStartTime = Date.now();
      await this.dictationWindowService.showDictationWindow();
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);

      // 4. Start recording visuals and audio capture in parallel
      this.isRecording = true;
      this.updateTrayIcon("recording");
      this.dictationWindowService.startRecording();

      // Start audio capture and transcription in parallel
      const audioStartTime = Date.now();
      const [audioResult] = await Promise.allSettled([
        this.audioService.startCapture(),
        this.transcriptionClient.startTranscription(
          async (update: SegmentUpdate) => {
            // Update dictation window with real-time transcription
            this.dictationWindowService.updateTranscription(update);
            // Process segments and flush completed ones
            await this.processSegments(update);
          }
        ),
      ]);

      const audioEndTime = Date.now();
      console.log(`Audio setup: ${audioEndTime - audioStartTime}ms`);

      if (audioResult.status === "rejected") {
        throw new Error(`Failed to start audio capture: ${audioResult.reason}`);
      }

      // 5. Connect audio data from capture service to WhisperLive client
      this.audioService.setAudioDataCallback((audioData: Float32Array) => {
        this.transcriptionClient.sendAudioData(audioData);
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

    // In accumulating mode - segments are only displayed, never auto-flushed
    console.log("Segments displayed in accumulating mode - no auto-flush");
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

      // This should no longer be called with the new flow, but keep as fallback
      console.log(
        "=== stopDictation called - this should be rare with new flow ==="
      );

      // Clear all segments without flushing (segments should have been handled in finishCurrentDictation)
      this.segmentManager.clearAllSegments();

      await this.transcriptionClient.stopTranscription();

      // Close the dictation window
      setTimeout(() => {
        this.dictationWindowService.closeDictationWindow();
      }, 1000);

      console.log("=== Dictation stopped successfully ===");
    } catch (error) {
      console.error("Failed to stop dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async finishCurrentDictation() {
    if (!this.isRecording || this.isFinishing) return;

    try {
      console.log("=== Finishing current dictation with transform+inject ===");

      // Check if there are any segments to process
      const allSegments = this.segmentManager.getAllSegments();
      const selectedText = (this.segmentManager as any).initialSelectedText;

      if (!selectedText && allSegments.length === 0) {
        console.log("No segments found, stopping dictation immediately");
        await this.stopDictation();
        return;
      }

      console.log(
        `Found ${allSegments.length} segments to transform and inject`
      );

      // Set finishing state
      this.isFinishing = true;

      // 1. Stop audio capture immediately (no new audio will be processed)
      await this.audioService.stopCapture();

      // 2. Set transforming status in UI and keep window visible
      this.dictationWindowService.setTransformingStatus();

      // 3. Disable accumulating mode so we can transform+inject
      this.segmentManager.setAccumulatingMode(false);

      // 4. Transform and inject all accumulated segments (keep UI showing transforming status)
      console.log(
        "=== Transforming and injecting all accumulated segments ==="
      );
      const transformResult =
        await this.segmentManager.transformAndInjectAllSegments();

      // 5. Show completed status briefly before closing window
      this.dictationWindowService.completeDictation(
        this.dictationWindowService.getCurrentTranscription()
      );

      // Brief delay to show completed status
      await new Promise((r) => setTimeout(r, 500));

      // 6. Hide the dictation window after transform+inject is complete
      this.dictationWindowService.hideWindow();

      if (transformResult.success) {
        console.log(
          `Successfully transformed and injected ${transformResult.segmentsProcessed} segments`
        );
      } else {
        console.error("Transform and inject failed:", transformResult.error);
      }

      // 7. Complete the dictation flow
      await this.completeDictationAfterFinishing();
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

      // Reset states
      this.isRecording = false;
      this.isFinishing = false;

      // Update tray icon to idle
      this.updateTrayIcon("idle");

      // Stop transcription since we're done
      await this.transcriptionClient.stopTranscription();

      // Clear all segments since they've been processed
      this.segmentManager.clearAllSegments();

      // Clear the dictation window transcription to reset UI status
      this.dictationWindowService.clearTranscription();

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
      await this.transcriptionClient.stopTranscription();
    }

    this.dictationWindowService.closeDictationWindow();

    // Clear all segments (this will also reset accumulating mode)
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
    this.transcriptionClient.stopServer();
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
