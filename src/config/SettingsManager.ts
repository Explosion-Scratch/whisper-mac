import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "fs";
import { EventEmitter } from "events";
import {
  AppConfig,
  AiTransformationConfig,
  DictationWindowPosition,
} from "./AppConfig";
import { DefaultActionsConfig } from "../types/ActionTypes";
import {
  getDefaultSettings,
  validateSettings,
  SETTINGS_SCHEMA,
} from "./SettingsSchema";

export class SettingsManager extends EventEmitter {
  private settingsPath: string;
  private settings: Record<string, any>;
  private config: AppConfig;
  private previousDataDir: string;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.settingsPath = join(config.dataDir, "settings.json");
    this.settings = this.loadSettings();
    this.previousDataDir = config.dataDir;
    console.log("Data dir (settingsmanager)", this.config.dataDir);
    // Check if we need to migrate data on startup
    const currentDataDir = this.get<string>("dataDir");
    if (
      currentDataDir &&
      typeof currentDataDir === "string" &&
      currentDataDir !== this.config.dataDir
    ) {
      console.log(
        "Migrating data directory",
        this.config.dataDir,
        currentDataDir
      );
      this.migrateDataDirectory(this.config.dataDir, currentDataDir);
      this.config.setDataDir(currentDataDir);
      this.updateSettingsPath();
    }
  }

  private loadSettings(): Record<string, any> {
    try {
      if (existsSync(this.settingsPath)) {
        const data = readFileSync(this.settingsPath, "utf8");
        const loaded = JSON.parse(data);

        // Merge with defaults to ensure all keys exist
        const defaults = getDefaultSettings();
        const settings = this.mergeDeep(defaults, loaded);

        // Check if dataDir in loaded settings differs from current config
        const loadedDataDir = settings.dataDir;
        if (
          loadedDataDir &&
          typeof loadedDataDir === "string" &&
          loadedDataDir !== this.config.dataDir
        ) {
          console.log(
            `Settings loaded from different data directory: ${loadedDataDir}`
          );
          this.previousDataDir = loadedDataDir;
        }

        return settings;
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

    // If dataDir changed, migrate data
    if (
      key === "dataDir" &&
      typeof value === "string" &&
      value !== this.previousDataDir
    ) {
      this.migrateDataDirectory(this.previousDataDir, value);
      this.previousDataDir = value;
    }
  }

  getAll(): Record<string, any> {
    return { ...this.settings };
  }

  setAll(newSettings: Record<string, any>): void {
    const oldDataDir = this.get<string>("dataDir");
    this.settings = this.mergeDeep(getDefaultSettings(), newSettings);

    // Check if dataDir changed and migrate if necessary
    const newDataDir = this.get<string>("dataDir");
    if (
      newDataDir &&
      typeof newDataDir === "string" &&
      newDataDir !== oldDataDir
    ) {
      this.migrateDataDirectory(oldDataDir, newDataDir);
      this.previousDataDir = newDataDir;
    }
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
    // Plugin selection is now handled by the unified plugin system

    // Dictation window settings
    this.config.dictationWindowPosition = this.get(
      "dictationWindowPosition",
      "screen-corner"
    ) as DictationWindowPosition;
    this.config.dictationWindowWidth = this.get("dictationWindowWidth", 400);
    this.config.dictationWindowHeight = this.get("dictationWindowHeight", 50);
    this.config.showDictationWindowAlways = this.get(
      "showDictationWindowAlways",
      false
    );

    // Text processing
    this.config.transformTrim = this.get("transformTrim", true);

    // AI settings
    const aiConfig: AiTransformationConfig = {
      enabled: this.get("ai.enabled", true),
      writingStyle: this.get("ai.writingStyle", this.config.ai.writingStyle),
      baseUrl: this.get(
        "ai.baseUrl",
        "https://api.cerebras.ai/v1/chat/completions"
      ),
      model: this.get("ai.model", "qwen-3-32b"),
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
      console.log("Setting data dir", dataDir);
      this.config.setDataDir(dataDir);
      // Update settings path to new location
      this.updateSettingsPath();
    }

    // Notify about actions configuration changes
    this.emit?.("actions-updated", this.get<DefaultActionsConfig>("actions"));
  }

  /**
   * Load settings from current AppConfig instance
   */
  loadFromConfig(): void {
    // Plugin selection is now handled by the unified plugin system

    // Dictation window settings
    this.set("dictationWindowPosition", this.config.dictationWindowPosition);
    this.set("dictationWindowWidth", this.config.dictationWindowWidth);
    this.set("dictationWindowHeight", this.config.dictationWindowHeight);
    this.set(
      "showDictationWindowAlways",
      this.config.showDictationWindowAlways
    );

    // Text processing
    this.set("transformTrim", this.config.transformTrim);

    // AI settings
    this.set("ai.enabled", this.config.ai.enabled);
    this.set("ai.writingStyle", this.config.ai.writingStyle);
    this.set("ai.baseUrl", this.config.ai.baseUrl);
    this.set("ai.model", this.config.ai.model);
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

  /**
   * Get the current settings file path
   */
  getSettingsPath(): string {
    return this.settingsPath;
  }

  /**
   * Update settings path when data directory changes
   */
  private updateSettingsPath(): void {
    const dataDir = this.get<string>("dataDir");
    if (dataDir && typeof dataDir === "string") {
      this.settingsPath = join(dataDir, "settings.json");
    }
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

  /**
   * Migrate data from old directory to new directory
   */
  private migrateDataDirectory(oldDir: string, newDir: string): void {
    try {
      if (!existsSync(oldDir) || oldDir === newDir) {
        return;
      }

      console.log(`Migrating data from ${oldDir} to ${newDir}`);

      // Ensure new directory exists
      if (!existsSync(newDir)) {
        mkdirSync(newDir, { recursive: true });
      }

      // Ensure subdirectories exist in new location
      const subdirs = ["models", "cache"];
      subdirs.forEach((subdir) => {
        const subdirPath = join(newDir, subdir);
        if (!existsSync(subdirPath)) {
          mkdirSync(subdirPath, { recursive: true });
        }
      });

      // Copy all contents from old directory to new directory
      this.copyDirectoryRecursive(oldDir, newDir);

      // Verify that the migration was successful by checking if key directories exist
      const expectedDirs = ["models", "cache"];
      const missingDirs = expectedDirs.filter(
        (dir) => !existsSync(join(newDir, dir))
      );

      if (missingDirs.length > 0) {
        console.warn(
          `Some expected directories are missing in new location: ${missingDirs.join(
            ", "
          )}`
        );
      }

      // Check if old directory is empty and delete it
      if (this.isDirectoryEmpty(oldDir)) {
        try {
          rmSync(oldDir, { recursive: true, force: true });
          console.log(`Deleted empty old directory: ${oldDir}`);
        } catch (deleteError) {
          console.warn(`Failed to delete old directory: ${deleteError}`);
        }
      } else {
        console.log(`Old directory not empty, keeping: ${oldDir}`);
      }

      // Update settings path to new location
      this.updateSettingsPath();

      console.log(`Data migration completed successfully`);
    } catch (error) {
      console.error("Failed to migrate data directory:", error);
      throw error;
    }
  }

  /**
   * Copy directory recursively
   */
  private copyDirectoryRecursive(source: string, destination: string): void {
    if (!existsSync(source)) {
      return;
    }

    if (!existsSync(destination)) {
      mkdirSync(destination, { recursive: true });
    }

    const items = readdirSync(source, { withFileTypes: true });

    for (const item of items) {
      const sourcePath = join(source, item.name);
      const destPath = join(destination, item.name);

      if (item.isDirectory()) {
        this.copyDirectoryRecursive(sourcePath, destPath);
      } else {
        copyFileSync(sourcePath, destPath);
      }
    }
  }

  /**
   * Check if directory is empty
   */
  private isDirectoryEmpty(dirPath: string): boolean {
    if (!existsSync(dirPath)) {
      return true;
    }

    try {
      const items = readdirSync(dirPath);
      return items.length === 0;
    } catch (error) {
      console.error(`Error checking if directory is empty: ${error}`);
      return false;
    }
  }
}
