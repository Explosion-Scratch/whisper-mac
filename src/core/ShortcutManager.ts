import { globalShortcut, app } from "electron";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { DictationFlowManager } from "./DictationFlowManager";
import { SettingsManager } from "../config/SettingsManager";

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
  private lastTransformedResult: string | null = null;
  private lastRawResult: string | null = null;
  private settingsManager: SettingsManager | null = null;

  setTranscriptionPluginManager(manager: TranscriptionPluginManager): void {
    this.transcriptionPluginManager = manager;
  }

  setDictationFlowManager(manager: DictationFlowManager): void {
    this.dictationFlowManager = manager;
  }

  setSettingsManager(manager: SettingsManager): void {
    this.settingsManager = manager;
    this.loadLastTransformedResult();
    this.loadLastRawResult();
  }

  private loadLastTransformedResult(): void {
    if (this.settingsManager) {
      const savedResult = this.settingsManager.get("internal.lastTransformedResult");
      if (savedResult && typeof savedResult === "string") {
        this.lastTransformedResult = savedResult;
        console.log(`[ShortcutManager] Loaded last transformed result from storage: "${savedResult}"`);
      }
    }
  }

  private loadLastRawResult(): void {
    if (this.settingsManager) {
      const savedResult = this.settingsManager.get("internal.lastRawResult");
      if (savedResult && typeof savedResult === "string") {
        this.lastRawResult = savedResult;
        console.log(`[ShortcutManager] Loaded last raw result from storage: "${savedResult}"`);
      }
    }
  }

  setLastTransformedResult(result: string): void {
    this.lastTransformedResult = result;

    // Persist the result for future app sessions
    if (this.settingsManager) {
      this.settingsManager.set("internal.lastTransformedResult", result);
      this.settingsManager.saveSettings();
    }
  }

  setLastRawResult(result: string): void {
    this.lastRawResult = result;

    // Persist the result for future app sessions
    if (this.settingsManager) {
      this.settingsManager.set("internal.lastRawResult", result);
      this.settingsManager.saveSettings();
    }
  }

  registerShortcuts(
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

      const success = globalShortcut.register(key, () => {
        console.log(`${key} is pressed (${description})`);
        try {
          handler();
        } catch (error) {
          console.error(`Error executing shortcut ${key}:`, error);
        }
      });

      if (success) {
        this.registeredShortcuts.push(key);
        console.log(`Registered shortcut: ${key} (${description})`);
      } else {
        console.error(`Failed to register ${key} shortcut (${description})`);
      }
    });
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
    if (!this.lastTransformedResult) {
      console.log("No last result available to inject");

      // Show a notification to the user
      try {
        const { NotificationService } = await import("../services/NotificationService");
        const notificationService = new NotificationService();
        await notificationService.sendNotification({
          title: "No Last Result",
          message: "No previous transcription result available to inject. Try dictating some text first.",
        });
      } catch (error) {
        console.error("Failed to show notification:", error);
      }
      return;
    }

    try {
      // Import the TextInjectionService and inject the last result
      const { TextInjectionService } = await import(
        "../services/TextInjectionService"
      );
      const injectionService = new TextInjectionService();
      await injectionService.insertText(this.lastTransformedResult);
      console.log(`Injected last result: "${this.lastTransformedResult}"`);
    } catch (error) {
      console.error("Failed to inject last result:", error);
    }
  }

  async injectRawLastResult(): Promise<void> {
    if (!this.lastRawResult) {
      console.log("No last raw result available to inject");

      // Show a notification to the user
      try {
        const { NotificationService } = await import("../services/NotificationService");
        const notificationService = new NotificationService();
        await notificationService.sendNotification({
          title: "No Raw Last Result",
          message: "No previous raw transcription result available to inject. Try dictating some text first.",
        });
      } catch (error) {
        console.error("Failed to show notification:", error);
      }
      return;
    }

    try {
      // Import the TextInjectionService and inject the last raw result
      const { TextInjectionService } = await import(
        "../services/TextInjectionService"
      );
      const injectionService = new TextInjectionService();
      await injectionService.insertText(this.lastRawResult);
      console.log(`Injected last raw result: "${this.lastRawResult}"`);
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
}
