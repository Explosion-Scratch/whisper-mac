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
  onError: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  saveApiKeySecure: (apiKey: string) =>
    ipcRenderer.invoke("settings:saveApiKey", { apiKey }),

  // Model management helpers
  listDownloadedModels: () => ipcRenderer.invoke("models:listDownloaded"),
  deleteModels: (repoIds: string[]) =>
    ipcRenderer.invoke("models:delete", repoIds),
  downloadModel: (modelName: string) =>
    ipcRenderer.invoke("models:download", modelName),
  switchModel: (newModel: string, oldModel?: string) =>
    ipcRenderer.invoke("models:switch", { newModel, oldModel }),
  isDownloading: () => ipcRenderer.invoke("models:isDownloading"),

  // Model download progress listeners
  onModelDownloadProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("models:downloadProgress", (_event, progress) =>
      callback(progress)
    );
  },
  onModelDownloadLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("models:downloadLog", (_event, payload) =>
      callback(payload)
    );
  },
  onModelSwitchProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("models:switchProgress", (_event, progress) =>
      callback(progress)
    );
  },
  onModelSwitchLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("models:switchLog", (_event, payload) => callback(payload));
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
