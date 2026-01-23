import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

const g: any = globalThis as any;
if (g && g.__electronLog && typeof g.__electronLog.log === "function") {
  Object.assign(console, g.__electronLog);
}

export interface DictationInitData {
  selectedText: string;
  hasSelection: boolean;
  isRunOnAll?: boolean;
}

export interface TranscriptionSegment {
  id: string;
  type: "inprogress" | "transcribed" | "selected";
  text: string;
  completed?: boolean;
  start?: number;
  end?: number;
  timestamp: number;
  confidence?: number;
  originalText?: string;
  hasSelection?: boolean;
}

export interface TranscriptionUpdate {
  segments: TranscriptionSegment[];
}

type ListenerCleanupFn = () => void;
const activeListeners: ListenerCleanupFn[] = [];

function createListenerWithCleanup<T>(
  channel: string,
  callback: (data: T) => void,
): ListenerCleanupFn {
  const handler = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  const cleanup = () => ipcRenderer.removeListener(channel, handler);
  activeListeners.push(cleanup);
  return cleanup;
}

function createSimpleListenerWithCleanup(
  channel: string,
  callback: () => void,
): ListenerCleanupFn {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  const cleanup = () => ipcRenderer.removeListener(channel, handler);
  activeListeners.push(cleanup);
  return cleanup;
}

contextBridge.exposeInMainWorld("electronAPI", {
  onAnimateIn: (callback: () => void) => {
    return createSimpleListenerWithCleanup("animate-in", callback);
  },

  onInitializeDictation: (callback: (data: DictationInitData) => void) => {
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

  onTranscriptionUpdate: (callback: (update: TranscriptionUpdate) => void) => {
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

  onAudioLevel: (callback: (level: number) => void) => {
    return createListenerWithCleanup("dictation-audio-level", callback);
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

  getSelectedMicrophone: () => {
    return ipcRenderer.invoke("dictation:getSelectedMicrophone");
  },

  setSelectedMicrophone: (deviceId: string) => {
    return ipcRenderer.invoke("dictation:setSelectedMicrophone", deviceId);
  },

  cleanup: () => {
    for (const cleanup of activeListeners) {
      try {
        cleanup();
      } catch {}
    }
    activeListeners.length = 0;
  },
});

declare global {
  interface Window {
    electronAPI: {
      onAnimateIn: (callback: () => void) => () => void;
      onInitializeDictation: (
        callback: (data: DictationInitData) => void,
      ) => () => void;
      onDictationStartRecording: (callback: () => void) => () => void;
      onDictationStopRecording: (callback: () => void) => () => void;
      onTranscriptionUpdate: (
        callback: (update: TranscriptionUpdate) => void,
      ) => () => void;
      onDictationComplete: (
        callback: (finalText: string) => void,
      ) => () => void;
      onDictationClear: (callback: () => void) => () => void;
      onDictationStatus: (callback: (status: string) => void) => () => void;
      onAudioLevel: (callback: (level: number) => void) => () => void;
      onError: (callback: (payload: any) => void) => () => void;
      closeDictationWindow: () => void;
      cancelDictation: () => void;
      minimizeWindow: () => void;
      logMessage: (message: string) => void;
      onPlayEndSound: (callback: () => void) => () => void;
      onWindowHidden: (callback: () => void) => () => void;
      onFlushPendingAudio: (callback: () => void) => () => void;
      sendAudioSegment: (audioData: Float32Array) => void;
      sendDictationWindowReady: () => void;
      getSelectedMicrophone: () => Promise<string>;
      setSelectedMicrophone: (
        deviceId: string,
      ) => Promise<{ success: boolean }>;
      cleanup: () => void;
    };
  }
}
