import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  AppConfig,
  AiTransformationConfig,
  DictationWindowPosition,
} from "./AppConfig";
import {
  getDefaultSettings,
  validateSettings,
  SETTINGS_SCHEMA,
} from "./SettingsSchema";

export class SettingsManager {
  private settingsPath: string;
  private settings: Record<string, any>;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.settingsPath = join(config.dataDir, "settings.json");
    this.settings = this.loadSettings();
  }

  private loadSettings(): Record<string, any> {
    try {
      if (existsSync(this.settingsPath)) {
        const data = readFileSync(this.settingsPath, "utf8");
        const loaded = JSON.parse(data);

        // Merge with defaults to ensure all keys exist
        const defaults = getDefaultSettings();
        return this.mergeDeep(defaults, loaded);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }

    return getDefaultSettings();
  }

  private mergeDeep(target: any, source: any): any {
    const output = { ...target };

    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.mergeDeep(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }

    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === "object" && !Array.isArray(item);
  }

  saveSettings(): void {
    try {
      // Ensure directory exists
      const dir = join(this.settingsPath, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Validate settings before saving
      const errors = validateSettings(this.settings);
      if (Object.keys(errors).length > 0) {
        console.error("Settings validation errors:", errors);
        // Still save, but log errors
      }

      writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
      console.log("Settings saved to:", this.settingsPath);
    } catch (error) {
      console.error("Failed to save settings:", error);
      throw error;
    }
  }

  get<T>(key: string, defaultValue?: T): T {
    const keys = key.split(".");
    let current = this.settings;

    for (const k of keys) {
      if (current && typeof current === "object" && k in current) {
        current = current[k];
      } else {
        return defaultValue as T;
      }
    }

    return current as T;
  }

  set(key: string, value: any): void {
    const keys = key.split(".");
    let current = this.settings;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== "object") {
        current[k] = {};
      }
      current = current[k];
    }

    current[keys[keys.length - 1]] = value;
  }

  getAll(): Record<string, any> {
    return { ...this.settings };
  }

  setAll(newSettings: Record<string, any>): void {
    this.settings = this.mergeDeep(getDefaultSettings(), newSettings);
  }

  reset(): void {
    this.settings = getDefaultSettings();
  }

  resetSection(sectionId: string): void {
    const defaults = getDefaultSettings();
    const section = SETTINGS_SCHEMA.find((s) => s.id === sectionId);

    if (section) {
      section.fields.forEach((field) => {
        const keys = field.key.split(".");
        let currentDefaults = defaults;
        let currentSettings = this.settings;

        for (let i = 0; i < keys.length - 1; i++) {
          currentDefaults = currentDefaults[keys[i]];
          if (!currentSettings[keys[i]]) {
            currentSettings[keys[i]] = {};
          }
          currentSettings = currentSettings[keys[i]];
        }

        const finalKey = keys[keys.length - 1];
        currentSettings[finalKey] = currentDefaults[finalKey];
      });
    }
  }

  /**
   * Apply current settings to the AppConfig instance
   */
  applyToConfig(): void {
    // Basic settings
    this.config.serverPort = this.get("serverPort", 9090);
    this.config.defaultModel = this.get(
      "defaultModel",
      "Systran/faster-whisper-tiny.en"
    );

    // Dictation window settings
    this.config.dictationWindowPosition = this.get(
      "dictationWindowPosition",
      "screen-corner"
    ) as DictationWindowPosition;
    this.config.dictationWindowWidth = this.get("dictationWindowWidth", 400);
    this.config.dictationWindowHeight = this.get("dictationWindowHeight", 50);
    this.config.dictationWindowOpacity = this.get(
      "dictationWindowOpacity",
      0.95
    );
    this.config.showDictationWindowAlways = this.get(
      "showDictationWindowAlways",
      false
    );

    // Text processing
    this.config.transformTrim = this.get("transformTrim", true);

    // AI settings
    const aiConfig: AiTransformationConfig = {
      enabled: this.get("ai.enabled", true),
      baseUrl: this.get(
        "ai.baseUrl",
        "https://api.cerebras.ai/v1/chat/completions"
      ),
      envKey: this.get("ai.envKey", "CEREBRAS"),
      model: this.get("ai.model", "qwen-3-32b"),
      stream: this.get("ai.stream", true),
      maxTokens: this.get("ai.maxTokens", 16382),
      temperature: this.get("ai.temperature", 0.6),
      topP: this.get("ai.topP", 0.95),
      prompt: this.get("ai.prompt", this.config.ai.prompt),
      messagePrompt: this.get("ai.messagePrompt", this.config.ai.messagePrompt),
    };
    this.config.ai = aiConfig;

    // Advanced settings
    const dataDir = this.get<string>("dataDir");
    if (
      dataDir &&
      typeof dataDir === "string" &&
      dataDir !== this.config.dataDir
    ) {
      this.config.setDataDir(dataDir);
    }
  }

  /**
   * Load settings from current AppConfig instance
   */
  loadFromConfig(): void {
    // Basic settings
    this.set("serverPort", this.config.serverPort);
    this.set("defaultModel", this.config.defaultModel);

    // Dictation window settings
    this.set("dictationWindowPosition", this.config.dictationWindowPosition);
    this.set("dictationWindowWidth", this.config.dictationWindowWidth);
    this.set("dictationWindowHeight", this.config.dictationWindowHeight);
    this.set("dictationWindowOpacity", this.config.dictationWindowOpacity);
    this.set(
      "showDictationWindowAlways",
      this.config.showDictationWindowAlways
    );

    // Text processing
    this.set("transformTrim", this.config.transformTrim);

    // AI settings
    this.set("ai.enabled", this.config.ai.enabled);
    this.set("ai.baseUrl", this.config.ai.baseUrl);
    this.set("ai.envKey", this.config.ai.envKey);
    this.set("ai.model", this.config.ai.model);
    this.set("ai.stream", this.config.ai.stream);
    this.set("ai.maxTokens", this.config.ai.maxTokens);
    this.set("ai.temperature", this.config.ai.temperature);
    this.set("ai.topP", this.config.ai.topP);
    this.set("ai.prompt", this.config.ai.prompt);
    this.set("ai.messagePrompt", this.config.ai.messagePrompt);

    // Advanced settings
    this.set("dataDir", this.config.dataDir);
  }

  exportSettings(): string {
    return JSON.stringify(this.settings, null, 2);
  }

  importSettings(jsonString: string): void {
    try {
      const imported = JSON.parse(jsonString);
      const errors = validateSettings(imported);

      if (Object.keys(errors).length > 0) {
        throw new Error(`Validation errors: ${JSON.stringify(errors)}`);
      }

      this.setAll(imported);
    } catch (error) {
      console.error("Failed to import settings:", error);
      throw error;
    }
  }
}
