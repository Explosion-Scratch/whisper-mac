<template>
  <div class="hotkey-container">
    <input
      type="text"
      class="form-control hotkey-input"
      :value="modelValue"
      @keydown="captureHotkey"
      @focus="handleFocus"
      @blur="handleBlur"
      :placeholder="placeholder || 'Press keys to set hotkey'"
      readonly
      :disabled="disabled"
    />
    <button
      type="button"
      @click="$emit('clear')"
      class="btn btn-default hotkey-clear-btn"
      v-if="modelValue"
      title="Clear hotkey"
      :disabled="disabled"
    >
      <i class="ph-duotone ph-x"></i>
    </button>
  </div>
</template>

<script>
/**
 * HotkeyField Component
 * Handles keyboard shortcut capture and display
 * @component
 */
export default {
  name: "HotkeyField",

  props: {
    /**
     * The current hotkey value
     */
    modelValue: {
      type: String,
      default: "",
    },

    /**
     * Placeholder text when no hotkey is set
     */
    placeholder: {
      type: String,
      default: "",
    },

    /**
     * Whether the field is disabled
     */
    disabled: {
      type: Boolean,
      default: false,
    },
  },

  emits: ["update:modelValue", "clear", "hotkeyChanged"],

  data() {
    return {
      isFocused: false,
      modifierKeys: ["Control", "Alt", "Shift", "Meta", "Command", "AltGraph"],
      keyMap: {
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
      },
      codeToKeyMap: {
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
      },
    };
  },

  methods: {
    /**
     * Handles input focus - suspends global shortcuts
     */
    async handleFocus() {
      if (this.isFocused) return;
      this.isFocused = true;
      try {
        if (window.electronAPI?.suspendShortcuts) {
          await window.electronAPI.suspendShortcuts();
          console.log("[HotkeyField] Global shortcuts suspended for capture");
        }
      } catch (error) {
        console.error("[HotkeyField] Failed to suspend shortcuts:", error);
      }
    },

    /**
     * Handles input blur - resumes global shortcuts
     */
    async handleBlur() {
      if (!this.isFocused) return;
      this.isFocused = false;
      try {
        if (window.electronAPI?.resumeShortcuts) {
          await window.electronAPI.resumeShortcuts();
          console.log("[HotkeyField] Global shortcuts resumed");
        }
      } catch (error) {
        console.error("[HotkeyField] Failed to resume shortcuts:", error);
      }
    },

    /**
     * Captures a hotkey from keyboard event
     * @param {KeyboardEvent} event - The keyboard event
     */
    captureHotkey(event) {
      event.preventDefault();
      event.stopPropagation();

      if (this.modifierKeys.includes(event.key)) {
        return;
      }

      const parts = [];

      if (event.ctrlKey && !event.metaKey) parts.push("Control");
      if (event.metaKey) parts.push("CommandOrControl");
      if (event.altKey) parts.push("Alt");
      if (event.shiftKey) parts.push("Shift");

      let keyToUse = event.key;

      if (event.altKey) {
        if (event.code.startsWith("Key")) {
          keyToUse = event.code.replace("Key", "");
        } else if (event.code.startsWith("Digit")) {
          keyToUse = event.code.replace("Digit", "");
        } else if (this.codeToKeyMap[event.code]) {
          keyToUse = this.codeToKeyMap[event.code];
        }
      }

      const normalizedKey = this.keyMap[keyToUse] || keyToUse;

      if (!this.modifierKeys.includes(normalizedKey)) {
        parts.push(normalizedKey);
      }

      const hotkeyString = parts.join("+");

      if (hotkeyString && parts.length > 0) {
        this.$emit("update:modelValue", hotkeyString);
        // Emit hotkeyChanged for immediate backend sync with conflict detection
        this.$emit("hotkeyChanged", hotkeyString);
      }
    },
  },
};
</script>

<style scoped>
.hotkey-container {
  display: flex;
  gap: var(--spacing-sm, 8px);
  max-width: 400px;
  align-items: center;
}

.hotkey-container:has(input:disabled) {
  opacity: 0.6;
  pointer-events: none;
}

.form-control {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-md, 13px);
  background: rgba(255, 255, 255, 0.08);
  transition: all var(--transition-fast, 0.15s ease);
  font-family: inherit;
  color: inherit;
}

.hotkey-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", monospace;
  font-size: var(--font-size-sm, 12px);
  text-align: center;
  transition: var(--transition-fast, 0.15s ease);
}

.hotkey-input:hover {
  background: rgba(255, 255, 255, 0.08);
}

.hotkey-input:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--color-primary, #007aff);
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
}

.hotkey-input::placeholder {
  color: var(--color-text-tertiary, #999999);
  font-style: italic;
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  background: rgba(255, 255, 255, 0.08);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s ease);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  color: var(--color-text-primary, #333333);
}

.btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--color-border-secondary, #d0d0d0);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.btn:active {
  transform: translateY(0);
  box-shadow: none;
}

.hotkey-clear-btn {
  flex-shrink: 0;
  min-width: 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm, 4px);
}

.hotkey-clear-btn i {
  font-size: 14px;
  margin: 0;
}
</style>
