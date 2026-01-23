<template>
  <div class="hotkey-container">
    <input
      type="text"
      class="form-control hotkey-input"
      :value="modelValue"
      @keydown="captureHotkeyEvent"
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
import {
  captureHotkey,
  isModifierKey,
  normalizeKey,
  buildModifierParts,
} from "../../../../utils/hotkey.js";

/**
 * HotkeyField Component
 * Handles keyboard shortcut capture and display
 * Uses shared hotkey utilities for consistent behavior across the app
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
     * Captures a hotkey from keyboard event using shared utility
     * @param {KeyboardEvent} event - The keyboard event
     */
    captureHotkeyEvent(event) {
      const hotkeyString = captureHotkey(event);

      if (hotkeyString) {
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

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .form-control {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .hotkey-input {
    background: rgba(255, 255, 255, 0.04);
    color: #ececec;
  }

  .hotkey-input:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .hotkey-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #007aff;
    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.25);
  }

  .hotkey-input::placeholder {
    color: #666666;
  }

  .btn {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .hotkey-clear-btn:hover {
    background: rgba(255, 59, 48, 0.15);
    color: #ff3b30;
    border-color: #ff3b30;
  }
}
</style>
