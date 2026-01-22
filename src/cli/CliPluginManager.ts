import { AppConfig } from "../config/AppConfig";
import { ParakeetTranscriptionPlugin } from "../plugins/ParakeetTranscriptionPlugin";
import { BaseTranscriptionPlugin, PluginSchemaItem } from "../plugins/TranscriptionPlugin";
import { WhisperCppTranscriptionPlugin } from "../plugins/WhisperCppTranscriptionPlugin";
import { VoskTranscriptionPlugin } from "../plugins/VoskTranscriptionPlugin";
import { YapTranscriptionPlugin } from "../plugins/YapTranscriptionPlugin";
import { GeminiTranscriptionPlugin } from "../plugins/GeminiTranscriptionPlugin";
import { MistralTranscriptionPlugin } from "../plugins/MistralTranscriptionPlugin";

export interface PluginInfo {
    name: string;
    displayName: string;
    version: string;
    description: string;
    supportsRealtime: boolean;
    supportsBatchProcessing: boolean;
    requiresApiKey: boolean;
    requiresModelDownload: boolean;
    availableModels: Array<{ value: string; label: string; description?: string; size?: string }>;
}

export class CliPluginManager {
    private plugins: Map<string, BaseTranscriptionPlugin> = new Map();
    private config: AppConfig;

    constructor(config: AppConfig) {
        this.config = config;
        this.registerPlugins();
    }

    private registerPlugins() {
        const parakeet = new ParakeetTranscriptionPlugin(this.config);
        this.plugins.set(parakeet.name, parakeet);
        
        const whisper = new WhisperCppTranscriptionPlugin(this.config);
        this.plugins.set(whisper.name, whisper);

        const vosk = new VoskTranscriptionPlugin(this.config);
        this.plugins.set(vosk.name, vosk);

        const yap = new YapTranscriptionPlugin(this.config);
        this.plugins.set(yap.name, yap);

        const gemini = new GeminiTranscriptionPlugin(this.config);
        this.plugins.set(gemini.name, gemini);

        const mistral = new MistralTranscriptionPlugin(this.config);
        this.plugins.set(mistral.name, mistral);
    }

    getPlugin(name: string): BaseTranscriptionPlugin | undefined {
        return this.plugins.get(name);
    }

    getAllPlugins(): BaseTranscriptionPlugin[] {
        return Array.from(this.plugins.values());
    }

    getPluginInfo(name: string): PluginInfo | undefined {
        const plugin = this.plugins.get(name);
        if (!plugin) return undefined;

        const schema = plugin.getSchema();
        const modelSchema = schema.find(s => s.key === 'model' && s.type === 'model-select');
        const apiKeySchema = schema.find(s => s.type === 'api-key');
        
        return {
            name: plugin.name,
            displayName: plugin.displayName,
            version: plugin.version,
            description: plugin.description,
            supportsRealtime: plugin.supportsRealtime,
            supportsBatchProcessing: plugin.supportsBatchProcessing,
            requiresApiKey: !!apiKeySchema,
            requiresModelDownload: !!modelSchema,
            availableModels: modelSchema?.options || [],
        };
    }

    getAllPluginInfo(): PluginInfo[] {
        return this.getAllPlugins().map(p => this.getPluginInfo(p.name)!);
    }

    async initializePlugin(name: string, options?: Record<string, any>): Promise<boolean> {
        const plugin = this.plugins.get(name);
        if (!plugin) return false;

        if (options) {
            plugin.setOptions(options);
        }

        if (plugin.isPluginInitialized()) return true;

        try {
            await plugin.initialize();
            
            const available = await plugin.isAvailable();
            if (!available) {
                console.warn(`Plugin ${name} is not available`);
                return false;
            }

            const pluginOptions = plugin.getOptions();
            await plugin.ensureModelAvailable(pluginOptions, (progress) => {
                if (progress.status === 'downloading') {
                    console.log(`Downloading model: ${progress.percent}%`);
                }
            }, (log) => console.log(log));

            return true;
        } catch (error) {
            console.error(`Failed to initialize plugin ${name}:`, error);
            return false;
        }
    }

    async downloadModel(pluginName: string, modelName: string, onProgress?: (msg: string, percent: number) => void): Promise<boolean> {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            throw new Error(`Plugin '${pluginName}' not found`);
        }

        const info = this.getPluginInfo(pluginName);
        if (!info?.requiresModelDownload) {
            throw new Error(`Plugin '${pluginName}' does not require model downloads`);
        }

        const validModels = info.availableModels.map(m => m.value);
        if (!validModels.includes(modelName)) {
            throw new Error(`Invalid model '${modelName}' for plugin '${pluginName}'. Available: ${validModels.join(', ')}`);
        }

        try {
            await plugin.downloadModel(modelName, {
                showProgress: (msg, percent) => onProgress?.(msg, percent),
                showDownloadProgress: (p) => onProgress?.(p.message, p.progress),
                hideProgress: () => {},
                showError: (err) => console.error(err),
                showSuccess: (msg) => console.log(msg),
                confirmAction: async () => true,
            });
            return true;
        } catch (error) {
            console.error(`Failed to download model:`, error);
            return false;
        }
    }

    async setApiKey(pluginName: string, apiKey: string): Promise<boolean> {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            throw new Error(`Plugin '${pluginName}' not found`);
        }

        const info = this.getPluginInfo(pluginName);
        if (!info?.requiresApiKey) {
            throw new Error(`Plugin '${pluginName}' does not require an API key`);
        }

        try {
            await plugin.setSecureValue('api_key', apiKey);
            plugin.setOptions({ ...plugin.getOptions(), api_key: apiKey });
            return true;
        } catch (error) {
            console.error(`Failed to set API key:`, error);
            return false;
        }
    }

    async validateApiKey(pluginName: string, apiKey: string): Promise<{ valid: boolean; error?: string }> {
        const plugin = this.plugins.get(pluginName) as any;
        if (!plugin) {
            return { valid: false, error: `Plugin '${pluginName}' not found` };
        }

        if (typeof plugin.validateApiKey !== 'function') {
            return { valid: false, error: `Plugin '${pluginName}' does not support API key validation` };
        }

        return await plugin.validateApiKey(apiKey);
    }

    getConfig(): AppConfig {
        return this.config;
    }
}
