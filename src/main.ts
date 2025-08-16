// Electron modules
import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from "electron";

// Node.js utilities
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// Core services
import { AudioCaptureService } from "./services/AudioCaptureService";
import { TextInjectionService } from "./services/TextInjectionService";
import { AppConfig } from "./config/AppConfig";
import { SelectedTextService } from "./services/SelectedTextService";
import { DictationWindowService } from "./services/DictationWindowService";
import { SettingsService } from "./services/SettingsService";
import {
  ErrorWindowService,
  ErrorPayload,
} from "./services/ErrorWindowService";
import {
  TrayService,
  SetupStatus as TraySetupStatus,
} from "./services/TrayService";
import { GeminiService } from "./services/GeminiService";
import { float32ToWavBase64 } from "./helpers/wav";

type SetupStatus =
  | "idle"
  | "preparing-app"
  | "checking-permissions"
  | "loading-windows";

class WhisperMacApp {
  private trayService: TrayService | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private onboardingWindow: BrowserWindow | null = null;
  private audioService: AudioCaptureService;
  private textInjector: TextInjectionService;
  private config: AppConfig;
  private selectedTextService: SelectedTextService;
  private dictationWindowService: DictationWindowService;
  private settingsService: SettingsService;
  private errorService: ErrorWindowService;

  // Icon paths
  private readonly trayIconIdleRelPath = "../assets/icon-template.png";
  private readonly trayIconRecordingRelPath = "../assets/icon-recording.png";
  private readonly dockIconRelPath = "../assets/icon.png";

  // Status management
  private currentSetupStatus: SetupStatus = "idle";
  private setupStatusCallbacks: ((status: SetupStatus) => void)[] = [];

  // Dictation state
  private isRecording = false;
  private isFinishing = false;
  private finishingTimeout: NodeJS.Timeout | null = null;
  private pendingToggle = false;
  private finalSamples: Float32Array | null = null;
  private gemini = new GeminiService();

  constructor() {
    this.config = new AppConfig();

    // Initialize settings service first so it can load and apply settings to config
    this.settingsService = new SettingsService(this.config);

    // Initialize other services with potentially updated config
    this.audioService = new AudioCaptureService(this.config);
    this.textInjector = new TextInjectionService();
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);
    this.errorService = new ErrorWindowService();

    this.onSetupStatusChange((status) => {
      if (status === "idle" && this.pendingToggle) {
        this.pendingToggle = false;
        this.toggleRecording();
      }
    });
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
      case "preparing-app":
        return "Preparing app...";
      case "checking-permissions":
        return "Checking permissions...";
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
      () => {}
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
              (this.onboardingWindow as any).isVisible &&
              (this.onboardingWindow as any).isVisible()
            );
            if (!onboardingVisible) this.trayService?.showDock(false);
          }
        } catch (e) {}
      });
    } catch (e) {}
    this.setSetupStatus("preparing-app");

    // Initialize data directories
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }

    // On first run show onboarding flow before setup
    const settings = this.settingsService.getCurrentSettings();
    const isFirstRun = !settings?.onboardingComplete;

    if (isFirstRun) {
      this.openOnboardingWindow();
      this.setupOnboardingIpc();
      this.trayService?.updateTrayMenu(
        this.currentSetupStatus as TraySetupStatus
      );
      return;
    }

    // Run operations in parallel when not first run
    console.log("Starting parallel initialization tasks...");
    const initTasks = [
      this.textInjector.ensureAccessibilityPermissions().catch(() => {}),
      this.preloadWindows().catch(() => {}),
    ];

    await Promise.allSettled(initTasks);

    this.registerGlobalShortcuts();
    this.setupIpcHandlers();

    try {
      this.trayService?.showDock(false);
    } catch (e) {}

    this.setSetupStatus("idle");
    console.log("Initialization completed");
  }

  private async preloadWindows(): Promise<void> {
    try {
      console.log("Pre-loading windows for faster startup...");
      this.setSetupStatus("loading-windows");
      await Promise.allSettled([
        this.dictationWindowService.preloadWindow(),
        this.audioService.preloadWindow(),
      ]);
      console.log("Windows pre-loaded successfully");
    } catch (error) {
      console.error("Failed to pre-load windows:", error);
    }
  }

  private setupIpcHandlers() {
    ipcMain.on("start-dictation", async (event: Electron.IpcMainEvent) => {
      await this.startDictation();
      event.reply("dictation-started");
    });
    ipcMain.on("stop-dictation", async (event: Electron.IpcMainEvent) => {
      await this.stopDictation();
      event.reply("dictation-stopped");
    });

    ipcMain.on("cancel-dictation", async () => {
      console.log("Cancelling dictation via IPC...");
      await this.cancelDictationFlow();
    });

    ipcMain.on("close-dictation-window", () => {
      console.log("Closing dictation window via IPC, cancelling flow...");
      this.cancelDictationFlow();
    });

    ipcMain.on("audio-data", (_event, audioData: any) => {
      try {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("audio-data", audioData)
        );
      } catch {}
    });
    ipcMain.on("audio-final-samples", (_event, samples: Float32Array) => {
      try {
        this.finalSamples = samples;
      } catch {}
    });
    ipcMain.on("audio-level", (_event, level: number) => {
      try {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("audio-level", level)
        );
      } catch {}
    });

    ipcMain.on("audio-error", (_event, error: string) => {
      console.error("Audio capture error:", error);
      try {
        (this.audioService as any).emit?.("error", new Error(error));
      } catch {}
      this.showError({
        title: "Audio capture error",
        description: error,
        actions: ["ok"],
      });
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

    console.log("IPC Handlers set up");
  }

  private setupOnboardingIpc() {
    ipcMain.handle("onboarding:getInitialState", () => ({
      ai: this.config.ai,
    }));

    ipcMain.handle("onboarding:checkAccessibility", async () => {
      const ok = await this.textInjector.ensureAccessibilityPermissions();
      return ok;
    });

    ipcMain.handle("onboarding:resetAccessibilityCache", () => {
      this.textInjector.resetAccessibilityCache();
      return true;
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

    ipcMain.handle("onboarding:runSetup", async () => ({ success: true }));

    ipcMain.handle("onboarding:complete", async () => {
      this.settingsService.getSettingsManager().set("onboardingComplete", true);
      this.settingsService.getSettingsManager().saveSettings();
      this.onboardingWindow?.close();
      this.onboardingWindow = null;
      this.initializeAfterOnboarding();
    });
  }

  private async initializeAfterOnboarding() {
    this.setSetupStatus("preparing-app");

    if (!existsSync(this.config.dataDir))
      mkdirSync(this.config.dataDir, { recursive: true });

    const initTasks = [
      this.textInjector.ensureAccessibilityPermissions().catch(() => {}),
      this.preloadWindows().catch(() => {}),
    ];
    await Promise.allSettled(initTasks);
    this.registerGlobalShortcuts();
    this.setupIpcHandlers();
    this.setSetupStatus("idle");
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
        app.dock?.show();
      } catch (e) {}
    });

    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = null;
      try {
        const settingsVisible = this.settingsService.isWindowVisible();
        if (!settingsVisible) app.dock?.hide();
      } catch (e) {}
    });
  }

  private cleanupIpcHandlers() {
    console.log("=== Cleaning up IPC handlers ===");
    ipcMain.removeAllListeners("start-dictation");
    ipcMain.removeAllListeners("stop-dictation");
    ipcMain.removeAllListeners("cancel-dictation");
    ipcMain.removeAllListeners("close-dictation-window");
    ipcMain.removeAllListeners("audio-data");
    ipcMain.removeAllListeners("audio-error");
    ipcMain.removeAllListeners("audio-capture-started");
    ipcMain.removeAllListeners("audio-capture-stopped");
    console.log("=== IPC handlers cleaned up ===");
  }

  private showSettings() {
    this.settingsService.openSettingsWindow();
  }

  private registerGlobalShortcuts() {
    globalShortcut.unregisterAll();

    const success1 = globalShortcut.register("Control+D", () => {
      console.log("Control+D is pressed");
      if (this.currentSetupStatus !== "idle") {
        this.pendingToggle = true;
        console.log("App not idle yet; deferring toggle until ready");
        return;
      }
      this.toggleRecording();
    });

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

    if (!success1) console.error("Failed to register Control+D shortcut");
    if (!success2)
      console.error(
        "Failed to register CommandOrControl+Option+Space shortcut"
      );
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

      const windowStartTime = Date.now();
      await this.dictationWindowService.showDictationWindow();
      const windowEndTime = Date.now();
      console.log(`Window display: ${windowEndTime - windowStartTime}ms`);

      this.isRecording = true;
      this.trayService?.updateTrayIcon("recording");
      this.dictationWindowService.startRecording();

      const audioStartTime = Date.now();
      const audioResult = await this.audioService.startCapture().then(
        () => ({ status: "fulfilled" as const }),
        (reason) => ({ status: "rejected" as const, reason })
      );

      const audioEndTime = Date.now();
      console.log(`Audio setup: ${audioEndTime - audioStartTime}ms`);

      if (audioResult.status === "rejected") {
        throw new Error(`Failed to start audio capture: ${audioResult.reason}`);
      }

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

  private async stopDictation() {
    if (!this.isRecording) return;
    try {
      console.log("=== Stopping dictation process ===");
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }
      this.isRecording = false;
      this.isFinishing = false;
      this.trayService?.updateTrayIcon("idle");
      this.dictationWindowService.stopRecording();
      await this.audioService.stopCapture();
      await new Promise((r) => setTimeout(r, 250));
      console.log("=== stopDictation called (new flow) ===");
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
      console.log("=== Finishing current dictation with Gemini ===");
      this.isFinishing = true;

      // Immediately set complete status when user presses shortcut again
      this.dictationWindowService.completeDictation("");

      await this.audioService.stopCapture();
      for (
        let i = 0;
        i < 40 && (!this.finalSamples || this.finalSamples.length === 0);
        i++
      ) {
        await new Promise((r) => setTimeout(r, 25));
      }

      // Show processing state while Gemini is working
      this.dictationWindowService.setTransformingStatus();

      const samples = this.finalSamples;
      this.finalSamples = null;
      if (!samples || samples.length === 0) {
        console.log("No audio samples captured; stopping.");
        await this.stopDictation();
        return;
      }
      const wavB64 = float32ToWavBase64(samples, 16000);
      let resultText = "";
      try {
        resultText = await this.gemini.processAudioWithContext(
          wavB64,
          this.config
        );
      } catch (e: any) {
        console.error("Gemini processing failed:", e);
        await this.showError({
          title: "AI processing failed",
          description: e?.message || "Unknown error contacting Gemini",
          actions: ["ok"],
        });
        await this.cancelDictationFlow();
        return;
      }

      // Update with final text after Gemini processing
      this.dictationWindowService.completeDictation(resultText || "");

      try {
        await this.textInjector.insertText((resultText || "") + " ");
      } catch {}
      this.dictationWindowService.hideWindow();
      await this.completeDictationAfterFinishing();
    } catch (error) {
      console.error("Failed to finish current dictation:", error);
      await this.cancelDictationFlow();
    }
  }

  private async completeDictationAfterFinishing() {
    try {
      console.log("=== Completing dictation after finishing ===");
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }
      this.isRecording = false;
      this.isFinishing = false;
      this.trayService?.updateTrayIcon("idle");
      this.dictationWindowService.clearTranscription();
      console.log("=== Dictation completed successfully after finishing ===");
    } catch (error) {
      console.error("Failed to complete dictation after finishing:", error);
      await this.cancelDictationFlow();
    }
  }

  private async cancelDictationFlow() {
    console.log("=== Cancelling dictation flow ===");
    if (this.finishingTimeout) {
      clearTimeout(this.finishingTimeout);
      this.finishingTimeout = null;
    }
    const wasRecording = this.isRecording;
    this.isRecording = false;
    this.isFinishing = false;
    this.updateTrayIcon("idle");
    if (wasRecording) {
      await this.audioService.stopCapture();
    }
    this.dictationWindowService.closeDictationWindow();
    console.log("=== Dictation flow cancelled and cleaned up ===");
  }

  private updateTrayIcon(state: "idle" | "recording") {
    this.trayService?.updateTrayIcon(state);
  }

  cleanup() {
    console.log("=== Starting app cleanup ===");
    const cleanupTimeout = setTimeout(() => {
      console.log("Cleanup timeout reached, forcing app quit...");
      process.exit(0);
    }, 5000);
    try {
      globalShortcut.unregisterAll();
      this.audioService.stopCapture();
      this.audioService.cleanup();
      this.dictationWindowService.cleanup();
      this.settingsService.cleanup();
      this.errorService.cleanup();
      this.trayService?.destroy();
      if (this.finishingTimeout) {
        clearTimeout(this.finishingTimeout);
        this.finishingTimeout = null;
      }
      this.cleanupIpcHandlers();
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
    } catch {
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

app.on("will-quit", () => {
  appInstance.cleanup();
});
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
app.on("window-all-closed", (event: Electron.Event) => {
  event.preventDefault();
  console.log("All windows closed, but keeping app running (menu bar app)");
});
app.on("before-quit", (_event: Electron.Event) => {
  console.log("App quit requested");
});
app.on("activate", () => {
  try {
    const settings = appInstance["settingsService"].getCurrentSettings();
    appInstance["trayService"]?.handleDockClick(
      () => !settings?.onboardingComplete,
      () => appInstance["openOnboardingWindow"].call(appInstance),
      () => appInstance["dictationWindowService"].showDictationWindow()
    );
  } catch (e) {
    console.error("Failed to handle dock activate:", e);
  }
});
