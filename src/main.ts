import { app, BrowserWindow } from "electron";

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
import { SegmentManager } from "./services/SegmentManager";
import { UnifiedModelDownloadService } from "./services/UnifiedModelDownloadService";
import { TrayService } from "./services/TrayService";
import { DefaultActionsConfig } from "./types/ActionTypes";

import {
  AppStateManager,
  WindowManager,
  ShortcutManager,
  ErrorManager,
  CleanupManager,
  DictationFlowManager,
  IpcHandlerManager,
  InitializationManager,
  TrayInteractionManager,
} from "./core";

class WhisperMacApp {
  private config!: AppConfig;
  private settingsService!: SettingsService;
  private modelManager!: ModelManager;
  private unifiedModelDownloadService!: UnifiedModelDownloadService;
  private transcriptionPluginManager!: TranscriptionPluginManager;
  private textInjector!: TextInjectionService;
  private transformationService!: TransformationService;
  private selectedTextService!: SelectedTextService;
  private dictationWindowService!: DictationWindowService;
  private configurableActionsService!: ConfigurableActionsService;
  private segmentManager!: SegmentManager;
  private settingsManager!: SettingsManager;
  private trayService: TrayService | null = null;

  private appStateManager!: AppStateManager;
  private windowManager!: WindowManager;
  private shortcutManager!: ShortcutManager;
  private errorManager!: ErrorManager;
  private cleanupManager!: CleanupManager;
  private dictationFlowManager!: DictationFlowManager;
  private ipcHandlerManager!: IpcHandlerManager;
  private initializationManager!: InitializationManager;
  private trayInteractionManager!: TrayInteractionManager;

  private readonly trayIconIdleRelPath = "../assets/icon-template.png";
  private readonly trayIconRecordingRelPath = "../assets/icon-recording.png";
  private readonly dockIconRelPath = "../assets/icon.png";

  constructor() {
    this.initializeServices();
    this.initializeManagers();
    this.setupServiceConnections();
    this.setupEventListeners();
  }

  private initializeServices(): void {
    this.config = new AppConfig();
    this.settingsService = new SettingsService(this.config);
    this.modelManager = new ModelManager(this.config);
    this.unifiedModelDownloadService = new UnifiedModelDownloadService(
      this.config,
      this.modelManager
    );
    this.transcriptionPluginManager = createTranscriptionPluginManager(
      this.config
    );
    this.textInjector = new TextInjectionService();
    this.transformationService = new TransformationService(this.config);
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);
    this.configurableActionsService = new ConfigurableActionsService();
    this.segmentManager = new SegmentManager(
      this.transformationService,
      this.textInjector,
      this.selectedTextService,
      this.configurableActionsService
    );
    this.settingsManager = new SettingsManager(this.config);

    // Set circular reference so ConfigurableActionsService can access SegmentManager
    this.configurableActionsService.setSegmentManager(this.segmentManager);
  }

  private initializeManagers(): void {
    this.appStateManager = new AppStateManager();
    this.windowManager = new WindowManager();
    this.shortcutManager = new ShortcutManager();
    this.errorManager = new ErrorManager();
    // Note: cleanupManager will be initialized after trayService is created
    this.dictationFlowManager = new DictationFlowManager(
      this.transcriptionPluginManager,
      this.dictationWindowService,
      this.segmentManager,
      this.trayService,
      this.errorManager
    );
    this.ipcHandlerManager = new IpcHandlerManager(
      this.transcriptionPluginManager,
      this.unifiedModelDownloadService,
      this.textInjector,
      this.settingsService,
      this.config,
      this.settingsManager,
      this.errorManager,
      this.appStateManager,
      () => this.dictationFlowManager.startDictation(),
      () => this.dictationFlowManager.stopDictation(),
      () => this.dictationFlowManager.cancelDictationFlow(),
      () => this.handleOnboardingComplete()
    );
    this.initializationManager = new InitializationManager(
      this.config,
      this.settingsService,
      this.transcriptionPluginManager,
      this.textInjector,
      this.dictationWindowService,
      this.appStateManager,
      this.windowManager,
      this.errorManager,
      this.ipcHandlerManager,
      () => this.onInitializationComplete(),
      () => this.handleOnboardingComplete()
    );
  }

  private setupServiceConnections(): void {
    this.settingsService.setTranscriptionPluginManager(
      this.transcriptionPluginManager
    );
    this.unifiedModelDownloadService.setTranscriptionPluginManager(
      this.transcriptionPluginManager
    );
    this.settingsService.setUnifiedModelDownloadService(
      this.unifiedModelDownloadService
    );

    this.dictationWindowService.on(
      "vad-audio-segment",
      (audioData: Float32Array) => {
        console.log(
          "Processing VAD audio segment:",
          audioData.length,
          "samples"
        );
        this.transcriptionPluginManager.processAudioSegment(audioData);
      }
    );
  }

  private setupEventListeners(): void {
    this.segmentManager.on("action-detected", async (actionMatch) => {
      console.log(
        `[Main] Action detected via segment manager: "${
          actionMatch.actionId
        }" with argument: "${actionMatch.extractedArgument || "none"}"`
      );

      if (this.configurableActionsService) {
        await this.configurableActionsService.executeAction(actionMatch);
      }

      await this.dictationFlowManager.stopDictation();
    });

    this.settingsManager.on(
      "actions-updated",
      (actionsConfig: DefaultActionsConfig) => {
        if (this.configurableActionsService && actionsConfig?.actions) {
          this.configurableActionsService.setActions(actionsConfig.actions);
        }
      }
    );

    const actionsConfig = this.settingsManager.get(
      "actions"
    ) as DefaultActionsConfig;
    if (this.configurableActionsService && actionsConfig?.actions) {
      this.configurableActionsService.setActions(actionsConfig.actions);
    }
  }

  async initialize(): Promise<void> {
    await app.whenReady();
    console.log("App is ready");

    this.createTrayService();
    if (this.trayService) {
      this.appStateManager.setTrayService(this.trayService);
    }

    // Create trayInteractionManager after trayService is created
    this.trayInteractionManager = new TrayInteractionManager(
      this.trayService!,
      this.settingsService,
      this.dictationWindowService,
      this.windowManager,
      this.appStateManager,
      () => this.toggleRecording()
    );

    this.trayInteractionManager.setupSettingsWindowVisibilityHandler();
    this.appStateManager.setSetupStatus("preparing-app");

    await this.initializationManager.initialize();
  }

  private createTrayService(): void {
    this.trayService = new TrayService(
      this.trayIconIdleRelPath,
      this.trayIconRecordingRelPath,
      this.dockIconRelPath,
      (s) => this.appStateManager.getStatusMessage(s),
      () => this.handleTrayClick(),
      () => this.settingsService.openSettingsWindow(),
      () => this.windowManager.openModelManagerWindow()
    );
    this.trayService.createTray();

    // Initialize cleanupManager after trayService is created
    this.cleanupManager = new CleanupManager(
      this.transcriptionPluginManager,
      this.dictationWindowService,
      this.settingsService,
      this.trayService,
      this.windowManager
    );

    // Update dictationFlowManager with trayService reference
    this.dictationFlowManager = new DictationFlowManager(
      this.transcriptionPluginManager,
      this.dictationWindowService,
      this.segmentManager,
      this.trayService,
      this.errorManager
    );
  }

  private handleTrayClick(): void {
    // This will be called by the tray service, delegate to trayInteractionManager if available
    if (this.trayInteractionManager) {
      this.trayInteractionManager.handleTrayClick();
    } else {
      this.toggleRecording();
    }
  }

  private onInitializationComplete(): void {
    this.shortcutManager.registerShortcuts(() => this.handleShortcutPress());
    this.ipcHandlerManager.setupIpcHandlers();
    this.trayInteractionManager.hideDockAfterOnboarding();
  }

  private handleOnboardingComplete(): void {
    // Close onboarding window and continue with regular initialization
    this.windowManager.closeOnboardingWindow();
    this.initializationManager.initializeAfterOnboarding();
  }

  private handleShortcutPress(): void {
    if (!this.appStateManager.isIdle()) {
      this.trayInteractionManager.setPendingToggle(true);
      console.log("App not idle yet; deferring toggle until ready");
      return;
    }
    this.toggleRecording();
  }

  private async toggleRecording(): Promise<void> {
    console.log("=== Toggle dictation called ===");
    console.log(
      "Current recording state:",
      this.dictationFlowManager.isRecording()
    );
    console.log(
      "Current finishing state:",
      this.dictationFlowManager.isFinishing()
    );

    if (this.dictationFlowManager.isRecording()) {
      if (this.dictationFlowManager.isFinishing()) {
        console.log("Already finishing dictation, ignoring toggle...");
        return;
      }

      console.log("Immediately stopping audio recording...");
      this.dictationWindowService.stopRecording();

      if (this.config.showDictationWindowAlways) {
        console.log(
          "Always-show-window enabled: flushing segments and continuing recording"
        );
        await this.dictationFlowManager.flushSegmentsWhileContinuing();
        return;
      }

      console.log("Finishing current dictation (waiting for completion)...");
      await this.dictationFlowManager.finishCurrentDictation();
    } else {
      console.log("Starting dictation...");
      await this.dictationFlowManager.startDictation();
    }
  }

  public handleDockClick(): void {
    this.trayInteractionManager.handleDockClick();
  }

  async cleanup(): Promise<void> {
    const finishingTimeout =
      this.dictationFlowManager.setFinishingTimeout(null);
    this.cleanupManager.setFinishingTimeout(finishingTimeout);
    await this.cleanupManager.cleanup();
    this.ipcHandlerManager.cleanupIpcHandlers();
  }

  async showError(payload: any): Promise<void> {
    await this.errorManager.showError(payload);
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

app.on("before-quit", (event: Electron.Event) => {
  console.log("App quit requested");
});

app.on("activate", () => {
  try {
    appInstance.handleDockClick();
  } catch (e) {
    console.error("Failed to handle dock activate:", e);
  }
});
