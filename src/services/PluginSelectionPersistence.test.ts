import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the real handlers without starting Electron or touching user settings.
function loadService(file: string, dependencies: Record<string, any>) {
  const exports: Record<string, any> = {};
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  );
  runInNewContext(outputText, {
    exports,
    require: (name: string) => dependencies[name] || {},
    console: { log() {}, error() {}, warn() {} },
  });
  return exports;
}

test("tray selection does not mutate saved settings or write to disk", async () => {
  let writes = 0;
  const { TrayService } = loadService("./TrayService.ts", {
    "../core/AppStore": { appStore: { select: (fn: any) => fn({ app: { status: "idle" } }) } },
  });
  const tray = Object.create(TrayService.prototype);
  Object.assign(tray, {
    settingsManager: { set() { writes++; }, saveSettings() { writes++; } },
    pluginManager: {
      activatePluginWithFallback: async () => ({ success: true, activePlugin: "whisper-cpp", pluginChanged: false }),
      getPlugin: () => ({ displayName: "Whisper.cpp" }),
    },
    notificationService: { sendErrorNotification: async (message: string) => { throw new Error(message); } },
    updateTrayMenu() {},
  });
  await tray.activatePlugin("whisper-cpp");
  expect(writes).toBe(0);
});

test("Settings plugin selection is session-only until explicit Save", async () => {
  const handlers = new Map<string, Function>();
  const { SettingsService } = loadService("./SettingsService.ts", {
    electron: { ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn), on() {} } },
  });
  let saved = { transcriptionPlugin: "yap" };
  let draft = { ...saved };
  let active = "yap";
  let writes = 0;
  const service = Object.create(SettingsService.prototype);
  Object.assign(service, {
    settingsManager: {
      getAll: () => ({ ...draft }),
      getRestartRequiredChanges: () => [],
      set: (key: string, value: string) => { (draft as any)[key] = value; },
      setAll: (value: typeof draft) => { draft = { ...value }; },
      saveSettings: () => { saved = { ...draft }; writes++; },
      applyToConfig() {},
    },
    unifiedModelDownloadService: { switchToPlugin: async (name: string) => { active = name; } },
    broadcastSettingsUpdate() {},
  });
  service.setupIpcHandlers();
  await handlers.get("settings:switchPlugin")!({ sender: { send() {} } }, { pluginName: "whisper-cpp" });
  expect(active).toBe("whisper-cpp");
  expect(saved.transcriptionPlugin).toBe("yap");
  expect(draft.transcriptionPlugin).toBe("yap");
  expect(writes).toBe(0);
  await handlers.get("settings:save")!({}, { transcriptionPlugin: active });
  expect(saved.transcriptionPlugin).toBe("whisper-cpp");
  expect(writes).toBe(1);
});
