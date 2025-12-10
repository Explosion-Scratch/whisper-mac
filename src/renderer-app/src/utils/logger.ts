/**
 * Creates a console method wrapper that attempts to deep-clone arguments
 * using JSON.stringify/JSON.parse before delegating to the underlying
 * console method. Falls back to original arguments on failure.
 * 
 * This is useful for logging reactive Vue objects and Electron IPC data
 * without proxy/circular reference issues.
 */
export function createCloningLogger(methodName: keyof Console) {
  return (...args: unknown[]) => {
    try {
      const clonedArgs = args.map((arg) => {
        try {
          return JSON.parse(JSON.stringify(arg));
        } catch (_) {
          return arg;
        }
      });
      (console[methodName] as (...args: unknown[]) => void)(...clonedArgs);
    } catch (_) {
      try {
        (console[methodName] as (...args: unknown[]) => void)(...args);
      } catch (_) {}
    }
  };
}

export const log = createCloningLogger("log");
export const info = createCloningLogger("info");
export const warn = createCloningLogger("warn");
export const error = createCloningLogger("error");
export const debug = createCloningLogger("debug");

declare global {
  interface Window {
    log: typeof log;
    info: typeof info;
    warn: typeof warn;
    error: typeof error;
  }
}

if (typeof window !== "undefined") {
  window.log = log;
  window.info = info;
  window.warn = warn;
  window.error = error;
  (window as unknown as { debug: typeof debug }).debug = debug;
}
