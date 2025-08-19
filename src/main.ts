// Electron modules
import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from "electron";

// Node.js utilities
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// Core services

import {
  TranscriptionPluginManager,
  createTranscriptionPluginManager,
} from "./plugins";
import { TextInjectionService } from "./services/TextInjectionService";
import { TransformationService } from "./services/TransformationService";
import { ModelManager } from "./services/ModelManager";
import { AppConfig } from "./config/AppConfig";
import { SelectedTextService } from "./services/SelectedTextService";
import { DictationWindowService } from "./services/DictationWindowService";
import { SettingsService } from "./services/SettingsService";
import { ConfigurableActionsService } from "./services/ConfigurableActionsService";
import { SettingsManager } from "./config/SettingsManager";

// Segment management
import { SegmentManager } from "./services/SegmentManager";
import {
  ErrorWindowService,
  ErrorPayload,
} from "./services/ErrorWindowService";
import { UnifiedModelDownloadService } from "./services/UnifiedModelDownloadService";
import {
  TrayService,
  SetupStatus as TraySetupStatus,
} from "./services/TrayService";
import { SegmentUpdate } from "./types/SegmentTypes";
import { DefaultActionsConfig } from "./types/ActionTypes";

type SetupStatus =
  | "idle"
  | "downloading-models"
  | "setting-up-whisper"
  | "preparing-app"
  | "checking-permissions"
  | "starting-server"
  | "loading-windows"
  | "initializing-plugins"
  | "service-ready";

class WhisperMacApp {
  private trayService: TrayService | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private onboardingWindow: BrowserWindow | null = null;
  private modelManagerWindow: BrowserWindow | null = null;

  private transcriptionPluginManager: TranscriptionPluginManager;
  private textInjector: TextInjectionService;
  private transformationService: TransformationService;
  private modelManager: ModelManager;
  private unifiedModelDownloadService: UnifiedModelDownloadService;
  private config: AppConfig;
  private selectedTextService: SelectedTextService;
  private dictationWindowService: DictationWindowService;
  private segmentManager: SegmentManager;
  private settingsService: SettingsService;
  private settingsManager: SettingsManager;
  private errorService: ErrorWindowService;
  private configurableActionsService: ConfigurableActionsService | null = null;

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
  private pendingToggle = false; // Defer first toggle until setup completes
  private vadAudioBuffer: Float32Array[] = [];
  private vadSampleRate: number = 16000;

  constructor() {
    this.config = new AppConfig();

    // Initialize settings service first so it can load and apply settings to config
    this.settingsService = new SettingsService(this.config);

    // Initialize other services with potentially updated config

    this.modelManager = new ModelManager(this.config);
    this.unifiedModelDownloadService = new UnifiedModelDownloadService(
      this.config,
      this.modelManager
    );
    this.transcriptionPluginManager = createTranscriptionPluginManager(
      this.config
    );

    // Set the transcription plugin manager reference in settings service
    this.settingsService.setTranscriptionPluginManager(
      this.transcriptionPluginManager
    );

    // Set the transcription plugin manager reference in unified download service
    this.unifiedModelDownloadService.setTranscriptionPluginManager(
      this.transcriptionPluginManager
    );

    // Set the unified model download service reference in settings service
    this.settingsService.setUnifiedModelDownloadService(
      this.unifiedModelDownloadService
    );

    this.textInjector = new TextInjectionService();
    this.transformationService = new TransformationService(this.config);
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);

    // Set up VAD audio segment handler
    this.dictationWindowService.on(
      "vad-audio-segment",
      (audioData: Float32Array) => {
        console.log(
          "Processing VAD audio segment:",
          audioData.length,
          "samples"
        );
        // Accumulate for potential runOnAll
        this.vadAudioBuffer.push(audioData);
        this.transcriptionPluginManager.processAudioSegment(audioData);
      }
    );
    this.configurableActionsService = new ConfigurableActionsService();
    this.segmentManager = new SegmentManager(
      this.transformationService,
      this.textInjector,
      this.selectedTextService,
      this.configurableActionsService
    );
    this.errorService = new ErrorWindowService();
    this.settingsManager = new SettingsManager(this.config);

    // Listen for action detection events from segment manager
    this.segmentManager.on("action-detected", async (actionMatch) => {
      console.log(
        `[Main] Action detected via segment manager: "${actionMatch.keyword}" with argument: "${actionMatch.argument}"`
      );

      // Execute the action
      if (this.configurableActionsService) {
        await this.configurableActionsService.executeAction(actionMatch);
      }

      // Stop dictation, audio recording, and hide window
      await this.stopDictation();
    });

    this.onSetupStatusChange((status) => {
      if (status === "idle" && this.pendingToggle) {
        this.pendingToggle = false;
        this.toggleRecording();
      }
    });

    // Listen for actions configuration updates
    this.settingsManager.on(
      "actions-updated",
      (actionsConfig: DefaultActionsConfig) => {
        if (this.configurableActionsService && actionsConfig?.actions) {
          this.configurableActionsService.setActions(actionsConfig.actions);
        }
      }
    );

    // Initialize actions from current settings
    const actionsConfig = this.settingsManager.get(
      "actions"
    ) as DefaultActionsConfig;
    if (this.configurableActionsService && actionsConfig?.actions) {
      this.configurableActionsService.setActions(actionsConfig.actions);
    }
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

    // Global error handlers
    process.on("uncaughtException", (err: any) => {
      console.error("Uncaught exception:", err);
      this.showError({
        title: "Unexpected error",
        description: err?.message || String(err),
        actions: ["ok", "quit"],
      });
    });
    process.on("unhandledRejection", (reason: any) => {
      console.error("Unhandled rejection:", reason);
      this.showError({
        title: "Unexpected error",
        description:
          (reason && (reason.message || reason.toString())) || "Unknown error",
        actions: ["ok", "quit"],
      });
    });
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

    // Plugin system initialization - no pre-cleanup needed

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
      this.setupOnboardingIpc();
      this.openOnboardingWindow();
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

      // Whisper.cpp is prepared during app bundling; models are handled in onboarding

      // Pre-load windows for faster startup
      this.preloadWindows()
        .then(() => {
          console.log("Window preloading completed");
        })
        .catch((error) => {
          console.error("Failed to preload windows:", error);
          this.showError({
            title: "Failed to prepare UI",
            description:
              error instanceof Error ? error.message : "Unknown error",
            actions: ["ok"],
          });
        }),
      // Plugin system doesn't require WebSocket checks
      (async () => {
        console.log(
          "Plugin system initialization will handle availability checks"
        );
      })(),
    ];

    // Initialize transcription plugins
    this.setSetupStatus("initializing-plugins");
    try {
      await this.transcriptionPluginManager.initializePlugins();
      console.log("Transcription plugins initialized");
    } catch (error) {
      console.error("Failed to initialize transcription plugins:", error);
    }

    this.setSetupStatus("service-ready");
    console.log("Transcription plugin system ready");

    // Listen for plugin errors
    this.transcriptionPluginManager.on("plugin-error", ({ plugin, error }) => {
      console.error(`Transcription plugin ${plugin} error:`, error);
      this.showError({
        title: "Transcription error",
        description:
          error && (error.message || error.toString())
            ? error.message || error.toString()
            : "Transcription plugin failed",
        actions: ["ok"],
      });
    });

    // VAD+YAP: Audio errors are handled directly by the browser VAD

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
      await Promise.allSettled([this.dictationWindowService.preloadWindow()]);

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

          // Determine which plugin should handle this download
          const activePlugin =
            this.config.get("transcriptionPlugin") || "whisper-cpp";

          const success =
            await this.unifiedModelDownloadService.ensureModelForPlugin(
              activePlugin,
              modelRepoId,
              (progress) => {
                // Update tray status based on progress
                if (progress.status === "starting") {
                  this.setSetupStatus("downloading-models");
                } else if (progress.status === "downloading") {
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

    // Plugin switching with unified download service
    ipcMain.handle(
      "plugin:switch",
      async (event, payload: { pluginName: string; modelName?: string }) => {
        try {
          const { pluginName, modelName } = payload;
          console.log(
            `Switching to plugin: ${pluginName}, model: ${modelName}`
          );

          const onProgress = (progress: any) => {
            event.sender.send("plugin:switchProgress", progress);
          };

          const onLog = (line: string) => {
            event.sender.send("plugin:switchLog", { line });
          };

          const success = await this.unifiedModelDownloadService.switchToPlugin(
            pluginName,
            modelName,
            onProgress,
            onLog
          );

          return { success };
        } catch (error: any) {
          console.error("Plugin switch error:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Check if download is in progress (unified)
    ipcMain.handle("unified:isDownloading", async () => {
      const isDownloading = this.unifiedModelDownloadService.isDownloading();
      const currentDownload =
        this.unifiedModelDownloadService.getCurrentDownload();
      return {
        isDownloading,
        currentDownload,
      };
    });

    // VAD+YAP: Audio processing is handled by Silero VAD in the browser
    // Audio segments are sent via 'vad-audio-segment' (handled by DictationWindowService)

    // Audio capture events handled directly by VAD in the browser

    // Extend with more handlers as needed
    console.log("IPC Handlers set up");
  }

  private setupOnboardingIpc() {
    ipcMain.handle("onboarding:getInitialState", () => ({
      ai: this.config.ai,
      model: this.config.get("whisperCppModel") || "ggml-base.en.bin",
      voskModel: this.config.get("voskModel") || "vosk-model-small-en-us-0.15",
      plugin: this.config.get("transcriptionPlugin") || "yap",
    }));

    ipcMain.handle("onboarding:getPluginOptions", () => {
      const plugins = this.transcriptionPluginManager
        .getPlugins()
        .map((plugin) => ({
          name: plugin.name,
          displayName: plugin.displayName,
          description: plugin.description,
          version: plugin.version,
          supportsRealtime: plugin.supportsRealtime,
          supportsBatchProcessing: plugin.supportsBatchProcessing,
        }));

      const options = this.transcriptionPluginManager.getAllPluginOptions();

      return {
        plugins,
        options,
      };
    });

    ipcMain.handle("onboarding:checkAccessibility", async () => {
      const ok = await this.textInjector.ensureAccessibilityPermissions();
      return ok;
    });

    ipcMain.handle("onboarding:resetAccessibilityCache", () => {
      this.textInjector.resetAccessibilityCache();
      return true;
    });

    ipcMain.handle("onboarding:setModel", (_e, modelName: string) => {
      this.config.set("whisperCppModel", modelName);

      // Save to settings
      const sm = this.settingsService.getSettingsManager();
      sm.set("plugin.whisper-cpp.model", modelName);
      sm.saveSettings();

      // Update the WhisperCppTranscriptionPlugin model path
      const whisperPlugin =
        this.transcriptionPluginManager.getPlugin("whisper-cpp");
      if (whisperPlugin && "updateModelPath" in whisperPlugin) {
        (whisperPlugin as any).updateModelPath();
      }
    });

    ipcMain.handle("onboarding:setVoskModel", (_e, modelName: string) => {
      this.config.set("voskModel", modelName);

      // Save to settings
      const sm = this.settingsService.getSettingsManager();
      sm.set("plugin.vosk.model", modelName);
      sm.saveSettings();

      // Update the VoskTranscriptionPlugin configuration
      const voskPlugin = this.transcriptionPluginManager.getPlugin("vosk");
      if (voskPlugin) {
        voskPlugin.configure({ model: modelName });
      }
    });

    ipcMain.handle(
      "onboarding:setPlugin",
      async (
        _e,
        payload: { pluginName: string; options?: Record<string, any> }
      ) => {
        const { pluginName, options = {} } = payload;
        this.config.set("transcriptionPlugin", pluginName);

        // Save plugin options to settings
        const sm = this.settingsService.getSettingsManager();
        sm.set("transcriptionPlugin", pluginName);
        Object.keys(options).forEach((key) => {
          const settingKey = `plugin.${pluginName}.${key}`;
          sm.set(settingKey, options[key]);
        });
        sm.saveSettings();

        try {
          await this.transcriptionPluginManager.setActivePlugin(
            pluginName,
            options
          );
        } catch {}
      }
    );

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
      try {
        const sendLog = (line: string) =>
          event.sender.send("onboarding:log", { line });

        const onProgress = (progress: any) => {
          event.sender.send("onboarding:progress", {
            status: "downloading-models",
            message:
              progress.message ||
              `Preparing ${progress.pluginType || "model"}...`,
            percent: progress.percent || 0,
          });
        };

        const activePlugin = this.config.get("transcriptionPlugin") || "yap";
        sendLog(`Setting up ${activePlugin} plugin`);

        if (activePlugin === "whisper-cpp") {
          const modelName =
            this.config.get("whisperCppModel") || "ggml-base.en.bin";

          await this.unifiedModelDownloadService.ensureModelForPlugin(
            "whisper-cpp",
            modelName,
            onProgress,
            sendLog
          );

          event.sender.send("onboarding:progress", {
            status: "service-ready",
            message: "Whisper.cpp ready",
            percent: 100,
          });
        } else if (activePlugin === "vosk") {
          const modelName =
            this.config.get("voskModel") || "vosk-model-small-en-us-0.15";

          await this.unifiedModelDownloadService.ensureModelForPlugin(
            "vosk",
            modelName,
            onProgress,
            sendLog
          );

          event.sender.send("onboarding:progress", {
            status: "service-ready",
            message: "Vosk ready",
            percent: 100,
          });
        } else {
          event.sender.send("onboarding:progress", {
            status: "service-ready",
            message: "YAP transcription ready",
            percent: 100,
          });
        }

        // Set the active plugin
        await this.transcriptionPluginManager.setActivePlugin(activePlugin);

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

    // Initialize plugins after onboarding selection
    this.setSetupStatus("initializing-plugins");
    try {
      await this.transcriptionPluginManager.initializePlugins();
      console.log("Transcription plugins initialized (post-onboarding)");
    } catch (error) {
      console.error(
        "Failed to initialize transcription plugins (post-onboarding):",
        error
      );
    }
    this.setSetupStatus("service-ready");
    console.log("Transcription plugin system ready (post-onboarding)");
    await Promise.allSettled(initTasks);
    this.registerGlobalShortcuts();
    this.setupIpcHandlers();
    // Keep the dock icon visible after onboarding and ensure icon is set
    this.setSetupStatus("idle");
  }

  private async showPortInUseError(port: number): Promise<void> {
    try {
      await this.showError({
        title: "Port in use",
        description: `Port ${port} is already in use. Open Settings → Advanced and change “Server Port”, then try again.`,
        actions: ["ok"],
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
    // No audio capture listeners to remove in VAD+YAP system

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
      if (this.currentSetupStatus !== "idle") {
        this.pendingToggle = true;
        console.log("App not idle yet; deferring toggle until ready");
        return;
      }
      this.toggleRecording();
    });

    // Alternative shortcut (keeping one backup)
    const success2 = globalShortcut.register(
      "CommandOrControl+Option+Space",
      () => {
        console.log("CommandOrControl+Option+Space is pressed");
        if (this.currentSetupStatus !== "idle") {
          this.pendingToggle = true;
          console.log("App not idle yet; deferring toggle until ready");
          return;
        }
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

      // Immediately stop audio recording and show processing state
      console.log("Immediately stopping audio recording...");
      this.dictationWindowService.stopRecording();

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
      this.vadAudioBuffer = [];

      // 2. Enable accumulating mode - segments will be displayed but not auto-transformed/injected
      this.segmentManager.setAccumulatingMode(true);

      // 3. Show dictation window (pre-loaded for instant display)
      const windowStartTime = Date.now();
      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      await this.dictationWindowService.showDictationWindow(
        criteria?.runOnAll || false
      );
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);

      // Start transcription with active plugin before starting VAD/audio capture
      const transcriptionStartTime = Date.now();
      try {
        await this.transcriptionPluginManager.startTranscription(
          async (update: SegmentUpdate) => {
            this.dictationWindowService.updateTranscription(update);
            await this.processSegments(update);
          }
        );

        const transcriptionEndTime = Date.now();
        console.log(
          `Transcription setup: ${
            transcriptionEndTime - transcriptionStartTime
          }ms`
        );
      } catch (error: any) {
        console.error("Failed to start transcription:", error);
        await this.cancelDictationFlow();
        await this.showError({
          title: "Transcription failed",
          description: error.message || "Unknown error starting transcription",
          actions: ["ok"],
        });
        return;
      }

      // 4. Start recording visuals and audio capture
      this.isRecording = true;
      this.trayService?.updateTrayIcon("recording");
      this.dictationWindowService.startRecording();

      // VAD+YAP: Audio processing is handled by the browser VAD and sent to YAP when speech segments are detected

      const totalTime = Date.now() - startTime;
      console.log(`=== Dictation started successfully in ${totalTime}ms ===`);
    } catch (error) {
      console.error("Failed to start dictation:", error);
      await this.cancelDictationFlow();
      await this.showError({
        title: "Could not start dictation",
        description:
          error instanceof Error ? error.message : "Unknown error occurred.",
        actions: ["ok"],
      });
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

      // Give a moment for final server updates
      await new Promise((r) => setTimeout(r, 250));

      // This should no longer be called with the new flow, but keep as fallback
      console.log(
        "=== stopDictation called - this should be rare with new flow ==="
      );

      // Clear all segments without flushing (segments should have been handled in finishCurrentDictation)
      this.segmentManager.clearAllSegments();

      await this.transcriptionPluginManager.stopTranscription();

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
        const criteria =
          this.transcriptionPluginManager.getActivePluginActivationCriteria();
        // If runOnAll buffering has audio, proceed to finalize instead of early stop
        if (
          !(
            criteria?.runOnAll &&
            this.transcriptionPluginManager.hasBufferedAudio()
          )
        ) {
          console.log("No segments found, stopping dictation immediately");
          await this.stopDictation();
          return;
        }
      }

      console.log(
        `Found ${allSegments.length} segments to transform and inject`
      );

      // Set finishing state
      this.isFinishing = true;

      // 2. Set processing status in UI immediately to give user feedback (changed from transforming)
      this.dictationWindowService.setProcessingStatus();

      // 3. Wait a bit longer for in-progress segments to complete
      // Allow time for transcription plugins to finish processing
      console.log("Waiting for in-progress segments to complete...");
      await new Promise((r) => setTimeout(r, 1000));

      // 4. Disable accumulating mode so we can transform+inject
      this.segmentManager.setAccumulatingMode(false);

      // 5. Either run active plugin in runOnAll mode, or transform+inject normally
      const criteria =
        this.transcriptionPluginManager.getActivePluginActivationCriteria();
      console.log("Criteria:", criteria);
      let transformResult: {
        success: boolean;
        segmentsProcessed: number;
        transformedText: string;
        error?: string;
      } = {
        success: true,
        segmentsProcessed: 0,
        transformedText: "",
      };

      if (criteria?.runOnAll) {
        console.log(
          "=== Active plugin runOnAll enabled: finalizing buffered audio ==="
        );
        try {
          await this.transcriptionPluginManager.finalizeBufferedAudio();
        } catch (e) {
          console.error("Failed to finalize buffered audio:", e);
        }
      }

      console.log(
        "=== Transforming and injecting all accumulated segments ==="
      );
      transformResult =
        await this.segmentManager.transformAndInjectAllSegmentsInternal({
          skipTransformation: !!criteria?.skipTransformation,
        });

      // 6. Show completed status briefly before closing window
      this.dictationWindowService.completeDictation(
        this.dictationWindowService.getCurrentTranscription()
      );

      // Brief delay to show completed status
      await new Promise((r) => setTimeout(r, 500));

      // 7. Hide the dictation window after transform+inject is complete
      this.dictationWindowService.hideWindow();

      if (transformResult.success) {
        console.log(
          `Successfully transformed and injected ${transformResult.segmentsProcessed} segments`
        );
      } else {
        console.error("Transform and inject failed:", transformResult.error);
      }

      // 8. Complete the dictation flow
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
      await this.transcriptionPluginManager.stopTranscription();

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
      await this.transcriptionPluginManager.stopTranscription();
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
  async cleanup() {
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
      await this.transcriptionPluginManager.stopTranscription();

      // Close dictation window
      this.dictationWindowService.cleanup();

      // Close settings window
      this.settingsService.cleanup();

      // Close model manager window if open
      if (this.modelManagerWindow && !this.modelManagerWindow.isDestroyed()) {
        this.modelManagerWindow.close();
        this.modelManagerWindow = null;
      }

      // Close error window
      this.errorService.cleanup();

      // Stop transcription plugins
      // Cleanup transcription plugins
      await this.transcriptionPluginManager.cleanup();

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

  public async showError(payload: ErrorPayload): Promise<void> {
    try {
      await this.errorService.show(payload);
    } catch (e) {
      // Fallback dialog if window fails
      try {
        await dialog.showMessageBox({
          type: "error",
          title: payload.title || "Error",
          message: payload.title || "Error",
          detail: payload.description || "",
          buttons: ["OK"],
          defaultId: 0,
        });
      } catch {}
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
