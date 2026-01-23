/**
 * Settings Export/Import Utility
 *
 * Handles settings export and import operations with progress tracking
 */

/**
 * Analyze a settings file before import
 * @param {string} filePath - Path to the settings file
 * @returns {Promise<{valid: boolean, message: string, settingsCount?: number, requiredModels?: Array, missingModels?: Array, version?: number, exportedAt?: string}>}
 */
export async function analyzeSettingsFile(filePath) {
  return await window.electronAPI.analyzeImport(filePath);
}

/**
 * Export settings to a file
 * @param {string} filePath - Path to save the settings file
 * @returns {Promise<{success: boolean, message: string, filePath?: string}>}
 */
export async function exportSettings(filePath) {
  return await window.electronAPI.exportSettingsEnhanced(filePath);
}

/**
 * Import settings from a file with progress tracking
 * @param {string} filePath - Path to the settings file
 * @returns {Promise<{success: boolean, message: string, appliedSettings?: Object, modelsDownloaded?: string[], warnings?: string[], errors?: string[]}>}
 */
export async function importSettingsWithProgress(filePath) {
  return await window.electronAPI.importSettingsWithProgress(filePath);
}

/**
 * Cancel an in-progress import
 * @returns {Promise<{success: boolean}>}
 */
export async function cancelImport() {
  return await window.electronAPI.cancelImport();
}

/**
 * Check if an import is currently in progress
 * @returns {Promise<boolean>}
 */
export async function isImportInProgress() {
  return await window.electronAPI.isImportInProgress();
}

/**
 * Set up the import progress listener
 * @param {function} callback - Callback function to receive progress updates
 * @returns {void}
 */
export function onImportProgress(callback) {
  if (window.electronAPI?.onImportProgress) {
    window.electronAPI.onImportProgress(callback);
  }
}

/**
 * Show file open dialog for importing settings
 * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
 */
export async function showImportDialog() {
  return await window.electronAPI.showOpenDialog({
    filters: [{ name: "JSON Files", extensions: ["json"] }],
    properties: ["openFile"],
    title: "Import Settings",
  });
}

/**
 * Show file save dialog for exporting settings
 * @returns {Promise<{canceled: boolean, filePath?: string}>}
 */
export async function showExportDialog() {
  return await window.electronAPI.showSaveDialog({
    defaultPath: "whispermac-settings.json",
    filters: [{ name: "JSON Files", extensions: ["json"] }],
    title: "Export Settings",
  });
}

/**
 * Create initial import progress state
 * @returns {{visible: boolean, stage: string, message: string, percent: number, currentStep: number, totalSteps: number, modelProgress: null}}
 */
export function createInitialImportProgressState() {
  return {
    visible: false,
    stage: "",
    message: "",
    percent: 0,
    currentStep: 0,
    totalSteps: 0,
    modelProgress: null,
  };
}

/**
 * Format model names for display
 * @param {Array<{displayName: string}>} models - Array of model objects
 * @returns {string} - Comma-separated list of model names
 */
export function formatModelNames(models) {
  return models.map((m) => m.displayName).join(", ");
}

/**
 * Format import result message
 * @param {{success: boolean, message: string, modelsDownloaded?: string[], warnings?: string[]}} result
 * @returns {{message: string, type: 'success' | 'info' | 'error'}}
 */
export function formatImportResultMessage(result) {
  if (!result.success) {
    return {
      message: `Import failed: ${result.message}`,
      type: "error",
    };
  }

  if (result.warnings && result.warnings.length > 0) {
    return {
      message: `Settings imported with ${result.warnings.length} warning(s)`,
      type: "info",
    };
  }

  const modelsMsg = result.modelsDownloaded?.length
    ? ` (${result.modelsDownloaded.length} model(s) downloaded)`
    : "";

  return {
    message: `Settings imported successfully${modelsMsg}`,
    type: "success",
  };
}
