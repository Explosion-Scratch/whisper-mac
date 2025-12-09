import { app, BrowserWindow, dialog } from "electron";
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
  PushToTalkManager,
  ipcStateBridge,
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
  private pushToTalkManager: PushToTalkManager | null = null;

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

    // ConfigurableActionsService is now stateless regarding segments, no setSegmentManager needed
  }

  private initializeManagers(): void {
    // ... (existing implementation)
    this.appStateManager = new AppStateManager();
    this.windowManager = new WindowManager();
    this.shortcutManager = new ShortcutManager();
    this.errorManager = new ErrorManager();
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

    this.pushToTalkManager = new PushToTalkManager(
      this.dictationFlowManager,
      this.transcriptionPluginManager,
      this.settingsManager,
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
    this.segmentManager.on("actions-detected", async (actionMatches) => {
      if (!this.configurableActionsService) {
        return;
      }

      // This event is mostly for non-segment actions now, as segment actions are handled synchronously inside SegmentManager
      const actions = this.configurableActionsService.getActions();

      for (const actionMatch of actionMatches) {
        // Execute handlers that aren't segment modifiers (like open app)
        // Pass empty segments array as we don't want to modify segments here
        const result = this.configurableActionsService.executeActions(
            [], 
            [actionMatch]
        );
        
        // Re-queue any returned handlers if necessary, although usually non-segment actions won't return queued handlers
        // In a more complex scenario, we might need to pass these back to SegmentManager, but typically OpenApp etc don't queue segment actions.

        const action = actions.find((a) => a.id === actionMatch.actionId);

        if (action?.closesTranscription) {
          console.log(
            `[Main] Action ${action.id} closes transcription, stopping dictation`,
          );
          await this.dictationFlowManager.stopDictation();
          break;
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

    this.segmentManager.on(
      "transformed",
      (result: { transformedText: string }) => {
        if (result.transformedText) {
          this.shortcutManager.setLastTransformedResult(result.transformedText);
        }
      },
    );

    this.segmentManager.on(
      "raw",
      (result: { rawText: string }) => {
        if (result.rawText) {
          this.shortcutManager.setLastRawResult(result.rawText);
        }
      },
    );
  }

  async initialize(): Promise<void> {
    await app.whenReady();
    console.log("App is ready");
    
    await this.initializeLaunchAtLogin();

    this.createTrayService();
    if (this.trayService) {
      this.appStateManager.setTrayService(this.trayService);
    }

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

  // ... (rest of methods remain the same)
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
  
      this.cleanupManager = new CleanupManager(
        this.transcriptionPluginManager,
        this.dictationWindowService,
        this.settingsService,
        this.trayService,
        this.windowManager,
      );
      this.dictationFlowManager.setTrayService(this.trayService);
      this.shortcutManager.setDictationFlowManager(this.dictationFlowManager);
      this.cleanupManager.setPushToTalkManager(this.pushToTalkManager);
    }
  
    private handleTrayClick(): void {
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
        
        if (currentSettings.launchAtLogin !== undefined) {
          await loginItemService.setLaunchAtLogin(currentSettings.launchAtLogin);
        }
  
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
      ipcStateBridge.initialize();
      this.trayInteractionManager.hideDockAfterOnboarding();
      this.setupErrorManagerCallback();
      this.checkPermissionsOnLaunch();
      this.pushToTalkManager?.initialize();
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
        onInjectRawLastResult: () => this.shortcutManager.injectRawLastResult(),
        onCyclePlugin: () => this.shortcutManager.cycleToNextPlugin(),
        onQuitApp: () => this.shortcutManager.quitApp(),
      };
  
      this.shortcutManager.registerShortcuts(hotkeySettings, actions);
  
      this.settingsManager.on("setting-changed", (key: string, value: any) => {
        if (key.startsWith("hotkeys.")) {
          console.log(`Hotkey setting changed: ${key} = ${value}`);
          this.registerHotkeys();
  
          if (this.trayService && key === "hotkeys.startStopDictation") {
            this.trayService.refreshTrayMenu();
          }
        }
      });
    }
  
    private handleOnboardingComplete(): void {
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
  
        if (this.config.showDictationWindowAlways) {
          console.log(
            "Always-show-window enabled: flushing segments and continuing recording",
          );
          await this.dictationFlowManager.flushSegmentsWhileContinuing({
            skipTransformation: options.skipTransformation,
          });
          return;
        }

        console.log("Immediately stopping audio recording...");
        this.dictationWindowService.stopRecording();
  
        console.log("Finishing current dictation (waiting for completion)...");
        await this.dictationFlowManager.finishCurrentDictation({
          skipTransformation: options.skipTransformation,
        });
      } else {
        console.log("Starting dictation...");
        
        if (options.skipTransformation) {
          const { appStore } = require("./core/AppStore");
          appStore.setState({
            dictation: { ...appStore.getState().dictation, pendingSkipTransformation: true },
          });
          console.log("Paste raw dictation: will skip transformation when finished");
        }
        
        await this.dictationFlowManager.startDictation();
      }
    }
  
    public handleDockClick(): void {
      if (this.trayInteractionManager) {
        this.trayInteractionManager.handleDockClick();
      }
    }
  
    async cleanup(): Promise<void> {
      console.log("=== WhisperMacApp cleanup starting ===");
  
      try {
        const finishingTimeout =
          this.dictationFlowManager.setFinishingTimeout(null);
        this.cleanupManager.setFinishingTimeout(finishingTimeout);
  
        console.log("Cleaning up IPC handlers...");
        this.ipcHandlerManager.cleanupIpcHandlers();
  
        console.log("Starting comprehensive cleanup...");
        await this.cleanupManager.cleanup();
        await this.transcriptionPluginManager.cleanup();
  
        console.log("=== WhisperMacApp cleanup completed ===");
      } catch (error) {
        console.error("Error during WhisperMacApp cleanup:", error);
      }
    }
  
    async showError(payload: any): Promise<void> {
      await this.errorManager.showError(payload);
    }
  
    private async checkPermissionsOnLaunch(): Promise<void> {
      try {
        const settings = this.settingsService.getCurrentSettings();
        if (!settings?.onboardingComplete) {
          return;
        }
  
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
      try {
        const permissionsManager = this.settingsService.getPermissionsManager();
        const permissions = await permissionsManager.getAllPermissionsQuiet();
        const missingPermissions: string[] = [];
  
        if (!permissions.accessibility.granted) {
          missingPermissions.push("Accessibility");
        }
  
        if (!permissions.microphone.granted) {
          try {
            const microphoneStatus =
              await permissionsManager.ensureMicrophonePermissions();
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
      } catch (error) {
        console.error("Failed to check permissions on launch (delayed):", error);
      }
    }
  
    private async showPermissionsAlert(missingPermissions: string[]): Promise<void> {
      const permissionList = missingPermissions.join(" and ");
      const message = `WhisperMac needs ${permissionList} permission${missingPermissions.length > 1 ? 's' : ''} to work properly.`;
      const detail = `${permissionList} permission${missingPermissions.length > 1 ? 's are' : ' is'} required for full functionality.\n\nClick "Open Settings" to grant the necessary permissions.`;
  
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Permissions Required',
        message: 'Permissions Required',
        detail: detail,
        buttons: ['Open Settings', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
  
      if (response === 0) {
        this.settingsService.openSettingsWindow("permissions");
      }
    }
}

const appInstance = new WhisperMacApp();
appInstance.initialize();
// ... (rest of event handlers)
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
