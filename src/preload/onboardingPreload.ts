import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("onboardingAPI", {
  getInitialState: () => ipcRenderer.invoke("onboarding:getInitialState"),
  checkAccessibility: () => ipcRenderer.invoke("onboarding:checkAccessibility"),
  resetAccessibilityCache: () =>
    ipcRenderer.invoke("onboarding:resetAccessibilityCache"),
  checkMicrophone: () => ipcRenderer.invoke("onboarding:checkMicrophone"),
  resetMicrophoneCache: () =>
    ipcRenderer.invoke("onboarding:resetMicrophoneCache"),
  getPluginOptions: () => ipcRenderer.invoke("onboarding:getPluginOptions"),
  getCurrentPluginInfo: () =>
    ipcRenderer.invoke("onboarding:getCurrentPluginInfo"),
  setPlugin: (pluginName: string, options?: Record<string, any>) =>
    ipcRenderer.invoke("onboarding:setPlugin", { pluginName, options }),
  // Legacy methods removed - using unified plugin system
  setAiEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("onboarding:setAiEnabled", enabled),
  setAiProvider: (baseUrl: string, model: string) =>
    ipcRenderer.invoke("onboarding:setAiProvider", { baseUrl, model }),
  saveApiKey: (apiKey: string) =>
    ipcRenderer.invoke("onboarding:saveApiKey", { apiKey }),
  runSetup: () => ipcRenderer.invoke("onboarding:runSetup"),

  switchPlugin: (pluginName: string, modelName?: string) =>
    ipcRenderer.invoke("plugin:switch", { pluginName, modelName }),
  isUnifiedDownloading: () => ipcRenderer.invoke("unified:isDownloading"),
  complete: () => ipcRenderer.invoke("onboarding:complete"),
  onError: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  onProgress: (cb: (payload: any) => void) =>
    ipcRenderer.on("onboarding:progress", (_e, p) => cb(p)),
  onLog: (cb: (payload: any) => void) =>
    ipcRenderer.on("onboarding:log", (_e, p) => cb(p)),

  onPluginSwitchProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("plugin:switchProgress", (_event, progress) =>
      callback(progress),
    );
  },
  onPluginSwitchLog: (callback: (payload: any) => void) => {
    ipcRenderer.on("plugin:switchLog", (_event, payload) => callback(payload));
  },
});

// Also expose the AI key validation used by onboarding UI
contextBridge.exposeInMainWorld("electronAPI", {
  validateApiKeyAndListModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("ai:validateKeyAndListModels", { baseUrl, apiKey }),
  validateAiConfiguration: (baseUrl: string, model: string, apiKey?: string) =>
    ipcRenderer.invoke("ai:validateConfiguration", { baseUrl, model, apiKey }),
});
