import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  onAudioData: (callback: (data: Uint8Array) => void) => {
    ipcRenderer.on("audio-data", (_, data) => callback(data));
  },
  onAudioError: (callback: (error: string) => void) => {
    ipcRenderer.on("audio-error", (_, error) => callback(error));
  },
});
