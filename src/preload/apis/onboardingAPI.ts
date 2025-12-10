import { ipcRenderer } from "electron";

export const onboardingAPI = {
  getInitialState: () => ipcRenderer.invoke("onboarding:getInitialState"),
  checkAccessibility: () => {
    console.log("Preload:onboarding.checkAccessibility invoke -> main");
    const startedAt = Date.now();
    return ipcRenderer
      .invoke("onboarding:checkAccessibility")
      .then((ok) => {
        const durationMs = Date.now() - startedAt;
        console.log(
          "Preload:onboarding.checkAccessibility result",
          JSON.stringify({ ok, durationMs }),
        );
        return ok;
      })
      .catch((err) => {
        const durationMs = Date.now() - startedAt;
        console.error(
          "Preload:onboarding.checkAccessibility error",
          JSON.stringify({ message: err?.message || String(err), durationMs }),
        );
        throw err;
      });
  },
  resetAccessibilityCache: () => {
    console.log("Preload:onboarding.resetAccessibilityCache -> main");
    return ipcRenderer.invoke("onboarding:resetAccessibilityCache");
  },
  checkMicrophone: () => ipcRenderer.invoke("onboarding:checkMicrophone"),
  resetMicrophoneCache: () =>
    ipcRenderer.invoke("onboarding:resetMicrophoneCache"),
  openSettings: (section?: string) =>
    ipcRenderer.invoke("onboarding:openSettings", section),
  openSystemPreferences: (type?: string) =>
    ipcRenderer.invoke("onboarding:openSystemPreferences", type),
  getPluginSchemas: () => ipcRenderer.invoke("onboarding:getPluginSchemas"),
  getPluginOptions: (pluginName: string) =>
    ipcRenderer.invoke("onboarding:getPluginOptions", pluginName),
  getCurrentPluginInfo: () =>
    ipcRenderer.invoke("onboarding:getCurrentPluginInfo"),
  setPlugin: (pluginName: string, options?: Record<string, any>) =>
    ipcRenderer.invoke("onboarding:setPlugin", { pluginName, options }),
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
};

export const onboardingElectronAPI = {
  validateApiKeyAndListModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("ai:validateKeyAndListModels", { baseUrl, apiKey }),
  validateAiConfiguration: (baseUrl: string, model: string, apiKey?: string) =>
    ipcRenderer.invoke("ai:validateConfiguration", { baseUrl, model, apiKey }),
};
