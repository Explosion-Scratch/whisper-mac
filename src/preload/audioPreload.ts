import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Listeners for commands from main process
  onStartCapture: (callback: () => void) => {
    ipcRenderer.on("start-audio-capture", callback);
  },
  onStopCapture: (callback: () => void) => {
    ipcRenderer.on("stop-audio-capture", callback);
  },

  // Senders to main process
  sendAudioData: (data: Float32Array) => {
    ipcRenderer.send("audio-data", data);
  },
  sendAudioError: (error: string) => {
    ipcRenderer.send("audio-error", error);
  },
  sendAudioCaptureStarted: () => {
    ipcRenderer.send("audio-capture-started");
  },
  sendAudioCaptureStopped: () => {
    ipcRenderer.send("audio-capture-stopped");
  },
});
