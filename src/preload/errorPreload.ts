import { contextBridge, ipcRenderer } from "electron";
const g: any = globalThis as any;
if (g && g.__electronLog && typeof g.__electronLog.log === "function") {
  Object.assign(console, g.__electronLog);
}

contextBridge.exposeInMainWorld("errorAPI", {
  onData: (callback: (payload: any) => void) => {
    ipcRenderer.on("error:data", (_e, payload) => callback(payload));
  },
  act: (action: string) => ipcRenderer.send("error:action", action),
});
