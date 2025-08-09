// Electron modules
import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from "electron";

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
import {
  TrayService,
  SetupStatus as TraySetupStatus,
} from "./services/TrayService";
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
  private trayService: TrayService | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private onboardingWindow: BrowserWindow | null = null;
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

  // Icon paths
  private readonly trayIconIdleRelPath = "../assets/icon-template.png";
  private readonly trayIconRecordingRelPath = "../assets/icon-recording.png";
  private readonly dockIconRelPath = "../assets/icon.png";

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
    this.trayService?.updateTrayMenu(status as TraySetupStatus);
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

  async initialize() {
    await app.whenReady();
    console.log("App is ready");
    // Create tray immediately to show status during initialization
    this.trayService = new TrayService(
      this.trayIconIdleRelPath,
      this.trayIconRecordingRelPath,
      this.dockIconRelPath,
      (s) => this.getStatusMessage(s as SetupStatus),
      () => this.toggleRecording(),
      () => this.showSettings(),
      () => this.showModelManager()
    );
    this.trayService.createTray();
    // Toggle dock visibility based on settings window visibility
    try {
      this.settingsService.onWindowVisibilityChange((visible) => {
        try {
          if (visible) {
            this.trayService?.showDock(true);
          } else {
            const onboardingVisible = !!(
              this.onboardingWindow &&
              !this.onboardingWindow.isDestroyed() &&
              // isVisible may not exist on closed windows, guard it
              (this.onboardingWindow as any).isVisible &&
              (this.onboardingWindow as any).isVisible()
            );
            if (!onboardingVisible) this.trayService?.showDock(false);
          }
        } catch (e) {}
      });
    } catch (e) {}
    this.setSetupStatus("preparing-app");

    // Best-effort cleanup of stale embedded python servers
    try {
      await this.transcriptionClient.killStaleEmbeddedPythonProcesses();
    } catch {}

    // Initialize data directories
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!existsSync(this.config.getCacheDir())) {
      mkdirSync(this.config.getCacheDir(), { recursive: true });
    }

    // On first run show onboarding flow before heavy setup
    const settings = this.settingsService.getCurrentSettings();
    const isFirstRun = !settings?.onboardingComplete;

    if (isFirstRun) {
      this.openOnboardingWindow();
      this.setupOnboardingIpc();
      this.trayService?.updateTrayMenu(
        this.currentSetupStatus as TraySetupStatus
      );
      return; // Defer regular initialization until onboarding completes
    }

    // Run operations in parallel when not first run
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
    try {
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
          }
        }
      );
    } catch (e: any) {
      if (e && e.code === "PORT_IN_USE") {
        await this.showPortInUseError(this.config.serverPort);
      } else {
        console.error("Failed to start server:", e);
      }
    }

    // Wait for other initialization tasks to complete
    await Promise.allSettled(initTasks);

    this.registerGlobalShortcuts();
    this.setupIpcHandlers();

    // By default keep the app as a menu-bar-only app (hide dock) unless onboarding or settings are visible
    try {
      this.trayService?.showDock(false);
    } catch (e) {}

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
    // Audio capture handlers
    ipcMain.on("audio-data", (_event, audioData: Float32Array) => {
      try {
        if (this.transcriptionClient) {
          this.transcriptionClient.sendAudioData(audioData);
        }
      } catch (e) {
        console.error("Failed to forward audio data:", e);
      }
    });

    ipcMain.on("audio-error", (_event, error: string) => {
      console.error("Audio capture error:", error);
      try {
        // Surface error to audio service listeners if present
        (this.audioService as any).emit?.("error", new Error(error));
      } catch {}
    });

    ipcMain.on("audio-capture-started", () => {
      console.log("Audio capture started (IPC)");
      try {
        (this.audioService as any).emit?.("captureStarted");
      } catch {}
    });

    ipcMain.on("audio-capture-stopped", () => {
      console.log("Audio capture stopped (IPC)");
      try {
        (this.audioService as any).emit?.("captureStopped");
      } catch {}
    });

    // Extend with more handlers as needed
    console.log("IPC Handlers set up");
  }

  private setupOnboardingIpc() {
    ipcMain.handle("onboarding:getInitialState", () => ({
      ai: this.config.ai,
      model: this.config.defaultModel,
    }));

    ipcMain.handle("onboarding:checkAccessibility", async () => {
      const ok = await this.textInjector.ensureAccessibilityPermissions();
      return ok;
    });

    ipcMain.handle("onboarding:resetAccessibilityCache", () => {
      this.textInjector.resetAccessibilityCache();
      return true;
    });

    ipcMain.handle("onboarding:setModel", (_e, modelRepoId: string) => {
      this.config.setDefaultModel(modelRepoId);
      this.settingsService
        .getSettingsManager()
        .set("defaultModel", modelRepoId);
      this.settingsService.getSettingsManager().saveSettings();
    });

    ipcMain.handle("onboarding:setAiEnabled", (_e, enabled: boolean) => {
      this.settingsService.getSettingsManager().set("ai.enabled", enabled);
      this.settingsService.getSettingsManager().saveSettings();
      this.config.ai.enabled = enabled;
    });

    ipcMain.handle(
      "onboarding:setAiProvider",
      (_e, payload: { baseUrl: string; model: string }) => {
        const { baseUrl, model } = payload;
        this.settingsService.getSettingsManager().set("ai.baseUrl", baseUrl);
        this.settingsService.getSettingsManager().set("ai.model", model);
        this.settingsService.getSettingsManager().saveSettings();
        this.config.ai.baseUrl = baseUrl;
        this.config.ai.model = model;
      }
    );

    ipcMain.handle(
      "onboarding:saveApiKey",
      async (_e, payload: { apiKey: string }) => {
        const { SecureStorageService } = await import(
          "./services/SecureStorageService"
        );
        const secure = new SecureStorageService();
        await secure.setApiKey(payload.apiKey);
        return { success: true };
      }
    );

    ipcMain.handle("onboarding:runSetup", async (event) => {
      // Chain model ensure + server start, emitting progress to renderer
      try {
        const sendLog = (line: string) =>
          event.sender.send("onboarding:log", { line });

        await this.modelManager.ensureModelExists(
          this.config.defaultModel,
          (p) => {
            event.sender.send("onboarding:progress", {
              status: p.status,
              message: p.message,
              percent:
                p.status === "cloning" ? 40 : p.status === "complete" ? 60 : 20,
            });
          },
          sendLog
        );

        event.sender.send("onboarding:progress", {
          status: "starting-server",
          message: "Starting Whisper server...",
          percent: 70,
        });

        try {
          await this.transcriptionClient.startServer(
            this.config.defaultModel,
            (progress) => {
              let percent = 70;
              if (progress.status === "installing") percent = 80;
              else if (progress.status === "launching") percent = 90;
              else if (progress.status === "complete") percent = 100;
              event.sender.send("onboarding:progress", {
                status: progress.status,
                message: progress.message,
                percent,
              });
            },
            sendLog
          );
        } catch (e: any) {
          if (e && e.code === "PORT_IN_USE") {
            await this.showPortInUseError(this.config.serverPort);
          }
          throw e;
        }

        event.sender.send("onboarding:progress", {
          status: "complete",
          message: "Setup complete",
          percent: 100,
        });

        return { success: true };
      } catch (e: any) {
        event.sender.send("onboarding:progress", {
          status: "error",
          message: e?.message || "Setup failed",
        });
        return { success: false, error: e?.message };
      }
    });

    ipcMain.handle("onboarding:complete", async () => {
      // Mark onboarding complete and continue normal init
      this.settingsService.getSettingsManager().set("onboardingComplete", true);
      this.settingsService.getSettingsManager().saveSettings();
      this.onboardingWindow?.close();
      this.onboardingWindow = null;
      // Continue normal init
      this.initializeAfterOnboarding();
    });
  }

  private async initializeAfterOnboarding() {
    // Continue with normal init steps after onboarding
    this.setSetupStatus("preparing-app");

    if (!existsSync(this.config.dataDir))
      mkdirSync(this.config.dataDir, { recursive: true });
    if (!existsSync(this.config.getCacheDir()))
      mkdirSync(this.config.getCacheDir(), { recursive: true });

    const initTasks = [
      this.textInjector.ensureAccessibilityPermissions().catch(() => {}),
      this.preloadWindows().catch(() => {}),
    ];

    this.setSetupStatus("starting-server");
    try {
      await this.transcriptionClient.startServer(this.config.defaultModel);
    } catch (e: any) {
      if (e && e.code === "PORT_IN_USE") {
        await this.showPortInUseError(this.config.serverPort);
      } else {
        console.error("Failed to start server:", e);
      }
    }
    await Promise.allSettled(initTasks);
    this.registerGlobalShortcuts();
    this.setupIpcHandlers();
    // Keep the dock icon visible after onboarding and ensure icon is set
    this.setSetupStatus("idle");
  }

  private async showPortInUseError(port: number): Promise<void> {
    try {
      await dialog.showMessageBox({
        type: "error",
        title: "Port In Use",
        message: `Port ${port} is already in use`,
        detail:
          'The Whisper server could not start because the configured port is already in use. Open Settings → General and change "Server Port", then try again.',
        buttons: ["OK"],
        defaultId: 0,
      });
    } catch {}
  }

  private openOnboardingWindow(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.focus();
      return;
    }
    this.onboardingWindow = new BrowserWindow({
      width: 600,
      height: 520,
      resizable: false,
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 10, y: 12 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "./preload/onboardingPreload.js"),
        backgroundThrottling: false,
      },
      show: false,
    });
    this.onboardingWindow.loadFile(
      join(__dirname, "./renderer/onboarding.html")
    );
    this.onboardingWindow.once("ready-to-show", () => {
      this.onboardingWindow?.show();
      try {
        // Ensure dock is visible while onboarding is open
        app.dock?.show();
      } catch (e) {}
    });

    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = null;
      try {
        // If settings window is not visible, hide the dock again
        const settingsVisible = this.settingsService.isWindowVisible();
        if (!settingsVisible) app.dock?.hide();
      } catch (e) {}
    });
  }

  private cleanupIpcHandlers() {
    console.log("=== Cleaning up IPC handlers ===");

    // Remove all IPC listeners to prevent memory leaks
    ipcMain.removeAllListeners("start-dictation");
    ipcMain.removeAllListeners("stop-dictation");
    ipcMain.removeAllListeners("cancel-dictation");
    ipcMain.removeAllListeners("close-dictation-window");
    ipcMain.removeAllListeners("download-model");
    // Remove audio IPC listeners
    ipcMain.removeAllListeners("audio-data");
    ipcMain.removeAllListeners("audio-error");
    ipcMain.removeAllListeners("audio-capture-started");
    ipcMain.removeAllListeners("audio-capture-stopped");

    console.log("=== IPC handlers cleaned up ===");
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

  /**
   * Helper to set tray icon and app icon in menu bar.
   * Loads the image, sets it as a template image, and applies it to both tray and app.
   */
  private handleTrayClick() {
    try {
      const settings = this.settingsService.getCurrentSettings();
      const isOnboardingComplete = !!settings?.onboardingComplete;
      if (!isOnboardingComplete) {
        this.openOnboardingWindow();
        return;
      }
      // When onboarding is complete, toggle dictation on click
      this.toggleRecording();
    } catch (e) {
      console.error("Error handling tray click:", e);
    }
  }

  /**
   * Handle clicks on the Dock icon (macOS activate event).
   * - If onboarding hasn't completed, show onboarding
   * - If any windows are visible, show/focus them
   * - Otherwise, open the dictation window
   */
  public handleDockClick() {
    try {
      const settings = this.settingsService.getCurrentSettings();
      this.trayService?.handleDockClick(
        () => !settings?.onboardingComplete,
        () => this.openOnboardingWindow(),
        () => this.dictationWindowService.showDictationWindow()
      );
    } catch (e) {
      console.error("Error handling dock click:", e);
    }
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
      // If the window is configured to always be shown, flush segments and continue
      if (this.config.showDictationWindowAlways) {
        console.log(
          "Always-show-window enabled: flushing segments and continuing recording"
        );
        await this.flushSegmentsWhileContinuing();
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
      this.segmentManager.resetIgnoreNextCompleted();

      // 2. Enable accumulating mode - segments will be displayed but not auto-transformed/injected
      this.segmentManager.setAccumulatingMode(true);

      // 3. Show dictation window (pre-loaded for instant display)
      const windowStartTime = Date.now();
      await this.dictationWindowService.showDictationWindow();
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);

      // 4. Start recording visuals and audio capture in parallel
      this.isRecording = true;
      this.trayService?.updateTrayIcon("recording");
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
      this.trayService?.updateTrayIcon("idle");
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

  /**
   * Flushes all accumulated segments (transform and inject) while keeping
   * the audio capture and transcription running and the window open.
   * Used when showDictationWindowAlways is enabled and the user presses the shortcut again.
   */
  private async flushSegmentsWhileContinuing(): Promise<void> {
    try {
      console.log("=== Flushing segments while continuing recording ===");

      // Ensure the dictation window is visible
      this.dictationWindowService.showWindow();

      // Indicate transforming state in the UI
      this.dictationWindowService.setTransformingStatus();

      // Determine if there is an in-progress segment right now
      const hadInProgress =
        this.segmentManager.getInProgressTranscribedSegments().length > 0;

      // Keep accumulating mode enabled to continue real-time display after flush
      // Transform and inject all accumulated segments
      const result = await this.segmentManager.transformAndInjectAllSegments();

      if (result.success) {
        console.log(
          `Flushed and injected ${result.segmentsProcessed} segments (continuing)`
        );
      } else {
        console.error("Flush while continuing failed:", result.error);
      }

      // Clear the dictation window transcription and return to listening state
      this.dictationWindowService.clearTranscription();

      // Re-enable accumulating mode so new incoming segments are shown without auto-flush
      this.segmentManager.setAccumulatingMode(true);

      // If there was an in-progress segment at flush time, ignore the next
      // completed segment (it is the tail completing post-flush)
      if (hadInProgress) {
        this.segmentManager.ignoreNextCompletedSegment();
      }

      // Maintain recording state and tray icon
      this.isRecording = true;
      this.isFinishing = false;
      this.updateTrayIcon("recording");
    } catch (error) {
      console.error("Failed to flush segments while continuing:", error);
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
      this.trayService?.updateTrayIcon("idle");

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
    // Backwards compatibility with older calls; delegate to tray service
    this.trayService?.updateTrayIcon(state);
  }

  // Clean up when app quits
  cleanup() {
    console.log("=== Starting app cleanup ===");

    // Set a timeout to force quit if cleanup takes too long
    const cleanupTimeout = setTimeout(() => {
      console.log("Cleanup timeout reached, forcing app quit...");
      process.exit(0);
    }, 5000); // 5 second timeout

    try {
      // Unregister global shortcuts
      globalShortcut.unregisterAll();

      // Stop transcription and close WebSocket
      this.transcriptionClient.stopTranscription();

      // Stop audio capture and close audio window
      this.audioService.stopCapture();

      // Close dictation window
      this.dictationWindowService.cleanup();

      // Close settings window
      this.settingsService.cleanup();

      // Close model manager window if open
      if (this.modelManagerWindow && !this.modelManagerWindow.isDestroyed()) {
        this.modelManagerWindow.close();
        this.modelManagerWindow = null;
      }

      // Stop WhisperLive server
      this.transcriptionClient.stopServer();

      // Clear tray
      this.trayService?.destroy();

      // Clear any remaining timeouts
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }

      // Clean up IPC handlers
      this.cleanupIpcHandlers();

      // Force close any remaining windows
      this.forceCloseAllWindows();

      console.log("=== App cleanup completed ===");
    } catch (error) {
      console.error("Error during cleanup:", error);
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }

  private forceCloseAllWindows(): void {
    console.log("=== Force closing all remaining windows ===");

    const allWindows = BrowserWindow.getAllWindows();
    console.log(`Found ${allWindows.length} remaining windows`);

    allWindows.forEach((window, index) => {
      if (!window.isDestroyed()) {
        console.log(`Force closing window ${index + 1}...`);
        window.destroy();
      }
    });

    console.log("=== All windows force closed ===");
  }
}

const appInstance = new WhisperMacApp();
appInstance.initialize();

// Handle app quit
app.on("will-quit", () => {
  appInstance.cleanup();
});

// Handle force quit (Ctrl+C or kill signal)
process.on("SIGINT", () => {
  console.log("Received SIGINT, forcing app quit...");
  appInstance.cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, forcing app quit...");
  appInstance.cleanup();
  process.exit(0);
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
  // Handle Dock icon clicks: delegate to appInstance
  try {
    appInstance.handleDockClick();
  } catch (e) {
    console.error("Failed to handle dock activate:", e);
  }
});
