import { EventEmitter } from "events";

export type AppEvents = "dictation-window-shown" | "dictation-window-hidden";

class AppEventBus extends EventEmitter {}

export const appEventBus = new AppEventBus();
