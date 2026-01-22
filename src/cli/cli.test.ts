import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

declare global {
    namespace NodeJS {
        interface Process {
            readonly resourcesPath: string;
        }
    }
}

if (!process.resourcesPath) {
    if (existsSync(join(process.cwd(), "vendor"))) {
        (process as any).resourcesPath = process.cwd();
    } else {
        (process as any).resourcesPath = join(process.cwd());
    }
}

import { AppConfig } from "../config/AppConfig";
import { CliPluginManager } from "./CliPluginManager";

describe("CliPluginManager", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("should create plugin manager with all plugins registered", () => {
        const plugins = manager.getAllPlugins();
        expect(plugins.length).toBeGreaterThanOrEqual(6);
        
        const pluginNames = plugins.map(p => p.name);
        expect(pluginNames).toContain("parakeet");
        expect(pluginNames).toContain("whisper-cpp");
        expect(pluginNames).toContain("vosk");
        expect(pluginNames).toContain("yap");
        expect(pluginNames).toContain("gemini");
        expect(pluginNames).toContain("mistral");
    });

    test("should get plugin by name", () => {
        const parakeet = manager.getPlugin("parakeet");
        expect(parakeet).toBeDefined();
        expect(parakeet?.name).toBe("parakeet");

        const mistral = manager.getPlugin("mistral");
        expect(mistral).toBeDefined();
        expect(mistral?.name).toBe("mistral");
    });

    test("should return undefined for non-existent plugin", () => {
        const plugin = manager.getPlugin("non-existent-plugin");
        expect(plugin).toBeUndefined();
    });

    test("should get plugin info with correct structure", () => {
        const info = manager.getPluginInfo("parakeet");
        expect(info).toBeDefined();
        expect(info?.name).toBe("parakeet");
        expect(info?.displayName).toBe("Parakeet");
        expect(info?.requiresApiKey).toBe(false);
        expect(info?.requiresModelDownload).toBe(true);
        expect(info?.availableModels.length).toBeGreaterThan(0);
    });

    test("should identify cloud plugins correctly", () => {
        const geminiInfo = manager.getPluginInfo("gemini");
        expect(geminiInfo?.requiresApiKey).toBe(true);
        expect(geminiInfo?.requiresModelDownload).toBe(false);

        const mistralInfo = manager.getPluginInfo("mistral");
        expect(mistralInfo?.requiresApiKey).toBe(true);
        expect(mistralInfo?.requiresModelDownload).toBe(false);
    });

    test("should identify local plugins correctly", () => {
        const whisperInfo = manager.getPluginInfo("whisper-cpp");
        expect(whisperInfo?.requiresApiKey).toBe(false);
        expect(whisperInfo?.requiresModelDownload).toBe(true);

        const parakeetInfo = manager.getPluginInfo("parakeet");
        expect(parakeetInfo?.requiresApiKey).toBe(false);
        expect(parakeetInfo?.requiresModelDownload).toBe(true);
    });

    test("should get all plugin info", () => {
        const allInfo = manager.getAllPluginInfo();
        expect(allInfo.length).toBeGreaterThanOrEqual(6);
        
        for (const info of allInfo) {
            expect(info.name).toBeDefined();
            expect(info.displayName).toBeDefined();
            expect(info.version).toBeDefined();
            expect(info.description).toBeDefined();
            expect(typeof info.requiresApiKey).toBe("boolean");
            expect(typeof info.requiresModelDownload).toBe("boolean");
        }
    });

    test("should return config with correct data directory", () => {
        const cfg = manager.getConfig();
        expect(cfg).toBeDefined();
        expect(cfg.dataDir).toBeDefined();
        expect(cfg.dataDir).toContain("WhisperMac");
        expect(typeof cfg.getModelsDir()).toBe("string");
        expect(cfg.getModelsDir()).toContain("models");
    });
});

describe("CliPluginManager - Model Operations", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("should throw error for invalid plugin in downloadModel", async () => {
        await expect(
            manager.downloadModel("non-existent", "model")
        ).rejects.toThrow("Plugin 'non-existent' not found");
    });

    test("should throw error for cloud plugin in downloadModel", async () => {
        await expect(
            manager.downloadModel("gemini", "model")
        ).rejects.toThrow("does not require model downloads");
    });

    test("should throw error for invalid model name", async () => {
        await expect(
            manager.downloadModel("whisper-cpp", "invalid-model-name")
        ).rejects.toThrow("Invalid model");
    });

    test("should validate whisper model names", () => {
        const info = manager.getPluginInfo("whisper-cpp");
        const validModels = info?.availableModels.map(m => m.value) || [];
        
        expect(validModels).toContain("ggml-base.en.bin");
        expect(validModels).toContain("ggml-tiny.bin");
        expect(validModels).toContain("ggml-large-v3.bin");
    });

    test("should validate parakeet model names", () => {
        const info = manager.getPluginInfo("parakeet");
        const validModels = info?.availableModels.map(m => m.value) || [];
        
        expect(validModels).toContain("parakeet-tdt-0.6b-v2-onnx");
        expect(validModels).toContain("parakeet-tdt-0.6b-v3-onnx");
    });
});

describe("CliPluginManager - API Key Operations", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("should throw error for non-existent plugin in setApiKey", async () => {
        await expect(
            manager.setApiKey("non-existent", "key")
        ).rejects.toThrow("Plugin 'non-existent' not found");
    });

    test("should throw error for local plugin in setApiKey", async () => {
        await expect(
            manager.setApiKey("parakeet", "key")
        ).rejects.toThrow("does not require an API key");
    });

    test("should validate API key for non-existent plugin", async () => {
        const result = await manager.validateApiKey("non-existent", "key");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("not found");
    });
});

describe("Plugin Schema Validation", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("whisper-cpp plugin should have valid schema", () => {
        const plugin = manager.getPlugin("whisper-cpp");
        expect(plugin).toBeDefined();
        
        const schema = plugin!.getSchema();
        expect(schema.length).toBeGreaterThan(0);
        
        const modelOption = schema.find(s => s.key === "model");
        expect(modelOption).toBeDefined();
        expect(modelOption?.type).toBe("model-select");
        expect(modelOption?.options?.length).toBeGreaterThan(0);
        
        const languageOption = schema.find(s => s.key === "language");
        expect(languageOption).toBeDefined();
        expect(languageOption?.type).toBe("select");
    });

    test("parakeet plugin should have valid schema", () => {
        const plugin = manager.getPlugin("parakeet");
        expect(plugin).toBeDefined();
        
        const schema = plugin!.getSchema();
        expect(schema.length).toBeGreaterThan(0);
        
        const modelOption = schema.find(s => s.key === "model");
        expect(modelOption).toBeDefined();
        expect(modelOption?.type).toBe("model-select");
    });

    test("gemini plugin should have api-key in schema", () => {
        const plugin = manager.getPlugin("gemini");
        expect(plugin).toBeDefined();
        
        const schema = plugin!.getSchema();
        const apiKeyOption = schema.find(s => s.type === "api-key");
        expect(apiKeyOption).toBeDefined();
        expect(apiKeyOption?.key).toBe("api_key");
    });

    test("mistral plugin should have api-key in schema", () => {
        const plugin = manager.getPlugin("mistral");
        expect(plugin).toBeDefined();
        
        const schema = plugin!.getSchema();
        const apiKeyOption = schema.find(s => s.type === "api-key");
        expect(apiKeyOption).toBeDefined();
        expect(apiKeyOption?.key).toBe("api_key");
        
        const modelOption = schema.find(s => s.key === "model");
        expect(modelOption).toBeDefined();
        expect(modelOption?.options?.some(o => o.value.includes("voxtral"))).toBe(true);
    });
});

describe("Plugin Options", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("plugins should accept options", () => {
        const plugin = manager.getPlugin("whisper-cpp");
        expect(plugin).toBeDefined();
        
        plugin!.setOptions({ model: "ggml-tiny.bin", threads: 2 });
        const options = plugin!.getOptions();
        
        expect(options.model).toBe("ggml-tiny.bin");
        expect(options.threads).toBe(2);
    });

    test("mistral plugin should accept processing mode", () => {
        const plugin = manager.getPlugin("mistral");
        expect(plugin).toBeDefined();
        
        plugin!.setOptions({ processing_mode: "transcription_only" });
        const options = plugin!.getOptions();
        
        expect(options.processing_mode).toBe("transcription_only");
    });

    test("gemini plugin should accept model option", () => {
        const plugin = manager.getPlugin("gemini");
        expect(plugin).toBeDefined();
        
        plugin!.setOptions({ model: "gemini-2.5-flash" });
        const options = plugin!.getOptions();
        
        expect(options.model).toBe("gemini-2.5-flash");
    });
});

describe("Plugin Initialization", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("should fail initialization for cloud plugin without api-key", async () => {
        const result = await manager.initializePlugin("gemini", {});
        expect(result).toBe(false);
    });

    test("should pass options during initialization", () => {
        const plugin = manager.getPlugin("whisper-cpp");
        expect(plugin).toBeDefined();
        
        plugin!.setOptions({ model: "ggml-base.en.bin" });
        const options = plugin!.getOptions();
        
        expect(options.model).toBe("ggml-base.en.bin");
    });

    test("should check if model exists in app data directory", () => {
        const cfg = manager.getConfig();
        const modelsDir = cfg.getModelsDir();
        
        expect(modelsDir).toContain("WhisperMac");
        expect(modelsDir).toContain("models");
        
        if (existsSync(modelsDir)) {
            const { readdirSync } = require("fs");
            const files = readdirSync(modelsDir);
            console.log(`Found ${files.length} items in models directory`);
        }
    });
});

describe("PluginInfo Interface", () => {
    let config: AppConfig;
    let manager: CliPluginManager;

    beforeAll(() => {
        config = new AppConfig();
        manager = new CliPluginManager(config);
    });

    test("all plugins should have complete PluginInfo", () => {
        const allInfo = manager.getAllPluginInfo();
        
        for (const info of allInfo) {
            expect(info.name).toBeTruthy();
            expect(info.displayName).toBeTruthy();
            expect(info.version).toBeTruthy();
            expect(info.description).toBeTruthy();
            expect(typeof info.supportsRealtime).toBe("boolean");
            expect(typeof info.supportsBatchProcessing).toBe("boolean");
            expect(typeof info.requiresApiKey).toBe("boolean");
            expect(typeof info.requiresModelDownload).toBe("boolean");
            expect(Array.isArray(info.availableModels)).toBe(true);
        }
    });

    test("cloud plugins should not have model downloads", () => {
        const cloudPlugins = ["gemini", "mistral"];
        
        for (const name of cloudPlugins) {
            const info = manager.getPluginInfo(name);
            expect(info?.requiresModelDownload).toBe(false);
            expect(info?.requiresApiKey).toBe(true);
        }
    });

    test("local plugins should require model downloads", () => {
        const localPlugins = ["whisper-cpp", "parakeet"];
        
        for (const name of localPlugins) {
            const info = manager.getPluginInfo(name);
            expect(info?.requiresModelDownload).toBe(true);
            expect(info?.requiresApiKey).toBe(false);
        }
    });
});

describe("CLI uses same paths as app", () => {
    test("should use WhisperMac app data directory", () => {
        const config = new AppConfig();
        expect(config.dataDir).toContain("WhisperMac");
    });

    test("models directory should be inside app data directory", () => {
        const config = new AppConfig();
        expect(config.getModelsDir()).toBe(join(config.dataDir, "models"));
    });

    test("cache directory should be inside app data directory", () => {
        const config = new AppConfig();
        expect(config.getCacheDir()).toBe(join(config.dataDir, "cache"));
    });
});
