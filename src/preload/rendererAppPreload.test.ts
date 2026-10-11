import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("Settings' actual preload exposes plugin updates and listener cleanup", () => {
  const ipcRenderer = new EventEmitter();
  const exposed: Record<string, any> = {};
  const source = readFileSync(new URL("./rendererAppPreload.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });

  runInNewContext(outputText, {
    exports: {},
    require: (name: string) => {
      if (name !== "electron") throw new Error(`Unexpected preload import: ${name}`);
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; },
        },
      };
    },
  });

  expect(typeof exposed.electronAPI.onActivePluginUpdated).toBe("function");
  const selections: string[] = [];
  const cleanup = exposed.electronAPI.onActivePluginUpdated((name: string) => selections.push(name));
  ipcRenderer.emit("settings:activePluginUpdated", {}, "whisper-cpp");
  ipcRenderer.emit("settings:activePluginUpdated", {}, "parakeet");
  expect(selections).toEqual(["whisper-cpp", "parakeet"]);
  cleanup();
  ipcRenderer.emit("settings:activePluginUpdated", {}, "yap");
  expect(selections).toEqual(["whisper-cpp", "parakeet"]);
  expect(ipcRenderer.listenerCount("settings:activePluginUpdated")).toBe(0);
});
