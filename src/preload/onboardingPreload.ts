import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("onboardingAPI", {
  getInitialState: () => ipcRenderer.invoke("onboarding:getInitialState"),
  checkAccessibility: () => ipcRenderer.invoke("onboarding:checkAccessibility"),
  resetAccessibilityCache: () =>
    ipcRenderer.invoke("onboarding:resetAccessibilityCache"),
  setModel: (modelName: string) =>
    ipcRenderer.invoke("onboarding:setModel", modelName),
  setPlugin: (pluginName: string) =>
    ipcRenderer.invoke("onboarding:setPlugin", pluginName),
  setAiEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("onboarding:setAiEnabled", enabled),
  setAiProvider: (baseUrl: string, model: string) =>
    ipcRenderer.invoke("onboarding:setAiProvider", { baseUrl, model }),
  saveApiKey: (apiKey: string) =>
    ipcRenderer.invoke("onboarding:saveApiKey", { apiKey }),
  runSetup: () => ipcRenderer.invoke("onboarding:runSetup"),
  downloadModel: (modelName: string) =>
    ipcRenderer.invoke("models:download", modelName),
  isDownloading: () => ipcRenderer.invoke("models:isDownloading"),
  onError: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  onProgress: (cb: (payload: any) => void) =>
    ipcRenderer.on("onboarding:progress", (_e, p) => cb(p)),
  onLog: (cb: (payload: any) => void) =>
    ipcRenderer.on("onboarding:log", (_e, p) => cb(p)),
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
  complete: () => ipcRenderer.invoke("onboarding:complete"),
});

// Also expose the AI key validation used by onboarding UI
contextBridge.exposeInMainWorld("electronAPI", {
  validateApiKeyAndListModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("ai:validateKeyAndListModels", { baseUrl, apiKey }),
});
