import { EventEmitter } from "events";
import {
  BaseTranscriptionPlugin,
  TranscriptionSetupProgress,
  PluginSchemaItem,
  PluginState,
  PluginUIFunctions,
} from "./TranscriptionPlugin";
import { SegmentUpdate } from "../types/SegmentTypes";
import { AppConfig } from "../config/AppConfig";
import { appEventBus } from "../services/AppEventBus";

export class TranscriptionPluginManager extends EventEmitter {
  private plugins: Map<string, BaseTranscriptionPlugin> = new Map();
  private activePlugin: BaseTranscriptionPlugin | null = null;
  private config: AppConfig;
  private bufferingEnabled: boolean = false;
  private bufferedAudioChunks: Float32Array[] = [];

  constructor(config: AppConfig) {
    super();
    this.config = config;

    // Ensure models directory exists when plugin manager is created
    const { existsSync, mkdirSync } = require("fs");
    const modelsDir = this.config.getModelsDir();
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
      console.log(`Created models directory: ${modelsDir}`);
    }

    // Forward global dictation window visibility events to active plugin
    appEventBus.on("dictation-window-shown", () => {
      try {
        this.activePlugin?.onDictationWindowShow?.();
      } catch { }
    });
    appEventBus.on("dictation-window-hidden", () => {
      try {
        this.activePlugin?.onDictationWindowHide?.();
      } catch { }
    });
  }

  /**
   * Register a transcription plugin
   */
  registerPlugin(plugin: BaseTranscriptionPlugin): void {
    console.log(
      `Registering transcription plugin: ${plugin.displayName} (${plugin.name})`,
    );
    this.plugins.set(plugin.name, plugin);

    // Set plugin manager reference
    plugin.setPluginManager(this);

    // Forward plugin events
    plugin.on("error", (error: any) => {
      console.error(`Plugin ${plugin.name} error:`, error);
      this.emit("plugin-error", { plugin: plugin.name, error });
    });

    plugin.on("stateChanged", (state: PluginState) => {
      this.emit("plugin-state-changed", { plugin: plugin.name, state });
    });

    plugin.on("downloadProgress", (progress: any) => {
      this.emit("plugin-download-progress", { plugin: plugin.name, progress });
    });

    this.emit("plugin-registered", plugin);
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): BaseTranscriptionPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get available (ready to use) plugins
   */
  async getAvailablePlugins(): Promise<BaseTranscriptionPlugin[]> {
    const plugins = this.getPlugins();
    const availabilityChecks = await Promise.allSettled(
      plugins.map(async (plugin) => ({
        plugin,
        available: await plugin.isAvailable(),
      })),
    );

    return availabilityChecks
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<{
          plugin: BaseTranscriptionPlugin;
          available: boolean;
        }> => result.status === "fulfilled" && result.value.available,
      )
      .map((result) => result.value.plugin);
  }

  /**
   * Get plugin by name
   */
  getPlugin(name: string): BaseTranscriptionPlugin | null {
    return this.plugins.get(name) || null;
  }

  /**
   * Set the active transcription plugin with proper lifecycle management
   */
  async setActivePlugin(
    name: string,
    options: Record<string, any> = {},
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    const plugin = this.getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    // Load plugin options from config if none provided
    let finalOptions = { ...options };
    if (Object.keys(options).length === 0) {
      const pluginConfig = this.config.getPluginConfig();
      if (pluginConfig[name]) {
        finalOptions = pluginConfig[name];
      }
    }

    // Set options before checking availability (for plugins that need options to be available)
    if (Object.keys(finalOptions).length > 0) {
      console.log(
        `Setting options for ${name} before availability check:`,
        finalOptions,
      );
      plugin.setOptions(finalOptions);
    }

    // Re-check availability on every switch
    console.log(`Checking availability for ${name}...`);
    const available = await plugin.isAvailable().catch((error) => {
      console.error(`Error checking availability for ${name}:`, error);
      return false;
    });
    console.log(`Initial availability check for ${name}:`, available);

    if (!available) {
      // Try running initialization to see if it becomes available
      console.log(`Plugin ${name} not available, trying initialization...`);
      try {
        if (!plugin.isPluginInitialized()) {
          await plugin.initialize();
        }
      } catch (error) {
        console.error(`Failed to initialize ${name}:`, error);
      }
    }

    const finalAvailable = await plugin.isAvailable().catch((error) => {
      console.error(`Error in final availability check for ${name}:`, error);
      return false;
    });
    console.log(`Final availability check for ${name}:`, finalAvailable);

    if (!finalAvailable) {
      throw new Error(`Plugin ${name} is not available`);
    }

    // Verify options before proceeding
    if (Object.keys(finalOptions).length > 0) {
      const validation = await plugin.validateOptions(finalOptions);
      if (!validation.valid) {
        throw new Error(`Invalid options: ${validation.errors.join(", ")}`);
      }
    }

    // Check if plugin is currently downloading
    const state = plugin.getState();
    if (state.isLoading && state.downloadProgress?.status === "downloading") {
      throw new Error(`Cannot activate ${name}: currently downloading`);
    }

    // Deactivate current plugin if different
    if (this.activePlugin && this.activePlugin !== plugin) {
      try {
        await this.activePlugin.stopTranscription();
        await this.activePlugin.onDeactivate();
      } catch (error) {
        console.error("Error deactivating current plugin:", error);
      }
    }

    // Activate new plugin
    this.activePlugin = plugin;

    try {
      // Update options with full updateOptions call (for plugins that need to store securely, etc.)
      if (Object.keys(finalOptions).length > 0) {
        console.log(`Calling updateOptions for ${name} with:`, finalOptions);
        await plugin.updateOptions(finalOptions, uiFunctions);
        console.log(`updateOptions completed for ${name}`);
      }

      // Activate the plugin
      await plugin.onActivated(uiFunctions);

      // Initialize runOnAll buffering state for the active plugin
      try {
        const criteria = plugin.getActivationCriteria?.() || {};
        this.bufferingEnabled = !!criteria.runOnAll;
        this.bufferedAudioChunks = [];
      } catch { }

      this.emit("active-plugin-changed", plugin);
      console.log(`Active transcription plugin set to: ${plugin.displayName}`);
    } catch (error) {
      this.activePlugin = null;
      throw new Error(`Failed to activate plugin ${name}: ${error}`);
    }
  }

  /**
   * Get the currently active plugin
   */
  getActivePlugin(): BaseTranscriptionPlugin | null {
    return this.activePlugin;
  }

  /**
   * Get the name of the active transcription plugin
   */
  getActivePluginName(): string | null {
    return this.activePlugin?.name || null;
  }

  /**
   * Start transcription with the active plugin
   */
  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<void> {
    if (!this.activePlugin) {
      throw new Error("No active transcription plugin set");
    }

    console.log(
      `Starting transcription with plugin: ${this.activePlugin.displayName}`,
    );
    await this.activePlugin.startTranscription(onUpdate, onProgress, onLog);

    // Reset buffering at start
    try {
      const criteria = this.activePlugin.getActivationCriteria?.() || {};
      this.bufferingEnabled = !!criteria.runOnAll;
      this.bufferedAudioChunks = [];
    } catch { }
  }

  /**
   * Stop transcription
   */
  async stopTranscription(): Promise<void> {
    if (!this.activePlugin) {
      return;
    }

    console.log(
      `Stopping transcription with plugin: ${this.activePlugin.displayName}`,
    );
    await this.activePlugin.stopTranscription();
  }

  /** Expose activation criteria of active plugin */
  getActivePluginActivationCriteria() {
    return this.activePlugin?.getActivationCriteria() || {};
  }

  /** Check if any buffered audio exists (runOnAll). */
  hasBufferedAudio(): boolean {
    return this.bufferingEnabled && this.bufferedAudioChunks.length > 0;
  }

  /** Get buffered audio chunks for plugins that need them. */
  getBufferedAudioChunks(): Float32Array[] {
    return [...this.bufferedAudioChunks];
  }

  /**
   * When runOnAll is enabled, combine all buffered chunks and send one call to the plugin.
   */
  async finalizeBufferedAudio(): Promise<void> {
    if (!this.activePlugin) return;
    if (!this.bufferingEnabled) return;
    const total = this.bufferedAudioChunks.reduce(
      (acc, cur) => acc + cur.length,
      0,
    );
    if (total === 0) return;

    // Check if plugin has its own finalizeBufferedAudio method
    if (typeof this.activePlugin.finalizeBufferedAudio === "function") {
      // Clear buffer before processing to avoid recursion capturing
      this.bufferedAudioChunks = [];
      try {
        await this.activePlugin.finalizeBufferedAudio();
      } catch (e) {
        this.emit("plugin-error", { plugin: this.activePlugin.name, error: e });
      }
      return;
    }

    // Fallback to combining chunks and calling processAudioSegment
    const combined = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.bufferedAudioChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    // Clear buffer before processing to avoid recursion capturing
    this.bufferedAudioChunks = [];
    // Bypass manager buffering and call plugin directly
    try {
      await this.activePlugin.processAudioSegment(combined);
    } catch (e) {
      this.emit("plugin-error", { plugin: this.activePlugin.name, error: e });
    }
  }

  /**
   * Process audio segment with the active plugin
   */
  async processAudioSegment(audioData: Float32Array): Promise<void> {
    if (!this.activePlugin || !this.activePlugin.processAudioSegment) {
      return;
    }

    if (this.bufferingEnabled) {
      this.bufferedAudioChunks.push(audioData);
      const maxBufferedSamples = 16000 * 60; // cap ~60s at 16kHz mono
      let total = this.bufferedAudioChunks.reduce((acc, cur) => acc + cur.length, 0);
      while (total > maxBufferedSamples && this.bufferedAudioChunks.length > 0) {
        const removed = this.bufferedAudioChunks.shift();
        total -= removed ? removed.length : 0;
      }
      return;
    }

    await this.activePlugin.processAudioSegment(audioData);
  }

  /**
   * Transcribe a file with the active plugin
   */
  async transcribeFile(filePath: string): Promise<string> {
    if (!this.activePlugin || !this.activePlugin.transcribeFile) {
      throw new Error("Active plugin does not support file transcription");
    }

    return await this.activePlugin.transcribeFile(filePath);
  }

  /**
   * Check if active plugin is currently transcribing
   */
  isTranscribing(): boolean {
    return this.activePlugin?.isTranscribing() || false;
  }

  /**
   * Test if a plugin can be activated without actually activating it
   * Uses the existing onActivated() call which handles model validation properly
   */
  async testPluginActivation(
    pluginName: string,
    options: Record<string, any> = {},
  ): Promise<{ canActivate: boolean; error?: string }> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin) {
      return { canActivate: false, error: `Plugin ${pluginName} not found` };
    }

    try {
      // First check basic availability
      const isAvailable = await plugin.isAvailable();
      if (!isAvailable && Object.keys(options).length === 0) {
        return {
          canActivate: false,
          error: `Plugin ${pluginName} is not available`,
        };
      }
      console.log(`Testing activation of ${pluginName}`, options);

      // Set options before testing activation
      if (Object.keys(options).length > 0) {
        console.log("Verifying and testing plugin activation with options");
        const validation = await plugin.validateOptions(options);
        if (!validation.valid) {
          return {
            canActivate: false,
            error: `Invalid options: ${validation.errors.join(", ")}`,
          };
        }
        plugin.setOptions(options);
      }
      console.log("Attempting with new options");

      // Test activation using existing onActivated method
      // This will validate models and configuration without downloading
      await plugin.onActivated();

      // If we get here, activation succeeded
      return { canActivate: true };
    } catch (error: any) {
      return { canActivate: false, error: error.message || String(error) };
    }
  }

  /**
   * Attempt to activate a plugin with fallback support
   * If primary plugin fails, tries plugins from its fallback chain
   * If no fallback chain defined, tries all other available plugins
   */
  async activatePluginWithFallback(
    primaryPluginName?: string,
    options: Record<string, any> = {},
    uiFunctions?: PluginUIFunctions,
  ): Promise<{
    success: boolean;
    activePlugin: string | null;
    pluginChanged: boolean;
    errors: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};
    const originalActivePlugin = this.getActivePluginName();

    // If no primary plugin specified, try to use current active plugin
    if (!primaryPluginName) {
      primaryPluginName = originalActivePlugin || this.getDefaultPluginName();
    }

    console.log(
      `Attempting to activate plugin with fallback: ${primaryPluginName}`,
    );

    // First, try the primary plugin
    const primaryTest = await this.testPluginActivation(
      primaryPluginName,
      options,
    );
    if (primaryTest.canActivate) {
      try {
        await this.setActivePlugin(primaryPluginName, options, uiFunctions);
        console.log(
          `Successfully activated primary plugin: ${primaryPluginName}`,
        );
        return {
          success: true,
          activePlugin: primaryPluginName,
          pluginChanged: originalActivePlugin !== primaryPluginName,
          errors: {},
        };
      } catch (error: any) {
        errors[primaryPluginName] = error.message || String(error);
        console.log(
          `Primary plugin activation failed during setActivePlugin: ${error.message}`,
        );
      }
    } else {
      errors[primaryPluginName] = primaryTest.error || "Unknown error";
      console.log(
        `Primary plugin failed test activation: ${primaryTest.error}`,
      );
    }

    // Primary plugin failed, try fallback chain
    const primaryPlugin = this.getPlugin(primaryPluginName);
    let fallbackPlugins: string[] = [];

    if (primaryPlugin) {
      const customFallback = primaryPlugin.getFallbackChain();
      if (customFallback.length > 0) {
        console.log(
          `Using custom fallback chain for ${primaryPluginName}:`,
          customFallback,
        );
        fallbackPlugins = customFallback;
      }
    }

    // If no custom fallback chain, try all other plugins
    if (fallbackPlugins.length === 0) {
      const allPlugins = this.getPlugins().map((p) => p.name);
      fallbackPlugins = allPlugins.filter((name) => name !== primaryPluginName);
      console.log(
        `No custom fallback chain, trying all other plugins:`,
        fallbackPlugins,
      );
    }

    // Try each fallback plugin
    for (const fallbackName of fallbackPlugins) {
      console.log(`Trying fallback plugin: ${fallbackName}`);
      const fallbackTest = await this.testPluginActivation(fallbackName, {});

      if (fallbackTest.canActivate) {
        try {
          await this.setActivePlugin(fallbackName, {}, uiFunctions);
          console.log(
            `Successfully activated fallback plugin: ${fallbackName}`,
          );
          return {
            success: true,
            activePlugin: fallbackName,
            pluginChanged: true,
            errors,
          };
        } catch (error: any) {
          errors[fallbackName] = error.message || String(error);
          console.log(`Fallback plugin activation failed: ${error.message}`);
        }
      } else {
        errors[fallbackName] = fallbackTest.error || "Unknown error";
        console.log(`Fallback plugin failed test: ${fallbackTest.error}`);
      }
    }

    // All plugins failed
    console.error("All plugins failed to activate:", errors);
    return {
      success: false,
      activePlugin: null,
      pluginChanged: originalActivePlugin !== null,
      errors,
    };
  }

  /**
   * Get the default plugin name from config
   */
  getDefaultPluginName(): string {
    // Check config for preferred plugin, fallback to YAP
    return this.config.get("transcriptionPlugin") || "yap";
  }

  /**
   * Set the default plugin name in config
   */
  setDefaultPluginName(name: string): void {
    this.config.set("transcriptionPlugin", name);
  }

  /**
   * Initialize all plugins
   */
  async initializePlugins(): Promise<void> {
    console.log("Initializing transcription plugins...");

    // Ensure models directory exists before initializing plugins
    const { existsSync, mkdirSync } = require("fs");
    const { join } = require("path");

    const modelsDir = this.config.getModelsDir();
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
      console.log(`Created models directory: ${modelsDir}`);
    }

    const plugins = this.getPlugins();
    const initPromises = plugins.map(async (plugin) => {
      try {
        await plugin.initialize();
        console.log(`Plugin ${plugin.displayName} initialized successfully`);
      } catch (error) {
        console.error(
          `Failed to initialize plugin ${plugin.displayName}:`,
          error,
        );
      }
    });

    await Promise.allSettled(initPromises);

    // Set active plugin using fallback system
    const defaultPluginName = this.getDefaultPluginName();

    console.log(
      `Attempting to activate default plugin with fallback: ${defaultPluginName}`,
    );
    const fallbackResult = await this.activatePluginWithFallback(
      defaultPluginName,
    );

    if (fallbackResult.success) {
      if (fallbackResult.pluginChanged) {
        console.log(
          `Plugin changed during startup fallback: ${defaultPluginName} → ${fallbackResult.activePlugin}`,
        );
        // Update the stored default if plugin changed
        this.setDefaultPluginName(fallbackResult.activePlugin!);
      }
      console.log(
        `Successfully activated plugin: ${fallbackResult.activePlugin}`,
      );
    } else {
      console.warn(
        "No transcription plugins could be activated. Errors:",
        fallbackResult.errors,
      );
      // Don't throw error here - app should still start, but show warning
    }
  }

  /**
   * Get all plugin schemas for onboarding/settings UI
   */
  getAllPluginSchemas(): Record<string, PluginSchemaItem[]> {
    const pluginSchemas: Record<string, PluginSchemaItem[]> = {};

    for (const plugin of this.getPlugins()) {
      pluginSchemas[plugin.name] = plugin.getSchema();
    }

    return pluginSchemas;
  }

  /**
   * Get schema for a specific plugin
   */
  getPluginSchema(name: string): PluginSchemaItem[] | null {
    const plugin = this.getPlugin(name);
    return plugin ? plugin.getSchema() : null;
  }

  /**
   * Set options for a specific plugin
   */
  async setPluginOptions(
    name: string,
    options: Record<string, any>,
  ): Promise<void> {
    const plugin = this.getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    const validation = await plugin.validateOptions(options);
    if (!validation.valid) {
      throw new Error(`Invalid options: ${validation.errors.join(", ")}`);
    }

    plugin.setOptions(options);
  }

  /**
   * Get options for a specific plugin
   */
  async getPluginOptions(name: string): Promise<Record<string, any> | null> {
    const plugin = this.getPlugin(name);
    return plugin ? plugin.getOptions() : null;
  }

  /**
   * Get the current state of a plugin
   */
  getPluginState(name: string): PluginState | null {
    const plugin = this.getPlugin(name);
    return plugin ? plugin.getState() : null;
  }

  /**
   * Update options for the active plugin
   */
  async updateActivePluginOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    if (!this.activePlugin) {
      throw new Error("No active plugin to update");
    }

    const validation = await this.activePlugin.validateOptions(options);
    if (!validation.valid) {
      throw new Error(`Invalid options: ${validation.errors.join(", ")}`);
    }

    await this.activePlugin.updateOptions(options, uiFunctions);
  }

  /**
   * Verify options for a specific plugin
   */
  async verifyPluginOptions(
    name: string,
    options: Record<string, any>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const plugin = this.getPlugin(name);
    if (!plugin) {
      return { valid: false, errors: [`Plugin ${name} not found`] };
    }

    return await plugin.validateOptions(options);
  }

  /**
   * Delete/clear data for an inactive plugin
   */
  async deleteInactivePlugin(name: string): Promise<void> {
    const plugin = this.getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (this.activePlugin === plugin) {
      throw new Error(`Cannot delete active plugin ${name}`);
    }

    await plugin.deleteAllData();
    console.log(`Cleared data for inactive plugin: ${name}`);
  }

  /**
   * Clear data for a specific plugin
   */
  async clearPluginData(name: string): Promise<void> {
    const plugin = this.getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    await plugin.deleteAllData();
  }

  /**
   * Clear data for all plugins
   */
  async clearAllPluginData(): Promise<void> {
    const plugins = this.getPlugins();
    const clearPromises = plugins.map(async (plugin) => {
      try {
        await plugin.deleteAllData();
      } catch (error) {
        console.error(
          `Error clearing data for plugin ${plugin.displayName}:`,
          error,
        );
      }
    });

    await Promise.allSettled(clearPromises);
  }

  /**
   * Clear data for all plugins and attempt to reactivate with fallback
   * Returns updated plugin data info and activation results
   */
  async clearAllPluginDataWithFallback(
    uiFunctions?: PluginUIFunctions,
  ): Promise<{
    success: boolean;
    pluginChanged: boolean;
    originalPlugin: string | null;
    newActivePlugin: string | null;
    failedPlugins: string[];
    updatedDataInfo: Array<{
      name: string;
      displayName: string;
      isActive: boolean;
      dataSize: number;
      dataPath: string;
    }>;
    error?: string;
  }> {
    const originalPlugin = this.getActivePluginName();
    console.log(
      `Starting clearAllPluginDataWithFallback, current plugin: ${originalPlugin}`,
    );

    try {
      // Clear all plugin data first
      await this.clearAllPluginData();
      console.log("All plugin data cleared successfully");

      // Attempt to reactivate with fallback support
      const fallbackResult = await this.activatePluginWithFallback(
        originalPlugin || undefined,
        {},
        uiFunctions,
      );

      // Get updated plugin data info
      const updatedDataInfo = await this.getPluginDataInfo();

      const failedPlugins = Object.keys(fallbackResult.errors);

      if (fallbackResult.success) {
        const pluginChanged = originalPlugin !== fallbackResult.activePlugin;

        // Update stored setting if plugin changed
        if (pluginChanged && fallbackResult.activePlugin) {
          this.setDefaultPluginName(fallbackResult.activePlugin);
        }

        console.log(
          `Data clearing with fallback completed. Plugin: ${originalPlugin} → ${fallbackResult.activePlugin}`,
        );

        return {
          success: true,
          pluginChanged,
          originalPlugin,
          newActivePlugin: fallbackResult.activePlugin,
          failedPlugins,
          updatedDataInfo,
        };
      } else {
        console.error(
          "Failed to activate any plugin after data clearing:",
          fallbackResult.errors,
        );
        return {
          success: false,
          pluginChanged: true, // Active plugin was lost
          originalPlugin,
          newActivePlugin: null,
          failedPlugins,
          updatedDataInfo,
          error: `All plugins failed to activate after data clearing. Errors: ${JSON.stringify(
            fallbackResult.errors,
          )}`,
        };
      }
    } catch (error: any) {
      console.error("Error during clearAllPluginDataWithFallback:", error);

      // Try to get updated data info even after error
      let updatedDataInfo: Array<{
        name: string;
        displayName: string;
        isActive: boolean;
        dataSize: number;
        dataPath: string;
      }>;
      try {
        updatedDataInfo = await this.getPluginDataInfo();
      } catch {
        updatedDataInfo = [];
      }

      return {
        success: false,
        pluginChanged: true,
        originalPlugin,
        newActivePlugin: null,
        failedPlugins: [],
        updatedDataInfo,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Get data information for all plugins
   */
  async getPluginDataInfo(): Promise<
    Array<{
      name: string;
      displayName: string;
      isActive: boolean;
      dataSize: number;
      dataPath: string;
    }>
  > {
    console.log("Getting plugin data info...");
    const plugins = this.getPlugins();
    console.log(
      `Found ${plugins.length} plugins:`,
      plugins.map((p) => p.name),
    );

    const dataInfo = await Promise.all(
      plugins.map(async (plugin) => {
        try {
          console.log(`Getting data size for plugin ${plugin.name}...`);
          const dataSize = await plugin.getDataSize();
          console.log(`Plugin ${plugin.name} data size: ${dataSize}`);
          return {
            name: plugin.name,
            displayName: plugin.displayName,
            isActive: this.activePlugin === plugin,
            dataSize,
            dataPath: plugin.getDataPath(),
          };
        } catch (error) {
          console.error(
            `Error getting data info for plugin ${plugin.displayName}:`,
            error,
          );
          return {
            name: plugin.name,
            displayName: plugin.displayName,
            isActive: this.activePlugin === plugin,
            dataSize: 0,
            dataPath: plugin.getDataPath(),
          };
        }
      }),
    );

    console.log("Plugin data info result:", dataInfo);
    return dataInfo;
  }

  /**
   * Cleanup all plugins
   */
  async cleanup(): Promise<void> {
    console.log("Cleaning up transcription plugins...");

    // Deactivate active plugin first
    if (this.activePlugin) {
      try {
        await this.activePlugin.stopTranscription();
        await this.activePlugin.onDeactivate();
      } catch (error) {
        console.error("Error deactivating plugin during cleanup:", error);
      }
    }

    const plugins = this.getPlugins();
    const cleanupPromises = plugins.map(async (plugin) => {
      try {
        await plugin.cleanup();
        await plugin.destroy();
      } catch (error) {
        console.error(`Error cleaning up plugin ${plugin.displayName}:`, error);
      }
    });

    await Promise.allSettled(cleanupPromises);

    this.activePlugin = null;
    this.plugins.clear();
  }
}
