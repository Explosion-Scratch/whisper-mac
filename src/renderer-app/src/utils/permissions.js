/**
 * Permission management utilities for accessibility and microphone permissions.
 * Provides a unified interface for checking, requesting, and displaying permission status.
 */

/**
 * @typedef {Object} PermissionStatus
 * @property {boolean} checked - Whether the permission has been checked
 * @property {boolean} granted - Whether the permission is granted
 */

/**
 * @typedef {Object} Permissions
 * @property {PermissionStatus} accessibility
 * @property {PermissionStatus} microphone
 */

/**
 * Load all permissions status from the main process
 * @returns {Promise<Permissions|null>}
 */
export async function loadPermissions() {
  try {
    return await window.electronAPI.getPermissionsQuiet();
  } catch (error) {
    console.error("Failed to load permissions:", error);
    return null;
  }
}

/**
 * Check accessibility permissions
 * @returns {Promise<PermissionStatus>}
 */
export async function checkAccessibilityPermissions() {
  try {
    return await window.electronAPI.checkAccessibilityPermissions();
  } catch (error) {
    console.error("Failed to check accessibility permissions:", error);
    return { checked: true, granted: false };
  }
}

/**
 * Check microphone permissions
 * @returns {Promise<PermissionStatus>}
 */
export async function checkMicrophonePermissions() {
  try {
    return await window.electronAPI.checkMicrophonePermissions();
  } catch (error) {
    console.error("Failed to check microphone permissions:", error);
    return { checked: true, granted: false };
  }
}

/**
 * Reset permission caches and reload permissions
 * @returns {Promise<Permissions|null>}
 */
export async function refreshPermissions() {
  try {
    await window.electronAPI.resetPermissionCaches();
    return await loadPermissions();
  } catch (error) {
    console.error("Failed to refresh permissions:", error);
    return null;
  }
}

/**
 * Reset accessibility permission cache (used before checking)
 * @returns {Promise<void>}
 */
export async function resetAccessibilityCache() {
  if (window.onboardingAPI?.resetAccessibilityCache) {
    await window.onboardingAPI.resetAccessibilityCache();
  }
}

/**
 * Check accessibility via onboarding API
 * @returns {Promise<boolean>}
 */
export async function checkAccessibilityOnboarding() {
  if (window.onboardingAPI?.checkAccessibility) {
    return await window.onboardingAPI.checkAccessibility();
  }
  return false;
}

/**
 * Check microphone via onboarding API
 * @returns {Promise<boolean>}
 */
export async function checkMicrophoneOnboarding() {
  if (window.onboardingAPI?.checkMicrophone) {
    return await window.onboardingAPI.checkMicrophone();
  }
  return false;
}

/**
 * Open system preferences for a specific permission type
 * @param {'accessibility'|'microphone'|'general'} type
 * @returns {Promise<void>}
 */
export async function openSystemPreferences(type) {
  try {
    if (type === "accessibility") {
      await window.electronAPI.openAccessibilitySettings();
    } else if (type === "microphone") {
      await window.electronAPI.openMicrophoneSettings();
    } else if (window.onboardingAPI?.openSystemPreferences) {
      await window.onboardingAPI.openSystemPreferences(type);
    } else {
      await window.electronAPI.openSystemPreferences();
    }
  } catch (error) {
    console.error(`Failed to open ${type} preferences:`, error);
  }
}

/**
 * Get CSS class for permission status display
 * @param {PermissionStatus|undefined} permission
 * @returns {'granted'|'denied'|'unknown'}
 */
export function getPermissionStatusClass(permission) {
  if (!permission?.checked) {
    return "unknown";
  }
  return permission.granted ? "granted" : "denied";
}

/**
 * Get human-readable text for permission status
 * @param {PermissionStatus|undefined} permission
 * @returns {string}
 */
export function getPermissionStatusText(permission) {
  if (!permission?.checked) {
    return "Checking...";
  }
  return permission.granted ? "Granted" : "Not Granted";
}
