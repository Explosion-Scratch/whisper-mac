import { EventEmitter } from "events";
import {
  BaseTranscriptionPlugin,
  TranscriptionSetupProgress,
  PluginOption,
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
      } catch {}
    });
    appEventBus.on("dictation-window-hidden", () => {
      try {
        this.activePlugin?.onDictationWindowHide?.();
      } catch {}
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
      const validation = await plugin.verifyOptions(finalOptions);
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
      } catch {}

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
    } catch {}
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

    // Set default active plugin
    const defaultPluginName = this.getDefaultPluginName();
    const defaultPlugin = this.getPlugin(defaultPluginName);

    if (defaultPlugin && (await defaultPlugin.isAvailable())) {
      await this.setActivePlugin(defaultPluginName);
    } else {
      // Try to find any available plugin
      const availablePlugins = await this.getAvailablePlugins();
      if (availablePlugins.length > 0) {
        await this.setActivePlugin(availablePlugins[0].name);
      } else {
        console.warn("No available transcription plugins found");
      }
    }
  }

  /**
   * Get all plugin options for onboarding/settings UI
   */
  getAllPluginOptions(): Record<string, PluginOption[]> {
    const pluginOptions: Record<string, PluginOption[]> = {};

    for (const plugin of this.getPlugins()) {
      pluginOptions[plugin.name] = plugin.getOptions();
    }

    return pluginOptions;
  }

  /**
   * Get options for a specific plugin
   */
  getPluginOptions(name: string): PluginOption[] | null {
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

    const validation = await this.activePlugin.verifyOptions(options);
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

    return await plugin.verifyOptions(options);
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

    await plugin.clearData();
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

    await plugin.clearData();
  }

  /**
   * Clear data for all plugins
   */
  async clearAllPluginData(): Promise<void> {
    const plugins = this.getPlugins();
    const clearPromises = plugins.map(async (plugin) => {
      try {
        await plugin.clearData();
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
