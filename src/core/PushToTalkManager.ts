import { macInput } from "../native/MacInput";
import { DictationFlowManager } from "./DictationFlowManager";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { SettingsManager } from "../config/SettingsManager";

export class PushToTalkManager {
  private initialized = false;
  private disposed = false;
  private currentHotkey: string | null = null;
  private isSessionActive = false;
  private startPromise: Promise<void> | null = null;
  private finalizeScheduled = false;
  private settingsListener?: (key: string, value: unknown) => void;

  constructor(
    private readonly dictationFlowManager: DictationFlowManager,
    private readonly transcriptionPluginManager: TranscriptionPluginManager,
    private readonly settingsManager: SettingsManager,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (
      typeof macInput.registerPushToTalkHotkey !== "function" ||
      typeof macInput.unregisterPushToTalkHotkey !== "function"
    ) {
      console.warn(
        "[PushToTalkManager] Native push-to-talk support not available; feature disabled",
      );
      return;
    }

    this.configureHotkey(this.getConfiguredHotkey());

    this.settingsListener = (key, value) => {
      if (key === "hotkeys.pushToTalk") {
        this.configureHotkey(typeof value === "string" ? value : "");
      }
    };
    this.settingsManager.on("setting-changed", this.settingsListener);
  }

  dispose(): void {
    this.disposed = true;

    if (this.settingsListener) {
      this.settingsManager.off("setting-changed", this.settingsListener);
      this.settingsListener = undefined;
    }

    this.unregisterNativeHotkey();
    this.initialized = false;
  }

  private getConfiguredHotkey(): string {
    return (this.settingsManager.get<string>("hotkeys.pushToTalk", "") || "").trim();
  }

  private configureHotkey(hotkey: string): void {
    if (
      typeof macInput.registerPushToTalkHotkey !== "function" ||
      typeof macInput.unregisterPushToTalkHotkey !== "function"
    ) {
      return;
    }

    const normalized = (hotkey || "").trim();
    if (normalized === this.currentHotkey) {
      return;
    }

    this.unregisterNativeHotkey();

    if (!normalized) {
      this.currentHotkey = null;
      return;
    }

    try {
      const success = macInput.registerPushToTalkHotkey(
        normalized,
        () => this.handleHotkeyPress(),
        () => this.handleHotkeyRelease(),
      );
      if (success === false) {
        console.warn(
          `[PushToTalkManager] Native module rejected push-to-talk hotkey "${normalized}"`,
        );
        this.currentHotkey = null;
        return;
      }

      this.currentHotkey = normalized;
      console.log(
        `[PushToTalkManager] Registered push-to-talk hotkey: ${normalized}`,
      );
    } catch (error) {
      console.error(
        `[PushToTalkManager] Failed to register push-to-talk hotkey "${normalized}":`,
        error,
      );
      this.currentHotkey = null;
    }
  }

  private unregisterNativeHotkey(): void {
    if (typeof macInput.unregisterPushToTalkHotkey === "function") {
      try {
        macInput.unregisterPushToTalkHotkey();
      } catch (error) {
        console.error(
          "[PushToTalkManager] Failed to unregister push-to-talk hotkey:",
          error,
        );
      }
    }
    this.currentHotkey = null;
  }

  private handleHotkeyPress(): void {
    if (this.disposed) return;
    if (this.isSessionActive) return;

    if (
      this.dictationFlowManager.isRecording() ||
      this.dictationFlowManager.isFinishing()
    ) {
      console.log(
        "[PushToTalkManager] Ignoring push-to-talk press; dictation already active",
      );
      return;
    }

    this.isSessionActive = true;
    this.finalizeScheduled = false;

    this.transcriptionPluginManager.setBufferingOverrideForNextSession(true);

    const start = this.dictationFlowManager.startDictation();
    this.startPromise = start;

    start
      .catch((error) => {
        console.error(
          "[PushToTalkManager] Failed to start push-to-talk dictation:",
          error,
        );
        this.isSessionActive = false;
      })
      .finally(() => {
        this.startPromise = null;
        this.transcriptionPluginManager.setBufferingOverrideForNextSession(null);
      });
  }

  private handleHotkeyRelease(): void {
    if (this.disposed) return;
    if (!this.isSessionActive) return;
    if (this.finalizeScheduled) return;

    this.finalizeScheduled = true;

    const waitForStart = this.startPromise ?? Promise.resolve();
    waitForStart
      .catch((error) => {
        if (error) {
          console.error(
            "[PushToTalkManager] Push-to-talk start promise rejected:",
            error,
          );
        }
      })
      .finally(() => {
        void this.finalizePushToTalkSession();
      });
  }

  private async finalizePushToTalkSession(): Promise<void> {
    try {
      if (this.dictationFlowManager.isRecording()) {
        await this.dictationFlowManager.finishCurrentDictation({
          skipTransformation: true,
        });
      } else if (this.dictationFlowManager.isFinishing()) {
        console.log(
          "[PushToTalkManager] Push-to-talk release detected during finishing state",
        );
      } else {
        await this.dictationFlowManager.cancelDictationFlow();
      }
    } catch (error) {
      console.error(
        "[PushToTalkManager] Failed to finalize push-to-talk session:",
        error,
      );
      try {
        await this.dictationFlowManager.cancelDictationFlow();
      } catch (cancelError) {
        console.error(
          "[PushToTalkManager] Push-to-talk cancellation failed:",
          cancelError,
        );
      }
    } finally {
      this.isSessionActive = false;
      this.finalizeScheduled = false;
    }
  }
}
