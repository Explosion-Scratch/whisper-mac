import { existsSync, mkdirSync } from "fs";
import { TranscriptionPluginManager } from "../plugins";
import { TextInjectionService } from "../services/TextInjectionService";
import { DictationWindowService } from "../services/DictationWindowService";
import { SettingsService } from "../services/SettingsService";
import { AppConfig } from "../config/AppConfig";
import { AppStateManager } from "./AppStateManager";
import { WindowManager } from "./WindowManager";
import { ErrorManager } from "./ErrorManager";
import { IpcHandlerManager } from "./IpcHandlerManager";

export class InitializationManager {
  constructor(
    private config: AppConfig,
    private settingsService: SettingsService,
    private transcriptionPluginManager: TranscriptionPluginManager,
    private textInjector: TextInjectionService,
    private dictationWindowService: DictationWindowService,
    private appStateManager: AppStateManager,
    private windowManager: WindowManager,
    private errorManager: ErrorManager,
    private ipcHandlerManager: IpcHandlerManager,
    private onInitializationComplete: () => void,
    private onOnboardingComplete?: () => void,
  ) { }

  async initialize(): Promise<void> {
    await this.setupDataDirectories();

    const settings = this.settingsService.getCurrentSettings();
    const isFirstRun = !settings?.onboardingComplete;

    if (isFirstRun) {
      await this.handleFirstRun();
      return;
    }

    await this.handleRegularInitialization();
  }

  async initializeAfterOnboarding(): Promise<void> {
    this.appStateManager.setSetupStatus("preparing-app");
    await this.setupDataDirectories();
    await this.handleRegularInitialization();
  }

  setOnboardingCompleteCallback(callback: () => void): void {
    this.onOnboardingComplete = callback;
  }

  private async setupDataDirectories(): Promise<void> {
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!existsSync(this.config.getCacheDir())) {
      mkdirSync(this.config.getCacheDir(), { recursive: true });
    }
    if (!existsSync(this.config.getModelsDir())) {
      mkdirSync(this.config.getModelsDir(), { recursive: true });
    }
  }

  private async handleFirstRun(): Promise<void> {
    // Setup IPC handlers before opening any windows so they're available when windows load
    this.ipcHandlerManager.setupIpcHandlers();
    this.ipcHandlerManager.setupOnboardingIpc();
    this.windowManager.openOnboardingWindow();
    this.appStateManager.setSetupStatus("preparing-app");

    // Don't call onOnboardingComplete here - it should only be called when onboarding actually completes
    // The onboarding completion will be handled by the IPC handler
  }

  private async handleRegularInitialization(): Promise<void> {
    console.log("Starting parallel initialization tasks...");

    // Setup IPC handlers first before preloading any windows
    this.ipcHandlerManager.setupIpcHandlers();

    const initTasks = [
      this.checkAccessibilityPermissions(),
      this.preloadWindows(),
      this.initializePlugins(),
    ];

    await Promise.allSettled(initTasks);

    this.setupPluginErrorHandling();
    
    try {
      this.onInitializationComplete();
    } catch (error) {
      console.error("Error during initialization completion:", error);
      // Show non-blocking error but allow app to proceed
      this.errorManager.showError({
        title: "Initialization Warning",
        description: error instanceof Error ? error.message : String(error),
        actions: ["ok"]
      });
    } finally {
      // Always transition to idle state so the app is usable even if some non-critical init parts failed
      this.appStateManager.setSetupStatus("idle");
      console.log("Initialization completed (state set to idle)");
    }
  }

  private async checkAccessibilityPermissions(): Promise<void> {
    try {
      await this.textInjector.checkAccessibilityPermissions();
      console.log("Accessibility permissions checked");
    } catch (error) {
      console.error("Failed to check accessibility permissions:", error);
    }
  }

  private async preloadWindows(): Promise<void> {
    try {
      console.log("Pre-loading windows for faster startup...");
      this.appStateManager.setSetupStatus("loading-windows");
      await Promise.allSettled([this.dictationWindowService.preloadWindow()]);
      console.log("Windows pre-loaded successfully");
    } catch (error) {
      console.error("Failed to pre-load windows:", error);
      await this.errorManager.showError({
        title: "Failed to prepare UI",
        description: error instanceof Error ? error.message : "Unknown error",
        actions: ["ok"],
      });
    }
  }

  private async initializePlugins(): Promise<void> {
    this.appStateManager.setSetupStatus("initializing-plugins");
    try {
      await this.transcriptionPluginManager.initializePlugins();
      console.log("Transcription plugins initialized");
    } catch (error) {
      console.error("Failed to initialize transcription plugins:", error);
    }
    this.appStateManager.setSetupStatus("service-ready");
    console.log("Transcription plugin system ready");
  }

  private setupPluginErrorHandling(): void {
    this.transcriptionPluginManager.on("plugin-error", ({ plugin, error }) => {
      console.error(`Transcription plugin ${plugin} error:`, error);
      this.errorManager.showError({
        title: "Transcription error",
        description:
          error && (error.message || error.toString())
            ? error.message || error.toString()
            : "Transcription plugin failed",
        actions: ["ok"],
      });
    });
  }
}
