import { contextBridge, ipcRenderer } from "electron";
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

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Animation trigger from main process
  onAnimateIn: (callback: () => void) => {
    ipcRenderer.on("animate-in", callback);
  },
  // Listeners for commands from main process
  onInitializeDictation: (callback: (data: DictationInitData) => void) => {
    ipcRenderer.on("initialize-dictation", (event, data) => callback(data));
  },

  onStartRecording: (callback: () => void) => {
    ipcRenderer.on("dictation-start-recording", callback);
  },

  onStopRecording: (callback: () => void) => {
    ipcRenderer.on("dictation-stop-recording", callback);
  },

  onTranscriptionUpdate: (callback: (update: TranscriptionUpdate) => void) => {
    ipcRenderer.on("dictation-transcription-update", (event, update) =>
      callback(update),
    );
  },

  onDictationComplete: (callback: (finalText: string) => void) => {
    ipcRenderer.on("dictation-complete", (event, finalText) =>
      callback(finalText),
    );
  },

  onDictationClear: (callback: () => void) => {
    ipcRenderer.on("dictation-clear", callback);
  },

  onSetStatus: (callback: (status: string) => void) => {
    ipcRenderer.on("dictation-set-status", (event, status) => callback(status));
  },

  onPlayEndSound: (callback: () => void) => {
    ipcRenderer.on("play-end-sound", callback);
  },

  onWindowHidden: (callback: () => void) => {
    ipcRenderer.on("window-hidden", callback);
  },

  onError: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },

  // Senders to main process
  closeDictationWindow: () => {
    ipcRenderer.send("close-dictation-window");
  },

  cancelDictation: () => {
    ipcRenderer.send("cancel-dictation");
  },

  // Window control
  minimizeWindow: () => {
    ipcRenderer.send("minimize-dictation-window");
  },

  // Debug/logging
  logMessage: (message: string) => {
    ipcRenderer.send("dictation-log", message);
  },

  // VAD audio processing
  sendAudioSegment: (audioData: Float32Array) => {
    ipcRenderer.send("vad-audio-segment", Array.from(audioData));
  },

  // Get selected microphone from settings
  getSelectedMicrophone: () => {
    return ipcRenderer.invoke("dictation:getSelectedMicrophone");
  },

  // Set selected microphone in settings
  setSelectedMicrophone: (deviceId: string) => {
    return ipcRenderer.invoke("dictation:setSelectedMicrophone", deviceId);
  },
});

// Declare the global interface for TypeScript
declare global {
  interface Window {
    electronAPI: {
      onAnimateIn: (callback: () => void) => void;
      onInitializeDictation: (
        callback: (data: DictationInitData) => void,
      ) => void;
      onStartRecording: (callback: () => void) => void;
      onStopRecording: (callback: () => void) => void;
      onTranscriptionUpdate: (
        callback: (update: TranscriptionUpdate) => void,
      ) => void;
      onDictationComplete: (callback: (finalText: string) => void) => void;
      onDictationClear: (callback: () => void) => void;
      onSetStatus: (callback: (status: string) => void) => void;
      onError: (callback: (payload: any) => void) => void;
      closeDictationWindow: () => void;
      cancelDictation: () => void;
      minimizeWindow: () => void;
      logMessage: (message: string) => void;
      onPlayEndSound: (callback: () => void) => void;
      onWindowHidden: (callback: () => void) => void;
      sendAudioSegment: (audioData: Float32Array) => void;
      getSelectedMicrophone: () => Promise<string>;
      setSelectedMicrophone: (deviceId: string) => Promise<{ success: boolean }>;
    };
  }
}
