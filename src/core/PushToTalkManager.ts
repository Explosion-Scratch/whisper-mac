import { DictationFlowManager } from "./DictationFlowManager";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { SettingsManager } from "../config/SettingsManager";
import { macInput } from "../native/MacInput";
import { appStore } from "./AppStore";

type ModifierCombo = {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
};

interface HotkeyMatcher {
  keycode: number;
  combos: ModifierCombo[];
  source: string;
}

type PushToTalkState = "idle" | "starting" | "active" | "stopping";

const dedupeModifierCombos = (combos: ModifierCombo[]): ModifierCombo[] => {
  const seen = new Set<string>();
  const result: ModifierCombo[] = [];
  for (const combo of combos) {
    const key = `${combo.shift ? 1 : 0}${combo.alt ? 1 : 0}${combo.ctrl ? 1 : 0}${combo.meta ? 1 : 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(combo);
    }
  }
  return result;
};

export class PushToTalkManager {
  private initialized = false;
  private disposed = false;
  private currentHotkey: string | null = null;
  private startPromise: Promise<void> | null = null;
  private settingsListener?: (key: string, value: unknown) => void;
  private stateUnsubscribe?: () => void;
  private dictationStateUnsubscribe?: () => void;

  private registeredWithMacInput = false;
  private hotkeyMatcher: HotkeyMatcher | null = null;

  private pttState: PushToTalkState = "idle";
  private lastStateChangeTime = 0;

  constructor(
    private readonly dictationFlowManager: DictationFlowManager,
    private readonly transcriptionPluginManager: TranscriptionPluginManager,
    private readonly settingsManager: SettingsManager,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.configureHotkey(this.getConfiguredHotkey());

    this.settingsListener = (key, value) => {
      if (key === "hotkeys.pushToTalk") {
        this.configureHotkey(typeof value === "string" ? value : "");
      }
    };
    this.settingsManager.on("setting-changed", this.settingsListener);

    this.dictationStateUnsubscribe = appStore.subscribe(
      (state) => state.dictation.state,
      (dictationState) => {
        if (dictationState === "idle" && this.pttState !== "idle") {
          console.log(
            `[PushToTalkManager] Dictation became idle, syncing PTT state from ${this.pttState} to idle`,
          );
          this.transitionTo("idle");
        }
      },
    );
  }

  dispose(): void {
    this.disposed = true;

    if (this.settingsListener) {
      this.settingsManager.off("setting-changed", this.settingsListener);
      this.settingsListener = undefined;
    }

    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
      this.stateUnsubscribe = undefined;
    }

    if (this.dictationStateUnsubscribe) {
      this.dictationStateUnsubscribe();
      this.dictationStateUnsubscribe = undefined;
    }

    this.transitionTo("idle");
    this.hotkeyMatcher = null;
    this.currentHotkey = null;
    this.unregisterFromMacInput();
    this.initialized = false;
  }

  private transitionTo(newState: PushToTalkState): void {
    const prevState = this.pttState;
    if (prevState === newState) return;

    console.log(
      `[PushToTalkManager] State transition: ${prevState} -> ${newState}`,
    );
    this.pttState = newState;
    this.lastStateChangeTime = Date.now();

    appStore.setState({
      dictation: {
        ...appStore.getState().dictation,
        pushToTalkActive: newState !== "idle",
      },
    });
    // PTT state is now driven by dictation state subscription - no timeouts needed
  }

  private registerWithMacInput(): void {
    if (this.registeredWithMacInput) return;
    if (!this.hotkeyMatcher) return;
    if (!macInput?.registerPushToTalkHotkey) return;

    const keyCode = this.lookupMacKeycode(this.hotkeyMatcher.source);
    if (keyCode == null) {
      console.warn(
        `[PushToTalkManager] Unable to resolve macOS keyCode for "${this.hotkeyMatcher.source}"`,
      );
      return;
    }
    const modifierMasks = this.hotkeyMatcher.combos.map((c) =>
      this.modifiersToMask(c),
    );
    const modifierArgument =
      modifierMasks.length <= 1 ? (modifierMasks[0] ?? 0) : modifierMasks;

    console.log(
      `[PushToTalkManager] Registering hotkey: keyCode=${keyCode}, modifierMasks=${JSON.stringify(modifierMasks)}`,
    );

    try {
      macInput.registerPushToTalkHotkey(
        keyCode,
        modifierArgument,
        (evt: { type: "down" | "up" }) => {
          console.log(
            `[PushToTalkManager] Native callback: type=${evt?.type}, pttState=${this.pttState}`,
          );

          if (evt?.type === "down") {
            this.handleHotkeyPress();
          } else if (evt?.type === "up") {
            this.handleHotkeyRelease();
          } else {
            console.warn(
              `[PushToTalkManager] Unknown event type: ${evt?.type}`,
            );
          }
        },
      );
      this.registeredWithMacInput = true;
    } catch (error) {
      console.warn(
        "[PushToTalkManager] Failed to register native hotkey:",
        error,
      );
      this.registeredWithMacInput = false;
    }
  }

  private unregisterFromMacInput(): void {
    if (!this.registeredWithMacInput) return;
    if (macInput?.unregisterPushToTalkHotkey) {
      try {
        macInput.unregisterPushToTalkHotkey();
      } catch (_) {}
    }
    this.registeredWithMacInput = false;
  }

  private getConfiguredHotkey(): string {
    return (
      this.settingsManager.get<string>("hotkeys.pushToTalk", "") || ""
    ).trim();
  }

  private configureHotkey(hotkey: string): void {
    const normalized = (hotkey || "").trim();

    if (!normalized) {
      if (this.currentHotkey) {
        console.log("[PushToTalkManager] Push-to-talk hotkey cleared");
      }
      this.currentHotkey = null;
      this.hotkeyMatcher = null;
      this.transitionTo("idle");
      this.unregisterFromMacInput();
      return;
    }

    if (normalized === this.currentHotkey && this.hotkeyMatcher) {
      return;
    }

    const matcher = this.parseHotkey(normalized);
    if (!matcher) {
      console.warn(
        `[PushToTalkManager] Unsupported push-to-talk hotkey "${normalized}"; disabling push-to-talk`,
      );
      this.currentHotkey = null;
      this.hotkeyMatcher = null;
      this.transitionTo("idle");
      this.unregisterFromMacInput();
      return;
    }

    console.log(
      `[PushToTalkManager] Parsed hotkey "${normalized}": combos=${JSON.stringify(matcher.combos)}`,
    );

    this.hotkeyMatcher = matcher;
    this.transitionTo("idle");
    this.currentHotkey = normalized;
    this.unregisterFromMacInput();
    this.registerWithMacInput();
    console.log(
      `[PushToTalkManager] Registered push-to-talk hotkey: ${normalized}`,
    );
  }

  private parseHotkey(hotkey: string): HotkeyMatcher | null {
    const tokens = hotkey
      .split("+")
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      return null;
    }

    let combos: ModifierCombo[] = [
      { shift: false, alt: false, ctrl: false, meta: false },
    ];
    const nonModifierTokens: string[] = [];

    for (const token of tokens) {
      const sanitized = token.toLowerCase().replace(/[^a-z]/g, "");
      if (sanitized === "shift") {
        combos = combos.map((combo) => ({ ...combo, shift: true }));
        continue;
      }
      if (sanitized === "alt" || sanitized === "option") {
        combos = combos.map((combo) => ({ ...combo, alt: true }));
        continue;
      }
      if (sanitized === "ctrl" || sanitized === "control") {
        combos = combos.map((combo) => ({ ...combo, ctrl: true }));
        continue;
      }
      if (
        sanitized === "cmd" ||
        sanitized === "command" ||
        sanitized === "meta" ||
        sanitized === "super"
      ) {
        combos = combos.map((combo) => ({ ...combo, meta: true }));
        continue;
      }
      if (
        sanitized === "cmdorctrl" ||
        sanitized === "commandorcontrol" ||
        sanitized === "cmdorcontrol" ||
        sanitized === "commandorctrl"
      ) {
        const expanded: ModifierCombo[] = [];
        combos.forEach((combo) => {
          expanded.push({ ...combo, ctrl: true });
          expanded.push({ ...combo, meta: true });
          expanded.push({ ...combo, ctrl: true, meta: true });
        });
        combos = dedupeModifierCombos(expanded);
        continue;
      }

      nonModifierTokens.push(token);
    }

    if (nonModifierTokens.length === 0) {
      console.warn(
        `[PushToTalkManager] Hotkey "${hotkey}" does not include a non-modifier key`,
      );
      return null;
    }

    if (nonModifierTokens.length > 1) {
      console.warn(
        `[PushToTalkManager] Hotkey "${hotkey}" has multiple non-modifier keys; using "${nonModifierTokens[nonModifierTokens.length - 1]}"`,
      );
    }

    return {
      keycode: 0,
      combos: dedupeModifierCombos(combos),
      source: hotkey,
    };
  }

  private modifiersToMask(combo: ModifierCombo): number {
    if (macInput?.getModifierFlags) {
      const flags = macInput.getModifierFlags();
      let mask = 0;
      if (combo.shift) mask |= flags.shift;
      if (combo.ctrl) mask |= flags.control;
      if (combo.alt) mask |= flags.option;
      if (combo.meta) mask |= flags.command;
      return mask;
    }

    const SHIFT = 1 << 17;
    const CTRL = 1 << 18;
    const ALT = 1 << 19;
    const CMD = 1 << 20;
    let mask = 0;
    if (combo.shift) mask |= SHIFT;
    if (combo.ctrl) mask |= CTRL;
    if (combo.alt) mask |= ALT;
    if (combo.meta) mask |= CMD;
    return mask;
  }

  private lookupMacKeycode(hotkeySource: string): number | null {
    if (!macInput?.getKeyCode) {
      console.warn(
        "[PushToTalkManager] Native getKeyCode function not available",
      );
      return null;
    }

    const tokens = hotkeySource.split("+");
    const last = tokens[tokens.length - 1]?.trim().toLowerCase();
    if (!last) return null;

    const keyCode = macInput.getKeyCode(last);
    return keyCode ?? null;
  }

  private handleHotkeyPress(): void {
    if (this.disposed) return;

    if (this.pttState !== "idle") {
      console.log(
        `[PushToTalkManager] Ignoring press; current state is ${this.pttState}`,
      );
      return;
    }

    if (
      this.dictationFlowManager.isRecording() ||
      this.dictationFlowManager.isFinishing()
    ) {
      console.log(
        "[PushToTalkManager] Ignoring push-to-talk press; dictation already active/finishing",
      );
      return;
    }

    console.log(`[Perf] Hotkey detected at ${Date.now()}`);
    console.log("[PushToTalkManager] Starting push-to-talk session");
    this.transitionTo("starting");

    this.transcriptionPluginManager.setBufferingOverrideForNextSession(true);

    const start = this.dictationFlowManager.startDictation();
    this.startPromise = start;

    start
      .then(() => {
        if (this.pttState === "starting") {
          console.log("[PushToTalkManager] Dictation started successfully");
          this.transitionTo("active");
        } else {
          console.log(
            `[PushToTalkManager] Dictation started but state already changed to ${this.pttState}`,
          );
        }
      })
      .catch((error) => {
        console.error(
          "[PushToTalkManager] Failed to start push-to-talk dictation:",
          error,
        );
        this.transitionTo("idle");
        this.startPromise = null;
      })
      .finally(() => {
        this.transcriptionPluginManager.setBufferingOverrideForNextSession(
          null,
        );
      });
  }

  private handleHotkeyRelease(): void {
    if (this.disposed) return;

    if (this.pttState !== "starting" && this.pttState !== "active") {
      console.log(
        `[PushToTalkManager] Ignoring release; current state is ${this.pttState}`,
      );
      return;
    }

    console.log("[PushToTalkManager] Scheduling session finalization");
    this.transitionTo("stopping");

    const waitForStart = this.startPromise ?? Promise.resolve();
    waitForStart
      .catch((error) => {
        console.warn(
          "[PushToTalkManager] Waiting for start failed (ignoring for stop):",
          error,
        );
      })
      .finally(() => {
        void this.finalizePushToTalkSession();
      });
  }

  private async finalizePushToTalkSession(): Promise<void> {
    console.log("[PushToTalkManager] Finalizing session...");
    try {
      if (this.dictationFlowManager.isRecording()) {
        console.log(
          "[PushToTalkManager] Finishing current dictation (skipTransformation=true)",
        );
        await this.dictationFlowManager.finishCurrentDictation({
          skipTransformation: true,
        });
      } else if (this.dictationFlowManager.isFinishing()) {
        console.log(
          "[PushToTalkManager] Already in finishing state during release",
        );
      } else {
        console.log(
          "[PushToTalkManager] Not recording/finishing, cancelling flow",
        );
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
      console.log("[PushToTalkManager] Session ended, resetting state");
      this.transitionTo("idle");
      this.startPromise = null;
    }
  }
}
