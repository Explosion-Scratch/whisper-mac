import { contextBridge, ipcRenderer } from "electron";

export interface StateAPI {
  getState: (path?: string) => Promise<any>;
  setState: (updates: any) => Promise<{ success: boolean }>;
  subscribe: (path: string, callback: (value: any) => void) => Promise<{ unsubscribe: () => void }>;
  action: (action: string, payload?: any) => Promise<{ success: boolean; error?: string; result?: any }>;
  onBroadcast: (callback: (state: any) => void) => () => void;
  sync: () => void;
}

const subscriptionCallbacks = new Map<string, (value: any) => void>();

ipcRenderer.on("state:changed", (_event, data: { path: string; value: any }) => {
  for (const [id, callback] of subscriptionCallbacks) {
    if (id.includes(`:${data.path}:`)) {
      callback(data.value);
    }
  }
});

const stateAPI: StateAPI = {
  getState: async (path?: string) => {
    return ipcRenderer.invoke("state:get", path);
  },

  setState: async (updates: any) => {
    return ipcRenderer.invoke("state:set", updates);
  },

  subscribe: async (path: string, callback: (value: any) => void) => {
    const result = await ipcRenderer.invoke("state:subscribe", path);
    const { subscriptionId, currentValue } = result;
    
    subscriptionCallbacks.set(subscriptionId, callback);
    
    callback(currentValue);
    
    return {
      unsubscribe: () => {
        subscriptionCallbacks.delete(subscriptionId);
        ipcRenderer.invoke("state:unsubscribe", subscriptionId).catch(() => {});
      },
    };
  },

  action: async (action: string, payload?: any) => {
    return ipcRenderer.invoke("state:action", action, payload);
  },

  onBroadcast: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on("state:broadcast", handler);
    return () => {
      ipcRenderer.removeListener("state:broadcast", handler);
    };
  },

  sync: () => {
    ipcRenderer.send("state:sync-request");
  },
};

export function exposeStateAPI(): void {
  contextBridge.exposeInMainWorld("stateAPI", stateAPI);
}

declare global {
  interface Window {
    stateAPI: StateAPI;
  }
}
