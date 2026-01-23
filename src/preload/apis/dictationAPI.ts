import { ipcRenderer, IpcRendererEvent } from "electron";

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

export const dictationAPI = {
  onAnimateIn: (callback: () => void) => {
    return createSimpleListenerWithCleanup("animate-in", callback);
  },
  onInitializeDictation: (callback: (data: any) => void) => {
    return createListenerWithCleanup("initialize-dictation", callback);
  },
  onStartRecording: (callback: () => void) => {
    return createSimpleListenerWithCleanup(
      "dictation-start-recording",
      callback,
    );
  },
  onStopRecording: (callback: () => void) => {
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
  onSetStatus: (callback: (status: string) => void) => {
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
};
