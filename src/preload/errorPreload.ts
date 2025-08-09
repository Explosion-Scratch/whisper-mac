import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("errorAPI", {
  onData: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  act: (action: string) => ipcRenderer.send("error:action", action),
});
