import { ipcRenderer } from "electron";

export const settingsAPI = {
  getSettingsSchema: () => ipcRenderer.invoke("settings:getSchema"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Record<string, any>) =>
    ipcRenderer.invoke("settings:save", settings),
  resetAllSettings: () => ipcRenderer.invoke("settings:resetAll"),
  resetSettingsSection: (sectionId: string) =>
    ipcRenderer.invoke("settings:resetSection", sectionId),
  getLaunchAtLoginStatus: () =>
    ipcRenderer.invoke("settings:getLaunchAtLoginStatus"),
  importSettings: (filePath: string) =>
    ipcRenderer.invoke("settings:import", filePath),
  exportSettings: (filePath: string, settings: Record<string, any>) =>
    ipcRenderer.invoke("settings:export", filePath, settings),
  showOpenDialog: (options: any) =>
    ipcRenderer.invoke("dialog:showOpenDialog", options),
  showSaveDialog: (options: any) =>
    ipcRenderer.invoke("dialog:showSaveDialog", options),
  showDirectoryDialog: (options: any) =>
    ipcRenderer.invoke("dialog:showDirectoryDialog", options),
  closeSettingsWindow: () => ipcRenderer.invoke("settings:closeWindow"),
  validateApiKeyAndListModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("ai:validateKeyAndListModels", { baseUrl, apiKey }),
  validateAiConfiguration: (baseUrl: string, model: string, apiKey?: string) =>
    ipcRenderer.invoke("ai:validateConfiguration", { baseUrl, model, apiKey }),
  onError: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  updateHotkey: (key: string, value: string) =>
    ipcRenderer.invoke("settings:updateHotkey", { key, value }),
  suspendShortcuts: () => ipcRenderer.invoke("shortcuts:suspend"),
  resumeShortcuts: () => ipcRenderer.invoke("shortcuts:resume"),
  saveApiKeySecure: (apiKey: string) =>
    ipcRenderer.invoke("keychain:saveApiKey", apiKey),
  getApiKeySecure: () => ipcRenderer.invoke("keychain:getApiKey"),
  deleteApiKeySecure: () => ipcRenderer.invoke("keychain:deleteApiKey"),
  getPermissionsQuiet: () => ipcRenderer.invoke("permissions:getAllQuiet"),
  checkAccessibilityQuiet: () =>
    ipcRenderer.invoke("permissions:checkAccessibilityQuiet"),
  checkMicrophoneQuiet: () =>
    ipcRenderer.invoke("permissions:checkMicrophoneQuiet"),
  openAccessibilitySettings: () =>
    ipcRenderer.invoke("permissions:openAccessibilitySettings"),
  openMicrophoneSettings: () =>
    ipcRenderer.invoke("permissions:openMicrophoneSettings"),
  openSettingsToSection: (sectionId: string) =>
    ipcRenderer.invoke("settings:openToSection", sectionId),
  onNavigateToSection: (callback: (sectionId: string) => void) => {
    ipcRenderer.on("settings:navigateToSection", (_e, sectionId) =>
      callback(sectionId),
    );
  },
  getPermissions: () => ipcRenderer.invoke("permissions:getAll"),
  checkAccessibility: () =>
    ipcRenderer.invoke("permissions:checkAccessibility"),
  checkMicrophone: () => ipcRenderer.invoke("permissions:checkMicrophone"),
  refreshAllPermissions: () => ipcRenderer.invoke("permissions:resetCaches"),
  openSystemPreferences: () =>
    ipcRenderer.invoke("permissions:openSystemPreferences"),
  switchPlugin: (pluginName: string, modelName?: string) =>
    ipcRenderer.invoke("settings:switchPlugin", { pluginName, modelName }),
  testPluginActivation: (pluginName: string, options?: Record<string, any>) =>
    ipcRenderer.invoke("settings:testPluginActivation", {
      pluginName,
      options,
    }),
  validatePluginApiKey: (pluginName: string, apiKey: string) =>
    ipcRenderer.invoke("settings:validatePluginApiKey", {
      pluginName,
      apiKey,
    }),
  isUnifiedDownloading: () => ipcRenderer.invoke("unified:isDownloading"),
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
  // AI plugin capabilities (for transformation override detection)
  getActivePluginAiCapabilities: () =>
    ipcRenderer.invoke("settings:getActivePluginAiCapabilities"),
  activePluginOverridesTransformation: () =>
    ipcRenderer.invoke("settings:activePluginOverridesTransformation"),
  deleteInactivePlugin: (pluginName: string) =>
    ipcRenderer.invoke("plugins:deleteInactive", { pluginName }),
  getPluginDataInfo: () => ipcRenderer.invoke("settings:getPluginDataInfo"),
  listPluginData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:listData", { pluginName }),
  deletePluginDataItem: (pluginName: string, itemId: string) =>
    ipcRenderer.invoke("plugins:deleteDataItem", { pluginName, itemId }),
  deleteAllPluginData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:deleteAllData", { pluginName }),
  clearAllPluginData: () => ipcRenderer.invoke("settings:clearAllPluginData"),
  clearAllPluginDataWithFallback: () =>
    ipcRenderer.invoke("settings:clearAllPluginDataWithFallback"),
  getSecureStorageInfo: (pluginName: string) =>
    ipcRenderer.invoke("plugins:getSecureStorageInfo", { pluginName }),
  clearSecureData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:clearSecureData", { pluginName }),
  exportSecureData: (pluginName: string) =>
    ipcRenderer.invoke("plugins:exportSecureData", { pluginName }),
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
  onSettingsUpdated: (callback: (settings: Record<string, any>) => void) => {
    ipcRenderer.on("settings:updated", (_event, settings) =>
      callback(settings),
    );
  },
  onClearProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("settings:clearProgress", (_event, progress) =>
      callback(progress),
    );
  },
  onHideProgress: (callback: () => void) => {
    ipcRenderer.on("settings:hideProgress", () => callback());
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPackageInfo: () => ipcRenderer.invoke("app:getPackageInfo"),
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke("app:openExternalUrl", url),
  getAllPermissions: () => ipcRenderer.invoke("permissions:getAll"),
  checkAccessibilityPermissions: () =>
    ipcRenderer.invoke("permissions:checkAccessibility"),
  checkMicrophonePermissions: () =>
    ipcRenderer.invoke("permissions:checkMicrophone"),
  resetPermissionCaches: () => ipcRenderer.invoke("permissions:resetCaches"),
};
