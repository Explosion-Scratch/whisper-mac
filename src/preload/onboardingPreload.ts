import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("onboardingAPI", {
  getInitialState: () => ipcRenderer.invoke("onboarding:getInitialState"),
  checkAccessibility: () => ipcRenderer.invoke("onboarding:checkAccessibility"),
  resetAccessibilityCache: () =>
    ipcRenderer.invoke("onboarding:resetAccessibilityCache"),
  setModel: (modelRepoId: string) =>
    ipcRenderer.invoke("onboarding:setModel", modelRepoId),
  setAiEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("onboarding:setAiEnabled", enabled),
  setAiProvider: (baseUrl: string, model: string) =>
    ipcRenderer.invoke("onboarding:setAiProvider", { baseUrl, model }),
  saveApiKey: (apiKey: string) =>
    ipcRenderer.invoke("onboarding:saveApiKey", { apiKey }),
  runSetup: () => ipcRenderer.invoke("onboarding:runSetup"),
  onProgress: (cb: (payload: any) => void) =>
    ipcRenderer.on("onboarding:progress", (_e, p) => cb(p)),
  onLog: (cb: (payload: any) => void) =>
    ipcRenderer.on("onboarding:log", (_e, p) => cb(p)),
  complete: () => ipcRenderer.invoke("onboarding:complete"),
});
