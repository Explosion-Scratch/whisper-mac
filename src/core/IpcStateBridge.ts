import { ipcMain, BrowserWindow, WebContents } from "electron";
import { appStore, AppState } from "./AppStore";

type StateSlice = keyof AppState;
type StatePath = string;

interface StateSubscription {
  webContentsId: number;
  path: StatePath;
  unsubscribe: () => void;
}

export class IpcStateBridge {
  private static instance: IpcStateBridge;
  private subscriptions: Map<string, StateSubscription> = new Map();
  private isInitialized = false;

  private constructor() {}

  static getInstance(): IpcStateBridge {
    if (!IpcStateBridge.instance) {
      IpcStateBridge.instance = new IpcStateBridge();
    }
    return IpcStateBridge.instance;
  }

  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    ipcMain.handle("state:get", (_event, path?: StatePath) => {
      if (path) {
        return this.getStatePath(path);
      }
      return appStore.getSerializableState();
    });

    ipcMain.handle("state:set", (_event, updates: Partial<AppState>) => {
      appStore.setState(updates);
      return { success: true };
    });

    ipcMain.handle("state:subscribe", (event, path: StatePath) => {
      const subscriptionId = `${event.sender.id}:${path}:${Date.now()}`;

      const selector = this.createSelectorFromPath(path);
      const unsubscribe = appStore.subscribe(selector, (value) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send("state:changed", { path, value });
          } else {
            this.removeSubscription(subscriptionId);
          }
        } catch {
          this.removeSubscription(subscriptionId);
        }
      });

      this.subscriptions.set(subscriptionId, {
        webContentsId: event.sender.id,
        path,
        unsubscribe,
      });

      return { subscriptionId, currentValue: selector(appStore.getState()) };
    });

    ipcMain.handle("state:unsubscribe", (_event, subscriptionId: string) => {
      this.removeSubscription(subscriptionId);
      return { success: true };
    });

    ipcMain.handle("state:action", (_event, action: string, payload?: any) => {
      return this.handleAction(action, payload);
    });

    ipcMain.on("state:sync-request", (event) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send("state:sync", appStore.getSerializableState());
        }
      } catch {}
    });
  }

  private getStatePath(path: string): any {
    const parts = path.split(".");
    let value: any = appStore.getState();
    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }
    return value;
  }

  private createSelectorFromPath(path: string): (state: AppState) => any {
    const parts = path.split(".");
    return (state: AppState) => {
      let value: any = state;
      for (const part of parts) {
        if (value === undefined || value === null) return undefined;
        value = value[part];
      }
      return value;
    };
  }

  private removeSubscription(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(subscriptionId);
    }
  }

  private handleAction(
    action: string,
    payload?: any,
  ): { success: boolean; error?: string; result?: any } {
    try {
      switch (action) {
        case "setDictationState":
          appStore.setDictationState(payload.state, payload.sessionId);
          return { success: true };

        case "setAppStatus":
          appStore.setAppStatus(payload);
          return { success: true };

        case "setActivePlugin":
          appStore.setActivePlugin(payload);
          return { success: true };

        case "setPermission":
          appStore.setPermission(payload.type, payload.status);
          return { success: true };

        case "setUIState":
          appStore.setUIState(payload);
          return { success: true };

        case "setSetting":
          appStore.setSetting(payload.key, payload.value);
          return { success: true };

        case "clearSegments":
          appStore.clearSegments();
          return { success: true };

        case "reset":
          appStore.reset();
          return { success: true };

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  broadcastState(slice?: StateSlice): void {
    const state = slice
      ? { [slice]: appStore.getState()[slice] }
      : appStore.getSerializableState();

    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (
          !win.isDestroyed() &&
          win.webContents &&
          !win.webContents.isDestroyed()
        ) {
          win.webContents.send("state:broadcast", state);
        }
      } catch {}
    }
  }

  cleanupWindowSubscriptions(webContentsId: number): void {
    for (const [id, sub] of this.subscriptions) {
      if (sub.webContentsId === webContentsId) {
        this.removeSubscription(id);
      }
    }
  }

  cleanup(): void {
    console.log("Cleaning up IpcStateBridge...");
    for (const [id] of this.subscriptions) {
      this.removeSubscription(id);
    }
    this.subscriptions.clear();

    ipcMain.removeHandler("state:get");
    ipcMain.removeHandler("state:set");
    ipcMain.removeHandler("state:subscribe");
    ipcMain.removeHandler("state:unsubscribe");
    ipcMain.removeHandler("state:action");
    ipcMain.removeAllListeners("state:sync-request");

    this.isInitialized = false;
  }
}

export const ipcStateBridge = IpcStateBridge.getInstance();
