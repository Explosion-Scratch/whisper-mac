import { DictationFlowManager } from "./DictationFlowManager";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { SettingsManager } from "../config/SettingsManager";
import { macInput } from "../native/MacInput";

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

type KeycodeMap = Record<string, number>;



const LETTER_KEYCODES: KeycodeMap = {
  A: 30,
  B: 48,
  C: 46,
  D: 32,
  E: 18,
  F: 33,
  G: 34,
  H: 35,
  I: 23,
  J: 36,
  K: 37,
  L: 38,
  M: 50,
  N: 49,
  O: 24,
  P: 25,
  Q: 16,
  R: 19,
  S: 31,
  T: 20,
  U: 22,
  V: 47,
  W: 17,
  X: 45,
  Y: 21,
  Z: 44,
};

const DIGIT_KEYCODES: KeycodeMap = {
  "0": 11,
  "1": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
  "6": 7,
  "7": 8,
  "8": 9,
  "9": 10,
};

const SPECIAL_KEYCODES: KeycodeMap = {
  SPACE: 57,
  SPACEBAR: 57,
  RETURN: 28,
  ENTER: 28,
  ESCAPE: 1,
  ESC: 1,
  TAB: 15,
  BACKSPACE: 14,
  DELETE: 57427,
  FORWARDDELETE: 57427,
  INSERT: 57426,
  HOME: 57415,
  END: 57423,
  PAGEUP: 57417,
  PAGEDOWN: 57425,
  UP: 57416,
  DOWN: 57424,
  LEFT: 57419,
  RIGHT: 57421,
  CAPSLOCK: 58,
  MINUS: 12,
  DASH: 12,
  HYPHEN: 12,
  EQUAL: 13,
  PLUS: 13,
  BACKQUOTE: 41,
  BACKTICK: 41,
  GRAVE: 41,
  BACKSLASH: 43,
  SLASH: 53,
  QUESTION: 53,
  SEMICOLON: 39,
  COLON: 39,
  QUOTE: 40,
  APOSTROPHE: 40,
  DOUBLEQUOTE: 40,
  COMMA: 51,
  PERIOD: 52,
  DOT: 52,
  BRACKETLEFT: 26,
  LBRACKET: 26,
  BRACKETRIGHT: 27,
  RBRACKET: 27,
  PIPE: 43,
  TILDE: 41,
};

const CHARACTER_KEYCODES: KeycodeMap = {
  " ": 57,
  "-": 12,
  "_": 12,
  "=": 13,
  "+": 13,
  "`": 41,
  "~": 41,
  "\\": 43,
  "|": 43,
  "/": 53,
  "?": 53,
  ".": 52,
  ">": 52,
  ",": 51,
  "<": 51,
  ";": 39,
  ":": 39,
  "'": 40,
  "\"": 40,
  "[": 26,
  "{": 26,
  "]": 27,
  "}": 27,
};

const FUNCTION_KEYCODES: KeycodeMap = (() => {
  const map: KeycodeMap = {};
  for (let i = 1; i <= 10; i++) {
    map[`F${i}`] = 58 + i;
  }
  map.F11 = 87;
  map.F12 = 88;
  map.F13 = 100;
  map.F14 = 101;
  map.F15 = 102;
  map.F16 = 103;
  map.F17 = 104;
  map.F18 = 105;
  map.F19 = 106;
  map.F20 = 107;
  map.F21 = 108;
  map.F22 = 109;
  map.F23 = 110;
  map.F24 = 111;
  return map;
})();

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

const normalizeKeyToken = (token: string): string => {
  return token.trim().replace(/\s+/g, "").replace(/[-_]/g, "").toUpperCase();
};

export class PushToTalkManager {
  private initialized = false;
  private disposed = false;
  private currentHotkey: string | null = null;
  private isSessionActive = false;
  private startPromise: Promise<void> | null = null;
  private finalizeScheduled = false;
  private settingsListener?: (key: string, value: unknown) => void;

  private registeredWithMacInput = false;
  private hotkeyMatcher: HotkeyMatcher | null = null;
  private hotkeyPressed = false;

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
  }

  dispose(): void {
    this.disposed = true;

    if (this.settingsListener) {
      this.settingsManager.off("setting-changed", this.settingsListener);
      this.settingsListener = undefined;
    }

    this.hotkeyMatcher = null;
    this.hotkeyPressed = false;
    this.currentHotkey = null;
    this.unregisterFromMacInput();
    this.initialized = false;
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
    const modifierMasks = this.hotkeyMatcher.combos.map((c) => this.modifiersToMask(c));
    const primaryMask = modifierMasks[0] ?? 0;

    macInput.registerPushToTalkHotkey(keyCode, primaryMask, (evt: { type: "down" | "up" }) => {
      if (evt?.type === "down") {
        if (this.hotkeyPressed) return;
        this.hotkeyPressed = true;
        this.handleHotkeyPress();
      } else if (evt?.type === "up") {
        if (!this.hotkeyPressed) return;
        this.hotkeyPressed = false;
        this.handleHotkeyRelease();
      }
    });
    this.registeredWithMacInput = true;
  }

  private unregisterFromMacInput(): void {
    if (!this.registeredWithMacInput) return;
    if (macInput?.unregisterPushToTalkHotkey) {
      try { macInput.unregisterPushToTalkHotkey(); } catch (_) {}
    }
    this.registeredWithMacInput = false;
  }

  private getConfiguredHotkey(): string {
    return (this.settingsManager.get<string>("hotkeys.pushToTalk", "") || "").trim();
  }

  private configureHotkey(hotkey: string): void {
    const normalized = (hotkey || "").trim();

    if (!normalized) {
      if (this.currentHotkey) {
        console.log("[PushToTalkManager] Push-to-talk hotkey cleared");
      }
      this.currentHotkey = null;
      this.hotkeyMatcher = null;
      this.hotkeyPressed = false;
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
      this.hotkeyPressed = false;
      this.unregisterFromMacInput();
      return;
    }

    this.hotkeyMatcher = matcher;
    this.hotkeyPressed = false;
    this.currentHotkey = normalized;
    this.unregisterFromMacInput();
    this.registerWithMacInput();
    console.log(`[PushToTalkManager] Registered push-to-talk hotkey: ${normalized}`);
  }

  private parseHotkey(hotkey: string): HotkeyMatcher | null {
    const tokens = hotkey.split("+").map((token) => token.trim()).filter(Boolean);
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

    const primaryKeyToken = nonModifierTokens[nonModifierTokens.length - 1];
    const keycode = this.lookupKeycode(primaryKeyToken);
    if (keycode == null) {
      console.warn(
        `[PushToTalkManager] Unable to resolve key code for "${primaryKeyToken}"`,
      );
      return null;
    }

    return {
      keycode,
      combos: dedupeModifierCombos(combos),
      source: hotkey,
    };
  }

  private lookupKeycode(token: string): number | null {
    if (!token) return null;

    const direct = CHARACTER_KEYCODES[token];
    if (typeof direct === "number") {
      return direct;
    }

    const normalized = normalizeKeyToken(token);
    if (!normalized) {
      return null;
    }

    if (LETTER_KEYCODES[normalized]) {
      return LETTER_KEYCODES[normalized];
    }

    if (DIGIT_KEYCODES[normalized]) {
      return DIGIT_KEYCODES[normalized];
    }

    if (SPECIAL_KEYCODES[normalized]) {
      return SPECIAL_KEYCODES[normalized];
    }

    if (FUNCTION_KEYCODES[normalized]) {
      return FUNCTION_KEYCODES[normalized];
    }

    return null;
  }

  private modifiersToMask(combo: ModifierCombo): number {
    const SHIFT = 1 << 17; // NSEventModifierFlagShift
    const CTRL = 1 << 18;  // NSEventModifierFlagControl
    const ALT = 1 << 19;   // NSEventModifierFlagOption
    const CMD = 1 << 20;   // NSEventModifierFlagCommand
    let mask = 0;
    if (combo.shift) mask |= SHIFT;
    if (combo.ctrl) mask |= CTRL;
    if (combo.alt) mask |= ALT;
    if (combo.meta) mask |= CMD;
    return mask;
  }

  private lookupMacKeycode(hotkeySource: string): number | null {
    const tokens = hotkeySource.split("+");
    const last = tokens[tokens.length - 1]?.trim().toUpperCase();
    if (!last) return null;
    // Letters A-Z
    if (/^[A-Z]$/.test(last)) {
      const map: Record<string, number> = {
        A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9,
        B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17, "1": 18, "2": 19, "3": 20,
        "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, O: 31, U: 32, "[": 33, I: 34, P: 35, RETURN: 36, L: 37, J: 38, '"': 39,
        K: 40, ';': 41, '\\': 42, ",": 43, "/": 44, N: 45, M: 46, ".": 47,
      };
      return map[last] ?? null;
    }
    // Digits and simple specials
    const simpleMap: Record<string, number> = {
      "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25,
      SPACE: 49, SPACEBAR: 49, TAB: 48, ESC: 53, ESCAPE: 53,
    };
    if (last in simpleMap) return simpleMap[last];
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(last)) {
      const n = parseInt(last.slice(1), 10);
      const base: Record<number, number> = { 1: 122, 2: 120, 3: 99, 4: 118, 5: 96, 6: 97, 7: 98, 8: 100, 9: 101, 10: 109, 11: 103, 12: 111, 13: 105, 14: 107, 15: 113, 16: 106, 17: 64, 18: 79, 19: 80, 20: 90, 21: 0, 22: 0, 23: 0, 24: 0 };
      return base[n] || null;
    }
    return null;
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
