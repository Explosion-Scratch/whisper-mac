/**
 * Hotkey capture and normalization utilities.
 * Converts keyboard events to Electron accelerator strings.
 */

const MODIFIER_KEYS = [
  "Control",
  "Alt",
  "Shift",
  "Meta",
  "Command",
  "AltGraph",
];

const CODE_TO_KEY_MAP = {
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  IntlBackslash: "\\",
};

const SPECIAL_KEY_MAP = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backspace: "BackSpace",
  Delete: "Delete",
  Enter: "Return",
  Tab: "Tab",
  Escape: "Escape",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

/**
 * Check if a key is a modifier-only key
 * @param {string} key - The key to check
 * @returns {boolean}
 */
export function isModifierKey(key) {
  return MODIFIER_KEYS.includes(key);
}

/**
 * Normalize a key for cross-platform consistency, especially with Alt combinations
 * @param {string} key - The event.key value
 * @param {string} code - The event.code value
 * @param {boolean} altKey - Whether Alt is pressed
 * @returns {string} Normalized key
 */
export function normalizeKey(key, code, altKey) {
  let keyToUse = key;

  if (altKey) {
    if (code.startsWith("Key")) {
      keyToUse = code.replace("Key", "");
    } else if (code.startsWith("Digit")) {
      keyToUse = code.replace("Digit", "");
    } else if (CODE_TO_KEY_MAP[code]) {
      keyToUse = CODE_TO_KEY_MAP[code];
    }
  } else if (code.startsWith("Key")) {
    keyToUse = code.replace("Key", "");
  }

  return SPECIAL_KEY_MAP[keyToUse] || keyToUse;
}

/**
 * Build modifier parts array from keyboard event
 * @param {KeyboardEvent} event - The keyboard event
 * @returns {string[]} Array of modifier strings
 */
export function buildModifierParts(event) {
  const parts = [];

  if (event.ctrlKey && !event.metaKey) parts.push("Control");
  if (event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  return parts;
}

/**
 * Capture a hotkey from a keyboard event and return an Electron accelerator string
 * @param {KeyboardEvent} event - The keyboard event
 * @returns {string|null} The hotkey string, or null if only modifiers were pressed
 */
export function captureHotkey(event) {
  event.preventDefault();
  event.stopPropagation();

  if (isModifierKey(event.key)) {
    return null;
  }

  const parts = buildModifierParts(event);
  const normalizedKey = normalizeKey(event.key, event.code, event.altKey);

  if (!isModifierKey(normalizedKey)) {
    parts.push(normalizedKey);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("+");
}

/**
 * Create a hotkey capture handler that updates a setting
 * @param {Function} onCapture - Callback with the captured hotkey string
 * @returns {Function} Event handler function
 */
export function createHotkeyHandler(onCapture) {
  return (event) => {
    const hotkey = captureHotkey(event);
    if (hotkey) {
      onCapture(hotkey);
    }
  };
}
