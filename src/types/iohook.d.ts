declare module "iohook" {
  export type IoHookEvent = {
    keycode?: number;
    rawcode?: number;
    type: string;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  };

  export type IoHookEventHandler = (event: IoHookEvent) => void;

  export interface IoHookModule {
    on(event: "keydown" | "keyup", handler: IoHookEventHandler): IoHookModule;
    on(event: string, handler: IoHookEventHandler): IoHookModule;
    off?(event: "keydown" | "keyup", handler: IoHookEventHandler): IoHookModule;
    off?(event: string, handler: IoHookEventHandler): IoHookModule;
    removeListener?(event: "keydown" | "keyup", handler: IoHookEventHandler): IoHookModule;
    removeListener?(event: string, handler: IoHookEventHandler): IoHookModule;
    removeAllListeners?(event?: string): IoHookModule;
    start(): void;
    stop(): void;
  }

  const ioHook: IoHookModule;
  export default ioHook;
}
