import { contextBridge, ipcRenderer } from "electron";

export interface DictationInitData {
  selectedText: string;
  hasSelection: boolean;
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
  status: "listening" | "transforming";
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
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
      callback(update)
    );
  },

  onDictationComplete: (callback: (finalText: string) => void) => {
    ipcRenderer.on("dictation-complete", (event, finalText) =>
      callback(finalText)
    );
  },

  onDictationClear: (callback: () => void) => {
    ipcRenderer.on("dictation-clear", callback);
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
});

// Declare the global interface for TypeScript
declare global {
  interface Window {
    electronAPI: {
      onInitializeDictation: (
        callback: (data: DictationInitData) => void
      ) => void;
      onStartRecording: (callback: () => void) => void;
      onStopRecording: (callback: () => void) => void;
      onTranscriptionUpdate: (
        callback: (update: TranscriptionUpdate) => void
      ) => void;
      onDictationComplete: (callback: (finalText: string) => void) => void;
      onDictationClear: (callback: () => void) => void;
      onError: (callback: (payload: any) => void) => void;
      closeDictationWindow: () => void;
      cancelDictation: () => void;
      minimizeWindow: () => void;
      logMessage: (message: string) => void;
    };
  }
}
