/**
 * Renderer-side PromiseManager bridge for cross-process coordination
 */
export class RendererPromiseManager {
  private static instance: RendererPromiseManager;

  private constructor() {}

  static getInstance(): RendererPromiseManager {
    if (!RendererPromiseManager.instance) {
      RendererPromiseManager.instance = new RendererPromiseManager();
    }
    return RendererPromiseManager.instance;
  }

  async waitFor(promiseName: string, timeout?: number): Promise<any> {
    if (window.require) {
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke(
        "promiseManager:waitFor",
        promiseName,
        timeout,
      );
    }
    throw new Error("IPC not available in this context");
  }

  async start(promiseName: string, data?: any): Promise<boolean> {
    if (window.require) {
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke(
        "promiseManager:start",
        promiseName,
        data,
      );
    }
    return false;
  }

  async resolve(promiseName: string, data?: any): Promise<boolean> {
    if (window.require) {
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke(
        "promiseManager:resolve",
        promiseName,
        data,
      );
    }
    return false;
  }

  async reject(promiseName: string, error?: any): Promise<boolean> {
    if (window.require) {
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke(
        "promiseManager:reject",
        promiseName,
        error,
      );
    }
    return false;
  }

  async cancel(promiseName: string): Promise<boolean> {
    if (window.require) {
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke("promiseManager:cancel", promiseName);
    }
    return false;
  }

  async getStatus(promiseName: string): Promise<string> {
    if (window.require) {
      const { ipcRenderer } = window.require("electron");
      return await ipcRenderer.invoke("promiseManager:getStatus", promiseName);
    }
    return "not-found";
  }
}

export const rendererPromiseManager = RendererPromiseManager.getInstance();
