import { globalShortcut, app } from "electron";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { DictationFlowManager } from "./DictationFlowManager";
import { SettingsManager } from "../config/SettingsManager";
import { HistoryService } from "../services/HistoryService";

export interface ShortcutActions {
  onToggleRecording: () => void;
  onFinishDictationRaw: () => void;
  onCancelDictation: () => void;
  onInjectLastResult: () => void;
  onInjectRawLastResult: () => void;
  onCyclePlugin: () => void;
  onQuitApp: () => void;
}

export class ShortcutManager {
  private registeredShortcuts: string[] = [];
  private transcriptionPluginManager: TranscriptionPluginManager | null = null;
  private dictationFlowManager: DictationFlowManager | null = null;
  private settingsManager: SettingsManager | null = null;
  private historyService: HistoryService | null = null;

  setTranscriptionPluginManager(manager: TranscriptionPluginManager): void {
    this.transcriptionPluginManager = manager;
  }

  setDictationFlowManager(manager: DictationFlowManager): void {
    this.dictationFlowManager = manager;
  }

  setSettingsManager(manager: SettingsManager): void {
    this.settingsManager = manager;
  }

  setHistoryService(service: HistoryService): void {
    this.historyService = service;
  }

  private registerDebounceTimeout: NodeJS.Timeout | null = null;
  private static REGISTER_DEBOUNCE_MS = 100;
  private static MAX_REGISTER_RETRIES = 3;

  registerShortcuts(
    hotkeys: Record<string, string>,
    actions: ShortcutActions,
  ): void {
    if (this.registerDebounceTimeout) {
      clearTimeout(this.registerDebounceTimeout);
    }

    this.registerDebounceTimeout = setTimeout(() => {
      this.registerDebounceTimeout = null;
      this.doRegisterShortcuts(hotkeys, actions);
    }, ShortcutManager.REGISTER_DEBOUNCE_MS);
  }

  private doRegisterShortcuts(
    hotkeys: Record<string, string>,
    actions: ShortcutActions,
  ): void {
    this.unregisterAll();

    const shortcuts = [
      {
        key: hotkeys.startStopDictation || "Control+D",
        handler: actions.onToggleRecording,
        description: "Start/Stop Dictation",
      },
      {
        key: hotkeys.pasteRawDictation || "Control+Shift+D",
        handler: actions.onFinishDictationRaw,
        description: "Paste Raw Dictation",
      },
      {
        key: hotkeys.cancelDictation,
        handler: actions.onCancelDictation,
        description: "Cancel Dictation",
      },
      {
        key: hotkeys.injectLastResult,
        handler: actions.onInjectLastResult,
        description: "Inject Last Result",
      },
      {
        key: hotkeys.injectRawLastResult,
        handler: actions.onInjectRawLastResult,
        description: "Inject Raw Last Result",
      },
      {
        key: hotkeys.cyclePlugin,
        handler: actions.onCyclePlugin,
        description: "Cycle Plugin",
      },
      {
        key: hotkeys.quitApp,
        handler: actions.onQuitApp,
        description: "Quit App",
      },
    ];

    shortcuts.forEach(({ key, handler, description }) => {
      if (!key || key.trim() === "") {
        console.log(`Skipping empty shortcut for ${description}`);
        return;
      }

      const success = this.registerWithRetry(key, handler, description);
      if (success) {
        this.registeredShortcuts.push(key);
      }
    });
  }

  private registerWithRetry(
    key: string,
    handler: () => void,
    description: string,
    retryCount = 0,
  ): boolean {
    if (globalShortcut.isRegistered(key)) {
      console.log(`Shortcut ${key} already registered, unregistering first`);
      globalShortcut.unregister(key);
    }

    const success = globalShortcut.register(key, () => {
      console.log(`${key} is pressed (${description})`);
      try {
        handler();
      } catch (error) {
        console.error(`Error executing shortcut ${key}:`, error);
      }
    });

    if (success) {
      console.log(`Registered shortcut: ${key} (${description})`);
      return true;
    }

    if (retryCount < ShortcutManager.MAX_REGISTER_RETRIES) {
      console.warn(
        `Failed to register ${key}, retrying (${retryCount + 1}/${ShortcutManager.MAX_REGISTER_RETRIES})...`,
      );
      return this.registerWithRetry(key, handler, description, retryCount + 1);
    }

    console.error(
      `Failed to register ${key} shortcut after ${ShortcutManager.MAX_REGISTER_RETRIES} retries (${description})`,
    );
    return false;
  }

  async cycleToNextPlugin(): Promise<void> {
    if (!this.transcriptionPluginManager) {
      console.error("No transcription plugin manager available for cycling");
      return;
    }

    try {
      const plugins = this.transcriptionPluginManager.getPlugins();
      const activePlugin = this.transcriptionPluginManager.getActivePlugin();

      if (plugins.length <= 1) {
        console.log("Only one plugin available, cannot cycle");
        return;
      }

      const pluginNames = plugins.map((p) => p.name);
      const currentIndex = activePlugin
        ? pluginNames.indexOf(activePlugin.name)
        : -1;
      const nextIndex = (currentIndex + 1) % pluginNames.length;
      const nextPluginName = pluginNames[nextIndex];

      console.log(
        `Cycling from ${activePlugin?.name || "none"} to ${nextPluginName}`,
      );

      await this.transcriptionPluginManager.setActivePlugin(nextPluginName);
      console.log(`Successfully cycled to plugin: ${nextPluginName}`);
    } catch (error) {
      console.error("Failed to cycle plugin:", error);
      // Continue cycling even if activation fails
      const plugins = this.transcriptionPluginManager.getPlugins();
      const activePlugin = this.transcriptionPluginManager.getActivePlugin();
      const pluginNames = plugins.map((p) => p.name);
      const currentIndex = activePlugin
        ? pluginNames.indexOf(activePlugin.name)
        : -1;
      const nextIndex = (currentIndex + 1) % pluginNames.length;

      console.log(
        `Plugin activation failed, but will try next plugin on subsequent cycle`,
      );
    }
  }

  async injectLastResult(): Promise<void> {
    if (!this.historyService) {
      console.log("No history service available");
      return;
    }

    const latestRecording = this.historyService.getLatestRecording();
    const lastTransformedResult = latestRecording
      ? latestRecording.transformedTranscription ||
        latestRecording.rawTranscription
      : null;

    if (!lastTransformedResult) {
      console.log("No last result available to inject");

      try {
        const { NotificationService } =
          await import("../services/NotificationService");
        const notificationService = new NotificationService();
        await notificationService.sendNotification({
          title: "No Last Result",
          message:
            "No previous transcription result available to inject. Try dictating some text first.",
        });
      } catch (error) {
        console.error("Failed to show notification:", error);
      }
      return;
    }

    try {
      const { TextInjectionService } =
        await import("../services/TextInjectionService");
      const injectionService = new TextInjectionService();
      await injectionService.insertText(lastTransformedResult);
      console.log(`Injected last result: "${lastTransformedResult}"`);
    } catch (error) {
      console.error("Failed to inject last result:", error);
    }
  }

  async injectRawLastResult(): Promise<void> {
    if (!this.historyService) {
      console.log("No history service available");
      return;
    }

    const latestRecording = this.historyService.getLatestRecording();
    const lastRawResult = latestRecording
      ? latestRecording.rawTranscription
      : null;

    if (!lastRawResult) {
      console.log("No last raw result available to inject");

      try {
        const { NotificationService } =
          await import("../services/NotificationService");
        const notificationService = new NotificationService();
        await notificationService.sendNotification({
          title: "No Raw Last Result",
          message:
            "No previous raw transcription result available to inject. Try dictating some text first.",
        });
      } catch (error) {
        console.error("Failed to show notification:", error);
      }
      return;
    }

    try {
      const { TextInjectionService } =
        await import("../services/TextInjectionService");
      const injectionService = new TextInjectionService();
      await injectionService.insertText(lastRawResult);
      console.log(`Injected last raw result: "${lastRawResult}"`);
    } catch (error) {
      console.error("Failed to inject last raw result:", error);
    }
  }

  async cancelDictation(): Promise<void> {
    if (!this.dictationFlowManager) {
      console.error("No dictation flow manager available for cancellation");
      return;
    }

    try {
      await this.dictationFlowManager.cancelDictationFlow();
      console.log("Dictation cancelled via shortcut");
    } catch (error) {
      console.error("Failed to cancel dictation:", error);
    }
  }

  quitApp(): void {
    console.log("Quitting app via shortcut");
    // Use app.quit() which will trigger the before-quit event
    // and our proper cleanup sequence in main.ts
    app.quit();
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registeredShortcuts = [];
    console.log("All shortcuts unregistered");
  }

  isRegistered(shortcut: string): boolean {
    return globalShortcut.isRegistered(shortcut);
  }

  getRegisteredShortcuts(): string[] {
    return [...this.registeredShortcuts];
  }

  cleanup(): void {
    console.log("Cleaning up ShortcutManager...");
    this.unregisterAll();
  }
}
