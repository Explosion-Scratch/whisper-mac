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
import { NonAiTransformationConfig } from "../types/TransformationRuleTypes";

const SETTINGS_REQUIRING_RESTART = new Set([
  "transcriptionPlugin",
  "dataDir",
  "plugin.whisper-cpp.model",
  "plugin.yap.model",
  "plugin.vosk.model",
  "plugin.parakeet.model",
]);

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
        currentDataDir,
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

        // Convert any nested plugin settings to flattened format
        const normalizedLoaded = this.normalizePluginSettings(loaded);

        // Merge with defaults to ensure all keys exist
        const defaults = getDefaultSettings();
        const settings = this.mergeDeep(defaults, normalizedLoaded);

        // Check if dataDir in loaded settings differs from current config
        const loadedDataDir = settings.dataDir;
        if (
          loadedDataDir &&
          typeof loadedDataDir === "string" &&
          loadedDataDir !== this.config.dataDir
        ) {
          console.log(
            `Settings loaded from different data directory: ${loadedDataDir}`,
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

  /**
   * Normalize plugin settings from nested format to flattened format
   * Converts { "plugin": { "whisper-cpp": { "model": "..." } } }
   * To { "plugin.whisper-cpp.model": "..." }
   */
  private normalizePluginSettings(
    settings: Record<string, any>,
  ): Record<string, any> {
    const normalized = { ...settings };

    // Check if there's a nested "plugin" object
    if (normalized.plugin && typeof normalized.plugin === "object") {
      const pluginSettings = normalized.plugin;

      // Convert nested plugin settings to flattened keys
      Object.keys(pluginSettings).forEach((pluginName) => {
        const pluginConfig = pluginSettings[pluginName];
        if (typeof pluginConfig === "object" && pluginConfig !== null) {
          Object.keys(pluginConfig).forEach((optionKey) => {
            const flattenedKey = `plugin.${pluginName}.${optionKey}`;
            normalized[flattenedKey] = pluginConfig[optionKey];
          });
        }
      });

      // Remove the nested plugin object
      delete normalized.plugin;
      console.log("Normalized nested plugin settings to flattened format");
    }

    return normalized;
  }

  /**
   * Ensure plugin settings are stored in flattened format when saving
   * This prevents nested plugin objects from being saved to disk
   */
  private ensureFlattenedPluginSettings(
    settings: Record<string, any>,
  ): Record<string, any> {
    const flattened = { ...settings };

    // If there's a nested "plugin" object, flatten it
    if (flattened.plugin && typeof flattened.plugin === "object") {
      const pluginSettings = flattened.plugin;

      Object.keys(pluginSettings).forEach((pluginName) => {
        const pluginConfig = pluginSettings[pluginName];
        if (typeof pluginConfig === "object" && pluginConfig !== null) {
          Object.keys(pluginConfig).forEach((optionKey) => {
            const flattenedKey = `plugin.${pluginName}.${optionKey}`;
            flattened[flattenedKey] = pluginConfig[optionKey];
          });
        }
      });

      // Remove the nested plugin object
      delete flattened.plugin;
    }

    return flattened;
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

  /**
   * Compare old and new settings and emit setting-changed events for changed values
   */
  private emitChangedSettings(
    oldSettings: Record<string, any>,
    newSettings: Record<string, any>,
    prefix = "",
  ): void {
    const allKeys = new Set([
      ...Object.keys(oldSettings),
      ...Object.keys(newSettings),
    ]);

    for (const key of allKeys) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const oldValue = oldSettings[key];
      const newValue = newSettings[key];

      if (this.isObject(oldValue) && this.isObject(newValue)) {
        // Recursively check nested objects
        this.emitChangedSettings(oldValue, newValue, fullKey);
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        // Value changed, emit event
        this.emit("setting-changed", fullKey, newValue);
      }
    }
  }

  saveSettings(): void {
    try {
      const path = require("path");
      const dir = path.dirname(this.settingsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const settingsToSave = this.ensureFlattenedPluginSettings(this.settings);
      const errors = validateSettings(settingsToSave);
      if (Object.keys(errors).length > 0) {
        console.error("Settings validation errors:", errors);
      }
      writeFileSync(this.settingsPath, JSON.stringify(settingsToSave, null, 2));
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

    const oldValue = this.get(key);

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== "object") {
        current[k] = {};
      }
      current = current[k];
    }

    current[keys[keys.length - 1]] = value;

    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      this.emit("setting-changed", key, value);

      if (this.doesSettingRequireRestart(key)) {
        this.emit("setting-changed-requires-restart", key, value);
      }
    }

    if (
      key === "dataDir" &&
      typeof value === "string" &&
      value !== this.previousDataDir
    ) {
      this.migrateDataDirectory(this.previousDataDir, value);
      this.previousDataDir = value;
    }
  }

  doesSettingRequireRestart(key: string): boolean {
    if (SETTINGS_REQUIRING_RESTART.has(key)) {
      return true;
    }
    for (const prefix of SETTINGS_REQUIRING_RESTART) {
      if (key.startsWith(prefix + ".")) {
        return true;
      }
    }
    return false;
  }

  getAll(): Record<string, any> {
    return { ...this.settings };
  }

  setAll(newSettings: Record<string, any>): void {
    const oldDataDir = this.get<string>("dataDir");
    const oldSettings = { ...this.settings };

    this.settings = this.mergeDeep(getDefaultSettings(), newSettings);

    // Emit setting-changed events for any changed values
    this.emitChangedSettings(oldSettings, this.settings);

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
    const oldSettings = { ...this.settings };
    this.settings = getDefaultSettings();

    // Emit setting-changed events for any changed values
    this.emitChangedSettings(oldSettings, this.settings);
  }

  resetSection(sectionId: string): void {
    const defaults = getDefaultSettings();
    const section = SETTINGS_SCHEMA.find((s) => s.id === sectionId);

    if (section) {
      section.fields.forEach((field) => {
        const keys = field.key.split(".");
        let currentDefaults = defaults;
        let currentSettings = this.settings;

        // Get the old value before resetting
        const oldValue = this.get(field.key);

        for (let i = 0; i < keys.length - 1; i++) {
          currentDefaults = currentDefaults[keys[i]];
          if (!currentSettings[keys[i]]) {
            currentSettings[keys[i]] = {};
          }
          currentSettings = currentSettings[keys[i]];
        }

        const finalKey = keys[keys.length - 1];
        const newValue = currentDefaults[finalKey];
        currentSettings[finalKey] = newValue;

        // Emit setting-changed event if the value actually changed
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          this.emit("setting-changed", field.key, newValue);
        }
      });
    }
  }

  /**
   * Apply current settings to the AppConfig instance
   */
  applyToConfig(): void {
    // Plugin selection and configuration
    const transcriptionPlugin = this.get("transcriptionPlugin", "yap");
    this.config.set("transcriptionPlugin", transcriptionPlugin);

    // Apply plugin-specific settings to config
    const pluginSettings = this.getPluginSettings();
    this.config.setPluginConfig(pluginSettings);

    // Dictation window settings
    this.config.dictationWindowPosition = this.get(
      "dictationWindowPosition",
      "screen-corner",
    ) as DictationWindowPosition;
    this.config.dictationWindowWidth = this.get("dictationWindowWidth", 400);
    this.config.dictationWindowHeight = this.get("dictationWindowHeight", 50);
    this.config.showDictationWindowAlways = this.get(
      "showDictationWindowAlways",
      false,
    );

    // Text processing
    const nonAiTransformations = this.get(
      "nonAiTransformations",
      this.getDefaultNonAiTransformationsConfig(),
    );
    const normalizedTransformations = nonAiTransformations
      ? JSON.parse(JSON.stringify(nonAiTransformations))
      : this.getDefaultNonAiTransformationsConfig();
    this.config.setNonAiTransformations(normalizedTransformations);

    // AI settings
    const aiConfig: AiTransformationConfig = {
      enabled: this.get("ai.enabled", true),
      writingStyle: this.get("ai.writingStyle", this.config.ai.writingStyle),
      baseUrl: this.get(
        "ai.baseUrl",
        "https://api.cerebras.ai/v1/chat/completions",
      ),
      model: this.get("ai.model", "qwen-3-235b-a22b-instruct"),
      maxTokens: this.get("ai.maxTokens", 16382),
      temperature: this.get("ai.temperature", 0.6),
      topP: this.get("ai.topP", 0.95),
      prompt: this.get("ai.prompt", this.config.ai.prompt),
      messagePrompt: this.get("ai.messagePrompt", this.config.ai.messagePrompt),
    };

    // Validate AI configuration if AI is being enabled
    if (aiConfig.enabled && !this.config.ai.enabled) {
      // AI is being enabled, validate the configuration
      this.validateAiConfiguration(aiConfig);
    }

    this.config.ai = aiConfig;

    // Rules settings
    const rules = this.get("rules", []);
    if (Array.isArray(rules)) {
      this.config.setRules(rules);
    }

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
   * Validate AI configuration and disable AI if invalid
   */
  private validateAiConfiguration(aiConfig: AiTransformationConfig): void {
    // Basic validation - check if required fields are present
    if (!aiConfig.baseUrl || aiConfig.baseUrl.trim() === "") {
      console.warn("AI base URL is required, disabling AI");
      aiConfig.enabled = false;
      return;
    }

    if (!aiConfig.model || aiConfig.model.trim() === "") {
      console.warn("AI model is required, disabling AI");
      aiConfig.enabled = false;
      return;
    }

    // Note: API key validation would require async operations and secure storage access
    // This is handled in the UI layer and TransformationService
  }

  /**
   * Load settings from current AppConfig instance
   */
  loadFromConfig(): void {
    // Plugin selection and configuration
    const transcriptionPlugin = this.config.get("transcriptionPlugin");
    if (transcriptionPlugin) {
      this.set("transcriptionPlugin", transcriptionPlugin);
    }

    // Load plugin-specific settings from config
    const pluginSettings = this.getPluginSettings();
    this.setPluginSettings(pluginSettings);

    // Dictation window settings
    this.set("dictationWindowPosition", this.config.dictationWindowPosition);
    this.set("dictationWindowWidth", this.config.dictationWindowWidth);
    this.set("dictationWindowHeight", this.config.dictationWindowHeight);
    this.set(
      "showDictationWindowAlways",
      this.config.showDictationWindowAlways,
    );

    // Text processing
    this.set(
      "nonAiTransformations",
      JSON.parse(JSON.stringify(this.config.getNonAiTransformations())),
    );

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

    // Rules settings
    this.set("rules", this.config.getRules());

    // Advanced settings
    this.set("dataDir", this.config.dataDir);
  }

  /**
   * Get plugin settings from the settings object
   */
  private getPluginSettings(): Record<string, any> {
    const pluginSettings: Record<string, any> = {};

    // Extract all plugin.* settings and convert them to the format expected by AppConfig
    Object.keys(this.settings).forEach((key) => {
      if (key.startsWith("plugin.")) {
        const parts = key.split(".");
        if (parts.length >= 3) {
          const pluginName = parts[1];
          const optionKey = parts.slice(2).join(".");

          if (!pluginSettings[pluginName]) {
            pluginSettings[pluginName] = {};
          }
          pluginSettings[pluginName][optionKey] = this.settings[key];
        }
      }
    });

    return pluginSettings;
  }

  /**
   * Set plugin settings in the settings object
   */
  private setPluginSettings(pluginOptions: Record<string, any>): void {
    // Convert plugin options format to settings format
    Object.keys(pluginOptions).forEach((pluginName) => {
      const options = pluginOptions[pluginName];
      if (typeof options === "object" && options !== null) {
        Object.keys(options).forEach((optionKey) => {
          const settingKey = `plugin.${pluginName}.${optionKey}`;
          this.set(settingKey, options[optionKey]);
        });
      }
    });
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
        (dir) => !existsSync(join(newDir, dir)),
      );

      if (missingDirs.length > 0) {
        console.warn(
          `Some expected directories are missing in new location: ${missingDirs.join(
            ", ",
          )}`,
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
      console.error(`Error checking if directory is empty:`, error);
      return false;
    }
  }

  /**
   * Get default non-AI transformation configuration
   * Note: Non-AI transformations are now primarily handled by the unified actions system
   */
  private getDefaultNonAiTransformationsConfig(): NonAiTransformationConfig {
    return {
      rules: [
        {
          id: "remove_ellipses",
          name: "Remove Ellipses",
          description: "Replace three or more periods with a single period",
          enabledForTranscription: true,
          enabledForActions: false,
          matchPattern: "\\.{3,}",
          matchFlags: "g",
          replacePattern: "\\.{3,}",
          replaceFlags: "g",
          replacement: ".",
          replacementMode: "literal",
          order: 1,
        },
        {
          id: "fix_spacing",
          name: "Fix Spacing",
          description: "Clean up extra whitespace around punctuation",
          enabledForTranscription: true,
          enabledForActions: false,
          matchPattern: "\\s*([.,!?;:])\\s*",
          matchFlags: "g",
          replacePattern: "$1 ",
          replaceFlags: "g",
          replacement: "",
          replacementMode: "literal",
          order: 2,
        },
      ],
    };
  }
}
