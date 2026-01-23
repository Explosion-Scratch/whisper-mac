/**
 * Composable for hotkey capture functionality.
 * Provides reactive state and methods for capturing keyboard shortcuts.
 */

import { ref, onUnmounted } from "vue";
import {
  captureHotkey,
  isModifierKey,
  normalizeKey,
  buildModifierParts,
} from "../utils/hotkey.js";

/**
 * Creates a hotkey capture composable with suspend/resume shortcut support.
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.onCapture - Callback when a hotkey is captured
 * @param {Function} options.onFocus - Callback when input is focused
 * @param {Function} options.onBlur - Callback when input is blurred
 * @returns {Object} Composable state and methods
 */
export function useHotkeyCapture(options = {}) {
  const isFocused = ref(false);
  const isCapturing = ref(false);
  const currentHotkey = ref("");

  /**
   * Suspend global shortcuts when capturing
   */
  async function suspendShortcuts() {
    try {
      // Try electronAPI first (settings window), then onboardingAPI
      const api = window.electronAPI || window.onboardingAPI;
      if (api?.suspendShortcuts) {
        await api.suspendShortcuts();
        console.log("[useHotkeyCapture] Global shortcuts suspended");
      }
    } catch (error) {
      console.error("[useHotkeyCapture] Failed to suspend shortcuts:", error);
    }
  }

  /**
   * Resume global shortcuts after capturing
   */
  async function resumeShortcuts() {
    try {
      const api = window.electronAPI || window.onboardingAPI;
      if (api?.resumeShortcuts) {
        await api.resumeShortcuts();
        console.log("[useHotkeyCapture] Global shortcuts resumed");
      }
    } catch (error) {
      console.error("[useHotkeyCapture] Failed to resume shortcuts:", error);
    }
  }

  /**
   * Handle focus event on hotkey input
   */
  async function handleFocus() {
    if (isFocused.value) return;
    isFocused.value = true;
    isCapturing.value = true;
    await suspendShortcuts();
    options.onFocus?.();
  }

  /**
   * Handle blur event on hotkey input
   */
  async function handleBlur() {
    if (!isFocused.value) return;
    isFocused.value = false;
    isCapturing.value = false;
    await resumeShortcuts();
    options.onBlur?.();
  }

  /**
   * Handle keydown event to capture hotkey
   * @param {KeyboardEvent} event - The keyboard event
   */
  function handleKeydown(event) {
    const hotkey = captureHotkey(event);
    if (hotkey) {
      currentHotkey.value = hotkey;
      options.onCapture?.(hotkey);
    }
  }

  /**
   * Clear the current hotkey
   */
  function clearHotkey() {
    currentHotkey.value = "";
    options.onCapture?.("");
  }

  /**
   * Set the hotkey value programmatically
   * @param {string} hotkey - The hotkey string
   */
  function setHotkey(hotkey) {
    currentHotkey.value = hotkey || "";
  }

  // Cleanup on unmount
  onUnmounted(async () => {
    if (isFocused.value) {
      await resumeShortcuts();
    }
  });

  return {
    isFocused,
    isCapturing,
    currentHotkey,
    handleFocus,
    handleBlur,
    handleKeydown,
    clearHotkey,
    setHotkey,
    suspendShortcuts,
    resumeShortcuts,
  };
}

/**
 * Format a hotkey string for display (more readable)
 * @param {string} hotkey - The hotkey string (e.g., "CommandOrControl+Shift+D")
 * @returns {string} Formatted hotkey for display
 */
export function formatHotkeyDisplay(hotkey) {
  if (!hotkey) return "";

  return hotkey
    .replace("CommandOrControl", "⌘")
    .replace("Control", "⌃")
    .replace("Alt", "⌥")
    .replace("Shift", "⇧")
    .replace("Meta", "⌘")
    .replace(/\+/g, " ");
}

/**
 * Format a hotkey for settings storage (Electron accelerator format)
 * @param {string} hotkey - The display hotkey
 * @returns {string} Electron accelerator format
 */
export function formatHotkeyForStorage(hotkey) {
  if (!hotkey) return "";

  return hotkey
    .replace("⌘", "CommandOrControl")
    .replace("⌃", "Control")
    .replace("⌥", "Alt")
    .replace("⇧", "Shift")
    .replace(/ /g, "+");
}

export default useHotkeyCapture;
