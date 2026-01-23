import { EventEmitter } from "events";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { AppConfig } from "../config/AppConfig";
import { SettingsManager } from "../config/SettingsManager";
import { TranscriptionPluginManager } from "../plugins/TranscriptionPluginManager";
import { UnifiedModelDownloadService } from "./UnifiedModelDownloadService";
import { validateSettings, getDefaultSettings } from "../config/SettingsSchema";

/**
 * Export format version - increment when export format changes
 */
const EXPORT_FORMAT_VERSION = 1;

/**
 * Plugins that require model downloads
 */
const PLUGINS_REQUIRING_MODELS = ["whisper-cpp", "vosk", "parakeet"];

/**
 * Settings keys that should be excluded from export (sensitive or system-specific)
 */
const EXCLUDED_EXPORT_KEYS: string[] = [
  // History is excluded per requirements
  // API keys are stored in secure storage, not in settings
];

/**
 * Settings keys that need special handling during import
 */
const SPECIAL_HANDLING_KEYS = new Set([
  "dataDir", // May need path adjustment
  "transcriptionPlugin", // May need model download
]);

export interface ExportedSettings {
  version: number;
  exportedAt: string;
  appVersion?: string;
  platform?: string;
  settings: Record<string, any>;
  requiredModels: RequiredModel[];
}

export interface RequiredModel {
  pluginName: string;
  modelName: string;
  displayName: string;
}

export interface ImportProgress {
  stage:
    | "validating"
    | "applying"
    | "downloading"
    | "activating"
    | "complete"
    | "error";
  message: string;
  percent: number;
  currentStep?: number;
  totalSteps?: number;
  modelProgress?: {
    modelName: string;
    downloadPercent: number;
  };
}

export interface ImportResult {
  success: boolean;
  message: string;
  appliedSettings?: Record<string, any>;
  modelsDownloaded?: string[];
  warnings?: string[];
  errors?: string[];
}

export interface ExportResult {
  success: boolean;
  message: string;
  filePath?: string;
}

export class SettingsExportImportService extends EventEmitter {
  private config: AppConfig;
  private settingsManager: SettingsManager;
  private transcriptionPluginManager: TranscriptionPluginManager | null = null;
  private unifiedModelDownloadService: UnifiedModelDownloadService | null =
    null;
  private isImporting = false;
  private importCancelled = false;

  constructor(config: AppConfig, settingsManager: SettingsManager) {
    super();
    this.config = config;
    this.settingsManager = settingsManager;
  }

  setTranscriptionPluginManager(manager: TranscriptionPluginManager): void {
    this.transcriptionPluginManager = manager;
  }

  setUnifiedModelDownloadService(service: UnifiedModelDownloadService): void {
    this.unifiedModelDownloadService = service;
  }

  /**
   * Export settings to a JSON string with metadata
   */
  exportSettings(): ExportedSettings {
    const currentSettings = this.settingsManager.getAll();

    // Create a copy excluding sensitive/system-specific keys
    const exportableSettings = this.filterExportableSettings(currentSettings);

    // Identify required models based on plugin settings
    const requiredModels = this.identifyRequiredModels(exportableSettings);

    const exported: ExportedSettings = {
      version: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      platform: process.platform,
      settings: exportableSettings,
      requiredModels,
    };

    // Try to get app version
    try {
      const { app } = require("electron");
      exported.appVersion = app.getVersion();
    } catch {
      // Not in Electron context
    }

    return exported;
  }

  /**
   * Export settings to a file
   */
  async exportToFile(filePath: string): Promise<ExportResult> {
    try {
      const exported = this.exportSettings();
      const json = JSON.stringify(exported, null, 2);
      writeFileSync(filePath, json, "utf8");

      return {
        success: true,
        message: "Settings exported successfully",
        filePath,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to export settings: ${error.message}`,
      };
    }
  }

  /**
   * Import settings from a JSON string with progress reporting and model downloads
   */
  async importSettings(
    jsonString: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportResult> {
    if (this.isImporting) {
      return {
        success: false,
        message: "An import is already in progress",
      };
    }

    this.isImporting = true;
    this.importCancelled = false;

    const warnings: string[] = [];
    const errors: string[] = [];
    const modelsDownloaded: string[] = [];

    try {
      // Stage 1: Validate
      onProgress?.({
        stage: "validating",
        message: "Validating settings file...",
        percent: 5,
        currentStep: 1,
        totalSteps: 4,
      });

      const parsed = this.parseImportData(jsonString);
      if (!parsed.success) {
        return {
          success: false,
          message: parsed.message,
          errors: [parsed.message],
        };
      }

      const importData = parsed.data!;
      const settingsToApply = importData.settings;

      // Validate settings structure
      const validationErrors = validateSettings(settingsToApply);
      if (Object.keys(validationErrors).length > 0) {
        // Log warnings but continue - some settings may still be valid
        Object.entries(validationErrors).forEach(([key, error]) => {
          warnings.push(`Setting "${key}": ${error}`);
        });
      }

      if (this.importCancelled) {
        return { success: false, message: "Import cancelled", warnings };
      }

      // Stage 2: Apply base settings
      onProgress?.({
        stage: "applying",
        message: "Applying settings...",
        percent: 20,
        currentStep: 2,
        totalSteps: 4,
      });

      // Handle special settings
      const processedSettings = this.processImportSettings(
        settingsToApply,
        warnings,
      );

      // Apply settings (this validates and merges with defaults)
      try {
        // Merge with current settings to preserve any system-specific values
        const currentSettings = this.settingsManager.getAll();
        const mergedSettings = this.mergeForImport(
          currentSettings,
          processedSettings,
        );

        this.settingsManager.setAll(mergedSettings);
        this.settingsManager.saveSettings();
      } catch (error: any) {
        errors.push(`Failed to apply settings: ${error.message}`);
        return {
          success: false,
          message: "Failed to apply settings",
          warnings,
          errors,
        };
      }

      if (this.importCancelled) {
        return { success: false, message: "Import cancelled", warnings };
      }

      // Stage 3: Download required models
      const requiredModels = importData.requiredModels || [];
      const modelsToDownload =
        await this.filterModelsNeedingDownload(requiredModels);

      if (modelsToDownload.length > 0) {
        const totalModels = modelsToDownload.length;
        let downloadedCount = 0;

        for (const model of modelsToDownload) {
          if (this.importCancelled) {
            return { success: false, message: "Import cancelled", warnings };
          }

          const basePercent = 30 + (downloadedCount / totalModels) * 50;

          console.log(
            `[Import] Starting download of model: ${model.displayName} (${downloadedCount + 1}/${totalModels})`,
          );

          onProgress?.({
            stage: "downloading",
            message: `Downloading ${model.displayName}...`,
            percent: basePercent,
            currentStep: 3,
            totalSteps: 4,
            modelProgress: {
              modelName: model.displayName,
              downloadPercent: 0,
            },
          });

          try {
            await this.downloadModel(model, (downloadPercent) => {
              console.log(
                `[Import] Downloading ${model.displayName}: ${downloadPercent.toFixed(1)}%`,
              );
              onProgress?.({
                stage: "downloading",
                message: `Downloading ${model.displayName}...`,
                percent:
                  basePercent + (downloadPercent / 100) * (50 / totalModels),
                currentStep: 3,
                totalSteps: 4,
                modelProgress: {
                  modelName: model.displayName,
                  downloadPercent,
                },
              });
            });
            modelsDownloaded.push(model.modelName);
            downloadedCount++;
          } catch (error: any) {
            warnings.push(
              `Failed to download ${model.displayName}: ${error.message}`,
            );
            // Continue with other models - partial success is acceptable
          }
        }
      }

      if (this.importCancelled) {
        return { success: false, message: "Import cancelled", warnings };
      }

      // Stage 4: Activate plugins and finalize
      onProgress?.({
        stage: "activating",
        message: "Activating plugins...",
        percent: 85,
        currentStep: 4,
        totalSteps: 4,
      });

      // Apply settings to config
      this.settingsManager.applyToConfig();

      // Try to activate the selected plugin
      const selectedPlugin = this.settingsManager.get<string>(
        "transcriptionPlugin",
      );
      if (selectedPlugin && this.transcriptionPluginManager) {
        try {
          const pluginOptions = this.getPluginOptionsFromSettings(
            selectedPlugin,
            this.settingsManager.getAll(),
          );
          await this.transcriptionPluginManager.setActivePlugin(
            selectedPlugin,
            pluginOptions,
          );
        } catch (error: any) {
          warnings.push(
            `Failed to activate plugin ${selectedPlugin}: ${error.message}`,
          );
          // Don't fail the import - the user can fix this manually
        }
      }

      onProgress?.({
        stage: "complete",
        message: "Import complete",
        percent: 100,
        currentStep: 4,
        totalSteps: 4,
      });

      return {
        success: true,
        message:
          warnings.length > 0
            ? "Settings imported with warnings"
            : "Settings imported successfully",
        appliedSettings: this.settingsManager.getAll(),
        modelsDownloaded,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error: any) {
      onProgress?.({
        stage: "error",
        message: error.message,
        percent: 0,
      });

      return {
        success: false,
        message: `Import failed: ${error.message}`,
        warnings,
        errors: [...errors, error.message],
      };
    } finally {
      this.isImporting = false;
    }
  }

  /**
   * Import settings from a file with progress
   */
  async importFromFile(
    filePath: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportResult> {
    try {
      if (!existsSync(filePath)) {
        return {
          success: false,
          message: "Settings file not found",
        };
      }

      const jsonString = readFileSync(filePath, "utf8");
      return await this.importSettings(jsonString, onProgress);
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to read settings file: ${error.message}`,
      };
    }
  }

  /**
   * Cancel an in-progress import
   */
  cancelImport(): void {
    this.importCancelled = true;
  }

  /**
   * Check if an import is in progress
   */
  isImportInProgress(): boolean {
    return this.isImporting;
  }

  /**
   * Analyze an import file without applying changes
   */
  analyzeImport(jsonString: string): {
    valid: boolean;
    message: string;
    settingsCount?: number;
    requiredModels?: RequiredModel[];
    missingModels?: RequiredModel[];
    version?: number;
    exportedAt?: string;
  } {
    const parsed = this.parseImportData(jsonString);
    if (!parsed.success) {
      return {
        valid: false,
        message: parsed.message,
      };
    }

    const importData = parsed.data!;
    const settingsCount = Object.keys(
      this.flattenSettings(importData.settings),
    ).length;

    // Check which models are missing
    const missingModels: RequiredModel[] = [];
    if (importData.requiredModels) {
      for (const model of importData.requiredModels) {
        if (!this.isModelDownloaded(model.pluginName, model.modelName)) {
          missingModels.push(model);
        }
      }
    }

    return {
      valid: true,
      message: "Settings file is valid",
      settingsCount,
      requiredModels: importData.requiredModels,
      missingModels: missingModels.length > 0 ? missingModels : undefined,
      version: importData.version,
      exportedAt: importData.exportedAt,
    };
  }

  // ===== Private Helper Methods =====

  private parseImportData(jsonString: string): {
    success: boolean;
    message: string;
    data?: ExportedSettings;
  } {
    try {
      const parsed = JSON.parse(jsonString);

      // Only accept new format with version and settings
      if (parsed.version && parsed.settings) {
        return {
          success: true,
          message: "Valid export format",
          data: parsed as ExportedSettings,
        };
      }

      // Reject legacy format
      return {
        success: false,
        message:
          "Invalid settings file format. Please use a settings file exported from this version of WhisperMac.",
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Invalid JSON: ${error.message}`,
      };
    }
  }

  private filterExportableSettings(
    settings: Record<string, any>,
  ): Record<string, any> {
    const filtered = { ...settings };

    // Remove excluded keys
    for (const key of EXCLUDED_EXPORT_KEYS) {
      this.deleteNestedKey(filtered, key);
    }

    // Remove history data
    if (filtered.history) {
      // Keep history settings but not the actual recordings
      delete filtered.history.recordings;
    }

    return filtered;
  }

  private identifyRequiredModels(
    settings: Record<string, any>,
  ): RequiredModel[] {
    const models: RequiredModel[] = [];
    const selectedPlugin = settings.transcriptionPlugin;

    if (!selectedPlugin || !PLUGINS_REQUIRING_MODELS.includes(selectedPlugin)) {
      return models;
    }

    // Find the model setting for the selected plugin
    const modelKey = `plugin.${selectedPlugin}.model`;
    const modelName = this.getNestedValue(settings, modelKey);

    if (modelName) {
      models.push({
        pluginName: selectedPlugin,
        modelName: modelName,
        displayName: this.getModelDisplayName(selectedPlugin, modelName),
      });
    }

    return models;
  }

  private getModelDisplayName(pluginName: string, modelName: string): string {
    // Try to get a friendly name from the plugin's schema
    if (this.transcriptionPluginManager) {
      const plugin = this.transcriptionPluginManager.getPlugin(pluginName);
      if (plugin) {
        const schema = plugin.getSchema();
        const modelSchema = schema.find((s) => s.key === "model");
        if (modelSchema?.options) {
          const option = modelSchema.options.find((o) => o.value === modelName);
          if (option) {
            return option.label;
          }
        }
      }
    }
    return modelName;
  }

  private processImportSettings(
    settings: Record<string, any>,
    warnings: string[],
  ): Record<string, any> {
    const processed = { ...settings };

    // Handle dataDir - use current if the imported path doesn't exist
    if (processed.dataDir) {
      if (!existsSync(processed.dataDir)) {
        warnings.push(
          `Data directory "${processed.dataDir}" not found, using current directory`,
        );
        delete processed.dataDir;
      }
    }

    return processed;
  }

  private mergeForImport(
    current: Record<string, any>,
    imported: Record<string, any>,
  ): Record<string, any> {
    const defaults = getDefaultSettings();
    const merged = this.deepMerge(defaults, current);
    return this.deepMerge(merged, imported);
  }

  private deepMerge(
    target: Record<string, any>,
    source: Record<string, any>,
  ): Record<string, any> {
    const output = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (
          this.isObject(source[key]) &&
          this.isObject(target[key]) &&
          !Array.isArray(source[key])
        ) {
          output[key] = this.deepMerge(target[key], source[key]);
        } else {
          output[key] = source[key];
        }
      }
    }

    return output;
  }

  private isObject(item: any): item is Record<string, any> {
    return item && typeof item === "object" && !Array.isArray(item);
  }

  private async filterModelsNeedingDownload(
    requiredModels: RequiredModel[],
  ): Promise<RequiredModel[]> {
    const needed: RequiredModel[] = [];

    for (const model of requiredModels) {
      const isDownloaded = this.isModelDownloaded(
        model.pluginName,
        model.modelName,
      );
      console.log(
        `[Import] Checking model ${model.displayName} (${model.pluginName}/${model.modelName}): ${isDownloaded ? "already downloaded" : "needs download"}`,
      );
      if (!isDownloaded) {
        needed.push(model);
      }
    }

    return needed;
  }

  private isModelDownloaded(pluginName: string, modelName: string): boolean {
    if (!this.transcriptionPluginManager) {
      return false;
    }

    const plugin = this.transcriptionPluginManager.getPlugin(pluginName);
    if (!plugin) {
      return false;
    }

    // Check if the plugin has a method to check model availability
    if ((plugin as any).isModelDownloaded) {
      return (plugin as any).isModelDownloaded(modelName);
    }

    // For whisper-cpp, check the models directory for the model file
    if (pluginName === "whisper-cpp") {
      const modelsDir = this.config.getModelsDir();
      const modelPath = `${modelsDir}/${modelName}`;
      return existsSync(modelPath);
    }

    // For parakeet, check if the model directory exists with expected files
    if (pluginName === "parakeet") {
      const modelsDir = this.config.getModelsDir();
      const modelDir = `${modelsDir}/${modelName}`;
      console.log(`[Import] Checking parakeet model at: ${modelDir}`);
      // Parakeet models are directories, check if it exists
      if (!existsSync(modelDir)) {
        console.log(`[Import] Parakeet model directory does not exist`);
        return false;
      }
      // Check for all required model files
      const requiredFiles = [
        "encoder-model.onnx",
        "decoder_joint-model.onnx",
        "nemo128.onnx",
        "vocab.txt",
      ];
      const missingFiles = requiredFiles.filter(
        (file) => !existsSync(`${modelDir}/${file}`),
      );
      if (missingFiles.length > 0) {
        console.log(
          `[Import] Parakeet missing files: ${missingFiles.join(", ")}`,
        );
        return false;
      }
      console.log(`[Import] Parakeet model is fully downloaded`);
      return true;
    }

    // For vosk, check if the model directory exists
    if (pluginName === "vosk") {
      const modelsDir = this.config.getModelsDir();
      const modelDir = `${modelsDir}/${modelName}`;
      // Vosk models are directories, check if the main model file exists
      if (!existsSync(modelDir)) {
        return false;
      }
      // Check for the am directory which vosk models always have
      const amDir = `${modelDir}/am`;
      return existsSync(amDir);
    }

    return false;
  }

  private async downloadModel(
    model: RequiredModel,
    onProgress: (percent: number) => void,
  ): Promise<void> {
    if (!this.unifiedModelDownloadService) {
      throw new Error("Model download service not available");
    }

    console.log(
      `[Import] downloadModel called for ${model.pluginName}/${model.modelName}`,
    );

    try {
      await this.unifiedModelDownloadService.ensureModelForPlugin(
        model.pluginName,
        model.modelName,
        (progress) => {
          console.log(
            `[Import] ensureModelForPlugin progress: status=${progress.status}, progress=${progress.progress}`,
          );
          onProgress(progress.progress);
        },
        (logLine) => {
          console.log(`[Import] ensureModelForPlugin log: ${logLine}`);
        },
      );
      console.log(
        `[Import] downloadModel completed for ${model.pluginName}/${model.modelName}`,
      );
    } catch (error: any) {
      console.error(
        `[Import] downloadModel failed for ${model.pluginName}/${model.modelName}:`,
        error.message,
      );
      throw error;
    }
  }

  private getPluginOptionsFromSettings(
    pluginName: string,
    settings: Record<string, any>,
  ): Record<string, any> {
    const options: Record<string, any> = {};
    const prefix = `plugin.${pluginName}.`;

    // Flatten settings to find plugin options
    const flattened = this.flattenSettings(settings);

    for (const [key, value] of Object.entries(flattened)) {
      if (key.startsWith(prefix)) {
        const optionKey = key.substring(prefix.length);
        options[optionKey] = value;
      }
    }

    return options;
  }

  private flattenSettings(
    obj: Record<string, any>,
    prefix = "",
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (this.isObject(value) && !Array.isArray(value)) {
        Object.assign(result, this.flattenSettings(value, newKey));
      } else {
        result[newKey] = value;
      }
    }

    return result;
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    const keys = path.split(".");
    let current: any = obj;

    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private deleteNestedKey(obj: Record<string, any>, path: string): void {
    const keys = path.split(".");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      if (current && typeof current === "object" && keys[i] in current) {
        current = current[keys[i]];
      } else {
        return;
      }
    }

    if (current && typeof current === "object") {
      delete current[keys[keys.length - 1]];
    }
  }
}
