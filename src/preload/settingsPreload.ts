import { contextBridge, ipcRenderer } from "electron";
const g: any = globalThis as any;
if (g && g.__electronLog && typeof g.__electronLog.log === "function") {
  Object.assign(console, g.__electronLog);
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Settings management
  getSettingsSchema: () => ipcRenderer.invoke("settings:getSchema"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Record<string, any>) =>
    ipcRenderer.invoke("settings:save", settings),
  resetAllSettings: () => ipcRenderer.invoke("settings:resetAll"),
  resetSettingsSection: (sectionId: string) =>
    ipcRenderer.invoke("settings:resetSection", sectionId),
  getLaunchAtLoginStatus: () => ipcRenderer.invoke("settings:getLaunchAtLoginStatus"),

  // Import/Export
  importSettings: (filePath: string) =>
    ipcRenderer.invoke("settings:import", filePath),
  exportSettings: (filePath: string, settings: Record<string, any>) =>
    ipcRenderer.invoke("settings:export", filePath, settings),

  // File dialogs
  showOpenDialog: (options: any) =>
    ipcRenderer.invoke("dialog:showOpenDialog", options),
  showSaveDialog: (options: any) =>
    ipcRenderer.invoke("dialog:showSaveDialog", options),
  showDirectoryDialog: (options: any) =>
    ipcRenderer.invoke("dialog:showDirectoryDialog", options),

  // Window management
  closeSettingsWindow: () => ipcRenderer.invoke("settings:closeWindow"),

  // AI provider utilities
  validateApiKeyAndListModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("ai:validateKeyAndListModels", { baseUrl, apiKey }),
  validateAiConfiguration: (baseUrl: string, model: string, apiKey?: string) =>
    ipcRenderer.invoke("ai:validateConfiguration", { baseUrl, model, apiKey }),
  onError: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  saveApiKeySecure: (apiKey: string) =>
    ipcRenderer.invoke("keychain:saveApiKey", apiKey),
  getApiKeySecure: () => ipcRenderer.invoke("keychain:getApiKey"),
  deleteApiKeySecure: () => ipcRenderer.invoke("keychain:deleteApiKey"),

  // Permissions management - quiet methods
  getPermissionsQuiet: () => ipcRenderer.invoke("permissions:getAllQuiet"),

  checkAccessibilityQuiet: () => ipcRenderer.invoke("permissions:checkAccessibilityQuiet"),
  checkMicrophoneQuiet: () => ipcRenderer.invoke("permissions:checkMicrophoneQuiet"),

  // Open specific system preferences
  openAccessibilitySettings: () => ipcRenderer.invoke("permissions:openAccessibilitySettings"),
  openMicrophoneSettings: () => ipcRenderer.invoke("permissions:openMicrophoneSettings"),

  // Settings navigation
  openSettingsToSection: (sectionId: string) =>
    ipcRenderer.invoke("settings:openToSection", sectionId),

  // Listen for navigation events
  onNavigateToSection: (callback: (sectionId: string) => void) => {
    ipcRenderer.on("settings:navigateToSection", (_e, sectionId) => callback(sectionId));
  },

  // Existing permissions methods
  getPermissions: () => ipcRenderer.invoke("permissions:getAll"),
  checkAccessibility: () => ipcRenderer.invoke("permissions:checkAccessibility"),
  checkMicrophone: () => ipcRenderer.invoke("permissions:checkMicrophone"),
  refreshAllPermissions: () => ipcRenderer.invoke("permissions:resetCaches"),
  openSystemPreferences: () => ipcRenderer.invoke("permissions:openSystemPreferences"),

  // Unified plugin switching
  switchPlugin: (pluginName: string, modelName?: string) =>
    ipcRenderer.invoke("settings:switchPlugin", { pluginName, modelName }),
  testPluginActivation: (pluginName: string, options?: Record<string, any>) =>
    ipcRenderer.invoke("settings:testPluginActivation", {
      pluginName,
      options,
    }),
  isUnifiedDownloading: () => ipcRenderer.invoke("unified:isDownloading"),

  // Unified plugin management
  getPluginSchemas: () => ipcRenderer.invoke("settings:getPluginSchemas"),
  getPluginSchema: (pluginName: string) =>
    ipcRenderer.invoke("settings:getPluginSchema", pluginName),
  getPluginOptions: (pluginName: string) =>
    ipcRenderer.invoke("settings:getPluginOptions", pluginName),
  setPluginOptions: (pluginName: string, options: Record<string, any>) =>
    ipcRenderer.invoke("settings:setPluginOptions", pluginName, options),
  verifyPluginOptions: (pluginName: string, options: Record<string, any>) =>
    ipcRenderer.invoke("settings:verifyPluginOptions", pluginName, options),
  getCurrentPluginInfo: () =>
    ipcRenderer.invoke("onboarding:getCurrentPluginInfo"),
  getActivePlugin: () => ipcRenderer.invoke("plugins:getActive"),
  updateActivePluginOptions: (options: Record<string, any>) =>
    ipcRenderer.invoke("plugins:updateActiveOptions", { options }),
  deleteInactivePlugin: (pluginName: string) =>
    ipcRenderer.invoke("plugins:deleteInactive", { pluginName }),
  getPluginDataInfo: () => ipcRenderer.invoke("settings:getPluginDataInfo"),

  // New data management APIs
  listPluginData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:listData", { pluginName }),
  deletePluginDataItem: (pluginName: string, itemId: string) =>
    ipcRenderer.invoke("plugins:deleteDataItem", { pluginName, itemId }),
  deleteAllPluginData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:deleteAllData", { pluginName }),
  clearAllPluginData: () => ipcRenderer.invoke("settings:clearAllPluginData"),
  clearAllPluginDataWithFallback: () =>
    ipcRenderer.invoke("settings:clearAllPluginDataWithFallback"),

  // Secure storage management APIs
  getSecureStorageInfo: (pluginName: string) =>
    ipcRenderer.invoke("plugins:getSecureStorageInfo", { pluginName }),
  clearSecureData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:clearSecureData", { pluginName }),
  exportSecureData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:exportSecureData", { pluginName }),

  // Unified plugin switching progress listeners
  onPluginSwitchProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("settings:pluginSwitchProgress", (_event, progress) =>
      callback(progress),
    );
  },
  onPluginSwitchLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("settings:pluginSwitchLog", (_event, payload) =>
      callback(payload),
    );
  },

  // Plugin option update progress listeners
  onPluginOptionProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("settings:pluginOptionProgress", (_event, progress) =>
      callback(progress),
    );
  },
  onPluginOptionLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("settings:pluginOptionLog", (_event, payload) =>
      callback(payload),
    );
  },

  // Listen for settings updates from main process
  onSettingsUpdated: (callback: (settings: Record<string, any>) => void) => {
    ipcRenderer.on("settings:updated", (_event, settings) =>
      callback(settings),
    );
  },

  // Listen for clear progress updates
  onClearProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("settings:clearProgress", (_event, progress) =>
      callback(progress),
    );
  },

  // Listen for hide progress
  onHideProgress: (callback: () => void) => {
    ipcRenderer.on("settings:hideProgress", () => callback());
  },

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // App information
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPackageInfo: () => ipcRenderer.invoke("app:getPackageInfo"),

  // External URL handling
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke("app:openExternalUrl", url),

  // Permissions management
  getAllPermissions: () => ipcRenderer.invoke("permissions:getAll"),
  checkAccessibilityPermissions: () => ipcRenderer.invoke("permissions:checkAccessibility"),
  checkMicrophonePermissions: () => ipcRenderer.invoke("permissions:checkMicrophone"),
  resetPermissionCaches: () => ipcRenderer.invoke("permissions:resetCaches"),
});
