// Runtime-safe loader for a macOS-only native addon that posts Cmd+V via CGEvent.
// If the native addon is not available, this module exports an empty object.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeBinding: any = {};

try {
  // Primary: next to compiled file (e.g., dist/native/mac_input.node)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeBinding = require("./mac_input.node");
} catch (_) {
  try {
    // Dev: built via node-gyp under native/mac-input
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeBinding = require("../../native/mac-input/build/Release/mac_input.node");
  } catch {
    nativeBinding = {};
  }
}

export type MacInputBinding = {
  pasteCommandV?: () => void;
  injectText?: (text: string) => void;
  copyToClipboard?: (text: string) => boolean;
  getClipboardText?: () => string | null;
  checkPermissions?: () => boolean;
  getWindowAppDetails?: () => string | null;
  getSelectedText?: () => {
    text: string;
    hasSelection: boolean;
    originalClipboard: string;
  };
};

export const macInput: MacInputBinding = nativeBinding as MacInputBinding;
