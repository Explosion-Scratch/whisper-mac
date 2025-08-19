import { contextBridge, ipcRenderer } from "electron";

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
    ipcRenderer.invoke("settings:saveApiKey", { apiKey }),
  getApiKeySecure: () => ipcRenderer.invoke("settings:getApiKey"),

  // Unified plugin switching
  switchPlugin: (pluginName: string, modelName?: string) =>
    ipcRenderer.invoke("settings:switchPlugin", { pluginName, modelName }),
  isUnifiedDownloading: () => ipcRenderer.invoke("unified:isDownloading"),

  // Unified plugin management
  getPluginOptions: () => ipcRenderer.invoke("plugins:getOptions"),
  getActivePlugin: () => ipcRenderer.invoke("plugins:getActive"),
  updateActivePluginOptions: (options: Record<string, any>) =>
    ipcRenderer.invoke("plugins:updateActiveOptions", { options }),
  deleteInactivePlugin: (pluginName: string) =>
    ipcRenderer.invoke("plugins:deleteInactive", { pluginName }),
  getPluginDataInfo: () => ipcRenderer.invoke("settings:getPluginDataInfo"),

  // Unified plugin switching progress listeners
  onPluginSwitchProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("settings:pluginSwitchProgress", (_event, progress) =>
      callback(progress)
    );
  },
  onPluginSwitchLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("settings:pluginSwitchLog", (_event, payload) =>
      callback(payload)
    );
  },

  // Plugin option update progress listeners
  onPluginOptionProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("settings:pluginOptionProgress", (_event, progress) =>
      callback(progress)
    );
  },
  onPluginOptionLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("settings:pluginOptionLog", (_event, payload) =>
      callback(payload)
    );
  },

  // Listen for settings updates from main process
  onSettingsUpdated: (callback: (settings: Record<string, any>) => void) => {
    ipcRenderer.on("settings:updated", (_event, settings) =>
      callback(settings)
    );
  },

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
