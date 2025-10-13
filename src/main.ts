import { app, BrowserWindow } from "electron";
import log from "electron-log/main";

import {
  TranscriptionPluginManager,
  createTranscriptionPluginManager,
} from "./plugins";
import { TextInjectionService } from "./services/TextInjectionService";
import { NotificationService } from "./services/NotificationService";
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
import { LoginItemService } from "./services/LoginItemService";
import { DefaultActionsConfig } from "./types/ActionTypes";

import {
  AppStateManager,
  WindowManager,
  ShortcutManager,
  ShortcutActions,
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
  private notificationService!: NotificationService;
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
    log.initialize();
    Object.assign(console, log.functions);
    log.transports.ipc.level = "info";
    log.transports.file.level = "info";
    log.transports.console.level = "info";
    this.initializeServices();
    this.setupPermissionsDependencies();
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
      this.modelManager,
    );
    this.transcriptionPluginManager = createTranscriptionPluginManager(
      this.config,
    );
    this.notificationService = new NotificationService();
    this.textInjector = new TextInjectionService(this.notificationService);
    this.transformationService = new TransformationService(this.config);
    this.selectedTextService = new SelectedTextService();
    this.dictationWindowService = new DictationWindowService(this.config);
    this.configurableActionsService = new ConfigurableActionsService();
    this.segmentManager = new SegmentManager(
      this.transformationService,
      this.textInjector,
      this.selectedTextService,
      this.configurableActionsService,
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
      this.errorManager,
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
      this.settingsService.getPermissionsManager(),
      () => this.dictationFlowManager.startDictation(),
      () => this.dictationFlowManager.stopDictation(),
      () => this.dictationFlowManager.finishCurrentDictation(),
      () => this.dictationFlowManager.cancelDictationFlow(),
      () => this.handleOnboardingComplete(),
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
      () => this.handleOnboardingComplete(),
    );
  }

  private setupPermissionsDependencies(): void {
    this.settingsService.setPermissionsDependencies(this.textInjector);
  }

  private setupServiceConnections(): void {
    this.settingsService.setTranscriptionPluginManager(
      this.transcriptionPluginManager,
    );
    this.unifiedModelDownloadService.setTranscriptionPluginManager(
      this.transcriptionPluginManager,
    );
    this.settingsService.setUnifiedModelDownloadService(
      this.unifiedModelDownloadService,
    );
    this.shortcutManager.setTranscriptionPluginManager(
      this.transcriptionPluginManager,
    );
    this.shortcutManager.setDictationFlowManager(this.dictationFlowManager);
    this.shortcutManager.setSettingsManager(this.settingsManager);
  }

  private setupEventListeners(): void {
    this.segmentManager.on("action-detected", async (actionMatch) => {
      console.log(
        `[Main] Action detected via segment manager: "${actionMatch.actionId
        }" with argument: "${actionMatch.extractedArgument || "none"}"`,
      );

      if (this.configurableActionsService) {
        await this.configurableActionsService.executeAction(actionMatch);

        // Find the action to check if it should close transcription
        const actions = this.configurableActionsService.getActions();
        const action = actions.find((a) => a.id === actionMatch.actionId);

        if (action?.closesTranscription) {
          console.log(
            `[Main] Action ${action.id} closes transcription, stopping dictation`,
          );
          await this.dictationFlowManager.stopDictation();
        } else {
          console.log(
            `[Main] Action ${action?.id || actionMatch.actionId
            } continues transcription`,
          );
        }
      }
    });

    this.settingsManager.on(
      "actions-updated",
      (actionsConfig: DefaultActionsConfig) => {
        if (this.configurableActionsService && actionsConfig?.actions) {
          this.configurableActionsService.setActions(actionsConfig.actions);
        }
      },
    );

    const actionsConfig = this.settingsManager.get(
      "actions",
    ) as DefaultActionsConfig;
    if (this.configurableActionsService && actionsConfig?.actions) {
      this.configurableActionsService.setActions(actionsConfig.actions);
    }

    // Track last transformed result for hotkey injection
    this.segmentManager.on(
      "transformed",
      (result: { transformedText: string }) => {
        if (result.transformedText) {
          this.shortcutManager.setLastTransformedResult(result.transformedText);
        }
      },
    );
  }

  async initialize(): Promise<void> {
    await app.whenReady();
    console.log("App is ready");

    // Initialize launch at login setting
    await this.initializeLaunchAtLogin();

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
      () => this.toggleRecording(),
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
      this.transcriptionPluginManager,
      this.notificationService,
      this.settingsManager,
    );
    this.trayService.createTray();

    // Initialize cleanupManager after trayService is created
    this.cleanupManager = new CleanupManager(
      this.transcriptionPluginManager,
      this.dictationWindowService,
      this.settingsService,
      this.trayService,
      this.windowManager,
    );
    this.dictationFlowManager.setTrayService(this.trayService);
    this.shortcutManager.setDictationFlowManager(this.dictationFlowManager);
  }

  private handleTrayClick(): void {
    // This will be called by the tray service, delegate to trayInteractionManager if available
    if (this.trayInteractionManager) {
      this.trayInteractionManager.handleTrayClick();
    } else {
      this.toggleRecording();
    }
  }

  private async initializeLaunchAtLogin(): Promise<void> {
    try {
      const loginItemService = LoginItemService.getInstance();
      const currentSettings = this.settingsManager.getAll();
      
      // Apply the saved launch at login setting
      if (currentSettings.launchAtLogin !== undefined) {
        await loginItemService.setLaunchAtLogin(currentSettings.launchAtLogin);
        console.log(`Launch at login initialized to: ${currentSettings.launchAtLogin}`);
      }

      // Log if we were launched at login
      if (loginItemService.wasOpenedAtLogin()) {
        console.log("App was launched at login");
      }
    } catch (error) {
      console.error("Failed to initialize launch at login:", error);
    }
  }

  private onInitializationComplete(): void {
    this.registerHotkeys();
    this.ipcHandlerManager.setupIpcHandlers();
    this.trayInteractionManager.hideDockAfterOnboarding();
    this.setupErrorManagerCallback();
    this.checkPermissionsOnLaunch();
  }

  private setupErrorManagerCallback(): void {
    this.errorManager.setSettingsCallback(() => {
      this.settingsService.openSettingsWindow("permissions");
    });
  }

  private registerHotkeys(): void {
    const hotkeySettings =
      (this.settingsManager.get("hotkeys") as Record<string, string>) || {};

    const actions: ShortcutActions = {
      onToggleRecording: () => this.handleShortcutPress(),
      onFinishDictationRaw: () => this.handleShortcutPress({ skipTransformation: true }),
      onCancelDictation: () => this.shortcutManager.cancelDictation(),
      onInjectLastResult: () => this.shortcutManager.injectLastResult(),
      onCyclePlugin: () => this.shortcutManager.cycleToNextPlugin(),
      onQuitApp: () => this.shortcutManager.quitApp(),
    };

    this.shortcutManager.registerShortcuts(hotkeySettings, actions);

    // Listen for hotkey setting changes and re-register shortcuts
    this.settingsManager.on("setting-changed", (key: string, value: any) => {
      if (key.startsWith("hotkeys.")) {
        console.log(`Hotkey setting changed: ${key} = ${value}`);
        this.registerHotkeys();

        // Update tray menu to show new hotkey
        if (this.trayService && key === "hotkeys.startStopDictation") {
          this.trayService.refreshTrayMenu();
        }
      }
    });
  }

  private handleOnboardingComplete(): void {
    // Close onboarding window and continue with regular initialization
    this.windowManager.closeOnboardingWindow();
    this.initializationManager.initializeAfterOnboarding();
  }

  private handleShortcutPress(options?: { skipTransformation?: boolean }): void {
    if (!this.appStateManager.isIdle()) {
      this.trayInteractionManager.setPendingToggle(true);
      console.log("App not idle yet; deferring toggle until ready");
      return;
    }
    this.toggleRecording(options);
  }

  private async toggleRecording(options: { skipTransformation?: boolean } = {}): Promise<void> {
    console.log("=== Toggle dictation called ===");
    console.log(
      "Current recording state:",
      this.dictationFlowManager.isRecording(),
    );
    console.log(
      "Current finishing state:",
      this.dictationFlowManager.isFinishing(),
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
          "Always-show-window enabled: flushing segments and continuing recording",
        );
        await this.dictationFlowManager.flushSegmentsWhileContinuing({
          skipTransformation: options.skipTransformation,
        });
        return;
      }

      console.log("Finishing current dictation (waiting for completion)...");
      await this.dictationFlowManager.finishCurrentDictation({
        skipTransformation: options.skipTransformation,
      });
    } else {
      console.log("Starting dictation...");
      await this.dictationFlowManager.startDictation();
    }
  }

  public handleDockClick(): void {
    this.trayInteractionManager.handleDockClick();
  }

  async cleanup(): Promise<void> {
    console.log("=== WhisperMacApp cleanup starting ===");

    try {
      // Cancel any finishing timeout from dictation flow
      const finishingTimeout =
        this.dictationFlowManager.setFinishingTimeout(null);
      this.cleanupManager.setFinishingTimeout(finishingTimeout);

      // Clean up IPC handlers first to prevent new requests
      console.log("Cleaning up IPC handlers...");
      this.ipcHandlerManager.cleanupIpcHandlers();

      // Then perform comprehensive cleanup
      console.log("Starting comprehensive cleanup...");
      await this.cleanupManager.cleanup();
      await this.transcriptionPluginManager.cleanup();

      console.log("=== WhisperMacApp cleanup completed ===");
    } catch (error) {
      console.error("Error during WhisperMacApp cleanup:", error);
      // Don't re-throw - we want the app to quit even if cleanup fails
    }
  }

  async showError(payload: any): Promise<void> {
    await this.errorManager.showError(payload);
  }

  private async checkPermissionsOnLaunch(): Promise<void> {
    try {
      // Don't check permissions if onboarding isn't complete
      const settings = this.settingsService.getCurrentSettings();
      if (!settings?.onboardingComplete) {
        return;
      }

      // Add delay to ensure all services are initialized
      setTimeout(() => {
        this.checkPermissionsOnLaunchDelayed().catch(error => {
          console.error("Failed to check permissions on launch:", error);
        });
      }, 500);
    } catch (error) {
      console.error("Failed to check permissions on launch:", error);
    }
  }

  private async checkPermissionsOnLaunchDelayed(): Promise<void> {
    // Type-safe access to permissions manager
    if (!this.settingsService || typeof (this.settingsService as any).permissionsManager === 'undefined') {
      console.log("Permissions manager not available, skipping launch check");
      return;
    }

    const permissionsManager = (this.settingsService as any).permissionsManager;
    const permissions = await permissionsManager.getAllPermissionsQuiet();
    const missingPermissions: string[] = [];

    if (!permissions.accessibility.granted) {
      missingPermissions.push("Accessibility");
    }

    // For microphone permissions, if status is "not-determined", try to request them properly
    if (!permissions.microphone.granted) {
      try {
        const microphoneStatus = await permissionsManager.ensureMicrophonePermissions();
        if (!microphoneStatus.granted) {
          missingPermissions.push("Microphone");
        }
      } catch (error) {
        console.error("Error ensuring microphone permissions:", error);
        missingPermissions.push("Microphone");
      }
    }

    if (missingPermissions.length > 0) {
      await this.showPermissionsAlert(missingPermissions);
    }
  }

  private async showPermissionsAlert(missingPermissions: string[]): Promise<void> {
    const permissionList = missingPermissions.join(" and ");
    const message = `WhisperMac needs ${permissionList} permission${missingPermissions.length > 1 ? 's' : ''} to work properly.

${permissionList} permission${missingPermissions.length > 1 ? 's are' : ' is'} required for full functionality.

Click "Open Settings" to grant the necessary permissions.`;

    await this.errorManager.showError({
      title: "Permissions Required",
      description: message,
      actions: ["settings", "later"],
    });
  }
}

const appInstance = new WhisperMacApp();
appInstance.initialize();

let isQuitting = false;

app.on("before-quit", async (event: Electron.Event) => {
  console.log("App quit requested");

  if (!isQuitting) {
    console.log("Starting app cleanup process...");
    event.preventDefault();
    isQuitting = true;

    try {
      await appInstance.cleanup();
      console.log("Cleanup completed, quitting app...");
      app.quit();
    } catch (error) {
      console.error("Error during cleanup:", error);
      setTimeout(() => {
        console.log("Force quitting due to cleanup error...");
        process.exit(1);
      }, 2000);
    }
  }
});

app.on("will-quit", () => {
  console.log("App will quit now");
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT, forcing app quit...");
  if (!isQuitting) {
    isQuitting = true;
    try {
      await appInstance.cleanup();
    } catch (error) {
      console.error("Error during SIGINT cleanup:", error);
    }
    process.exit(0);
  }
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, forcing app quit...");
  if (!isQuitting) {
    isQuitting = true;
    try {
      await appInstance.cleanup();
    } catch (error) {
      console.error("Error during SIGTERM cleanup:", error);
    }
    process.exit(0);
  }
});

app.on("window-all-closed", (event: Electron.Event) => {
  // For menu bar apps, we usually prevent quit when all windows close
  // But allow quit if the user explicitly requested it
  if (!isQuitting) {
    event.preventDefault();
    console.log("All windows closed, but keeping app running (menu bar app)");
  }
});

app.on("activate", () => {
  try {
    appInstance.handleDockClick();
  } catch (e) {
    console.error("Failed to handle dock activate:", e);
  }
});
