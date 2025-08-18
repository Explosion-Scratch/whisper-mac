import { EventEmitter } from "events";
import {
  BaseTranscriptionPlugin,
  TranscriptionSetupProgress,
} from "./TranscriptionPlugin";
import { SegmentUpdate } from "../types/SegmentTypes";
import { AppConfig } from "../config/AppConfig";

export class TranscriptionPluginManager extends EventEmitter {
  private plugins: Map<string, BaseTranscriptionPlugin> = new Map();
  private activePlugin: BaseTranscriptionPlugin | null = null;
  private config: AppConfig;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  /**
   * Register a transcription plugin
   */
  registerPlugin(plugin: BaseTranscriptionPlugin): void {
    console.log(
      `Registering transcription plugin: ${plugin.displayName} (${plugin.name})`
    );
    this.plugins.set(plugin.name, plugin);

    // Forward plugin errors
    plugin.on("error", (error: any) => {
      console.error(`Plugin ${plugin.name} error:`, error);
      this.emit("plugin-error", { plugin: plugin.name, error });
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
      }))
    );

    return availabilityChecks
      .filter(
        (
          result
        ): result is PromiseFulfilledResult<{
          plugin: BaseTranscriptionPlugin;
          available: boolean;
        }> => result.status === "fulfilled" && result.value.available
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
   * Set the active transcription plugin
   */
  async setActivePlugin(name: string): Promise<void> {
    const plugin = this.getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (!(await plugin.isAvailable())) {
      throw new Error(`Plugin ${name} is not available`);
    }

    // Stop current plugin if active
    if (this.activePlugin && this.activePlugin !== plugin) {
      try {
        await this.activePlugin.stopTranscription();
      } catch (error) {
        console.error("Error stopping current plugin:", error);
      }
    }

    this.activePlugin = plugin;
    this.emit("active-plugin-changed", plugin);
    console.log(`Active transcription plugin set to: ${plugin.displayName}`);
  }

  /**
   * Get the currently active plugin
   */
  getActivePlugin(): BaseTranscriptionPlugin | null {
    return this.activePlugin;
  }

  /**
   * Start transcription with the active plugin
   */
  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    if (!this.activePlugin) {
      throw new Error("No active transcription plugin set");
    }

    console.log(
      `Starting transcription with plugin: ${this.activePlugin.displayName}`
    );
    await this.activePlugin.startTranscription(onUpdate, onProgress, onLog);
  }

  /**
   * Stop transcription
   */
  async stopTranscription(): Promise<void> {
    if (!this.activePlugin) {
      return;
    }

    console.log(
      `Stopping transcription with plugin: ${this.activePlugin.displayName}`
    );
    await this.activePlugin.stopTranscription();
  }

  /**
   * Process audio segment with the active plugin
   */
  async processAudioSegment(audioData: Float32Array): Promise<void> {
    if (!this.activePlugin || !this.activePlugin.processAudioSegment) {
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

    const plugins = this.getPlugins();
    const initPromises = plugins.map(async (plugin) => {
      try {
        if (plugin.initialize) {
          await plugin.initialize();
          console.log(`Plugin ${plugin.displayName} initialized successfully`);
        }
      } catch (error) {
        console.error(
          `Failed to initialize plugin ${plugin.displayName}:`,
          error
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
   * Cleanup all plugins
   */
  async cleanup(): Promise<void> {
    console.log("Cleaning up transcription plugins...");

    const plugins = this.getPlugins();
    const cleanupPromises = plugins.map(async (plugin) => {
      try {
        await plugin.cleanup();
      } catch (error) {
        console.error(`Error cleaning up plugin ${plugin.displayName}:`, error);
      }
    });

    await Promise.allSettled(cleanupPromises);

    this.activePlugin = null;
    this.plugins.clear();
  }
}
