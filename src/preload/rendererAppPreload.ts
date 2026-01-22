import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

const g: any = globalThis as any;
if (g && g.__electronLog && typeof g.__electronLog.log === "function") {
  Object.assign(console, g.__electronLog);
}

// ============================================================================
// DICTATION API
// ============================================================================

type ListenerCleanupFn = () => void;
const dictationActiveListeners: ListenerCleanupFn[] = [];

function createListenerWithCleanup<T>(
  channel: string,
  callback: (data: T) => void,
): ListenerCleanupFn {
  const handler = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  const cleanup = () => ipcRenderer.removeListener(channel, handler);
  dictationActiveListeners.push(cleanup);
  return cleanup;
}

function createSimpleListenerWithCleanup(
  channel: string,
  callback: () => void,
): ListenerCleanupFn {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  const cleanup = () => ipcRenderer.removeListener(channel, handler);
  dictationActiveListeners.push(cleanup);
  return cleanup;
}

const dictationAPI = {
  onAnimateIn: (callback: () => void) => {
    return createSimpleListenerWithCleanup("animate-in", callback);
  },
  onInitializeDictation: (callback: (data: any) => void) => {
    return createListenerWithCleanup("initialize-dictation", callback);
  },
  onDictationStartRecording: (callback: () => void) => {
    return createSimpleListenerWithCleanup(
      "dictation-start-recording",
      callback,
    );
  },
  onDictationStopRecording: (callback: () => void) => {
    return createSimpleListenerWithCleanup(
      "dictation-stop-recording",
      callback,
    );
  },
  onTranscriptionUpdate: (callback: (update: any) => void) => {
    return createListenerWithCleanup(
      "dictation-transcription-update",
      callback,
    );
  },
  onDictationComplete: (callback: (finalText: string) => void) => {
    return createListenerWithCleanup("dictation-complete", callback);
  },
  onDictationClear: (callback: () => void) => {
    return createSimpleListenerWithCleanup("dictation-clear", callback);
  },
  onDictationStatus: (callback: (status: string) => void) => {
    return createListenerWithCleanup("dictation-set-status", callback);
  },
  onPlayEndSound: (callback: () => void) => {
    return createSimpleListenerWithCleanup("play-end-sound", callback);
  },
  onWindowHidden: (callback: () => void) => {
    return createSimpleListenerWithCleanup("window-hidden", callback);
  },
  onFlushPendingAudio: (callback: () => void) => {
    return createSimpleListenerWithCleanup(
      "dictation-flush-pending-audio",
      callback,
    );
  },
  onError: (callback: (payload: any) => void) => {
    return createListenerWithCleanup("error:data", callback);
  },
  closeDictationWindow: () => {
    ipcRenderer.send("close-dictation-window");
  },
  cancelDictation: () => {
    ipcRenderer.send("cancel-dictation");
  },
  minimizeWindow: () => {
    ipcRenderer.send("minimize-dictation-window");
  },
  logMessage: (message: string) => {
    ipcRenderer.send("dictation-log", message);
  },
  sendAudioSegment: (audioData: Float32Array) => {
    ipcRenderer.send("vad-audio-segment", Array.from(audioData));
  },
  sendDictationWindowReady: () => {
    ipcRenderer.send("dictation-window-ready");
  },
  onAudioLevel: (callback: (level: number) => void) => {
    return createListenerWithCleanup("dictation-audio-level", callback);
  },
  onDictationSpeechStart: (callback: () => void) => {
    return createSimpleListenerWithCleanup("dictation-speech-start", callback);
  },
  onDictationSpeechEnd: (callback: () => void) => {
    return createSimpleListenerWithCleanup("dictation-speech-end", callback);
  },
  getSelectedMicrophone: () => {
    return ipcRenderer.invoke("dictation:getSelectedMicrophone");
  },
  setSelectedMicrophone: (deviceId: string) => {
    return ipcRenderer.invoke("dictation:setSelectedMicrophone", deviceId);
  },
  cleanup: () => {
    for (const cleanup of dictationActiveListeners) {
      try {
        cleanup();
      } catch {}
    }
    dictationActiveListeners.length = 0;
  },
};

// ============================================================================
// SETTINGS API
// ============================================================================

const settingsAPI = {
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
  getPluginAiCapabilities: (pluginName: string) =>
    ipcRenderer.invoke("settings:getPluginAiCapabilities", pluginName),
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

  // History management
  historyGetAll: () => ipcRenderer.invoke("history:getAll"),
  historyGet: (id: string) => ipcRenderer.invoke("history:get", id),
  historyDelete: (id: string) => ipcRenderer.invoke("history:delete", id),
  historyDeleteAll: () => ipcRenderer.invoke("history:deleteAll"),
  historyGetAudioPath: (id: string) =>
    ipcRenderer.invoke("history:getAudioPath", id),
  historyGetSettings: () => ipcRenderer.invoke("history:getSettings"),
  historyUpdateSettings: (settings: {
    enabled?: boolean;
    maxRecordings?: number;
  }) => ipcRenderer.invoke("history:updateSettings", settings),
  historyGetStats: () => ipcRenderer.invoke("history:getStats"),
  historyAudioExists: (id: string) =>
    ipcRenderer.invoke("history:audioExists", id),
};

// ============================================================================
// ONBOARDING API
// ============================================================================

const onboardingAPI = {
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
  checkAccessibilityWithPrompt: () => {
    console.log("Preload:onboarding.checkAccessibilityWithPrompt -> main");
    return ipcRenderer.invoke("onboarding:checkAccessibilityWithPrompt");
  },
  waitForAccessibility: (options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
  }) => {
    console.log("Preload:onboarding.waitForAccessibility -> main", options);
    return ipcRenderer.invoke("onboarding:waitForAccessibility", options);
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

const onboardingElectronAPI = {
  validateApiKeyAndListModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("ai:validateKeyAndListModels", { baseUrl, apiKey }),
  validateAiConfiguration: (baseUrl: string, model: string, apiKey?: string) =>
    ipcRenderer.invoke("ai:validateConfiguration", { baseUrl, model, apiKey }),
};

// ============================================================================
// EXPOSE TO RENDERER
// ============================================================================

contextBridge.exposeInMainWorld("electronAPI", {
  ...dictationAPI,
  ...settingsAPI,
  ...onboardingElectronAPI,
});

contextBridge.exposeInMainWorld("onboardingAPI", onboardingAPI);
