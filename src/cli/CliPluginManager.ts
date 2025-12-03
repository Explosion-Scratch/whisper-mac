import { AppConfig } from "../config/AppConfig";
import { ParakeetTranscriptionPlugin } from "../plugins/ParakeetTranscriptionPlugin";
import { BaseTranscriptionPlugin } from "../plugins/TranscriptionPlugin";
import { WhisperCppTranscriptionPlugin } from "../plugins/WhisperCppTranscriptionPlugin";
import { VoskTranscriptionPlugin } from "../plugins/VoskTranscriptionPlugin";
import { YapTranscriptionPlugin } from "../plugins/YapTranscriptionPlugin";
import { GeminiTranscriptionPlugin } from "../plugins/GeminiTranscriptionPlugin";

export class CliPluginManager {
    private plugins: Map<string, BaseTranscriptionPlugin> = new Map();
    private config: AppConfig;

    constructor(config: AppConfig) {
        this.config = config;
        this.registerPlugins();
    }

    private registerPlugins() {
        // Register Parakeet plugin by default as it's the primary one
        const parakeet = new ParakeetTranscriptionPlugin(this.config);
        this.plugins.set(parakeet.name, parakeet);
        
        // Register other plugins
        const whisper = new WhisperCppTranscriptionPlugin(this.config);
        this.plugins.set(whisper.name, whisper);

        const vosk = new VoskTranscriptionPlugin(this.config);
        this.plugins.set(vosk.name, vosk);

        const yap = new YapTranscriptionPlugin(this.config);
        this.plugins.set(yap.name, yap);

        const gemini = new GeminiTranscriptionPlugin(this.config);
        this.plugins.set(gemini.name, gemini);
    }

    getPlugin(name: string): BaseTranscriptionPlugin | undefined {
        return this.plugins.get(name);
    }

    getAllPlugins(): BaseTranscriptionPlugin[] {
        return Array.from(this.plugins.values());
    }

    async initializePlugin(name: string): Promise<boolean> {
        const plugin = this.plugins.get(name);
        if (!plugin) return false;

        if (plugin.isPluginInitialized()) return true;

        try {
            await plugin.initialize();
            
            // Check availability
            const available = await plugin.isAvailable();
            if (!available) {
                console.warn(`Plugin ${name} is not available (binary missing?)`);
                return false;
            }

            // Ensure model is available
            const options = plugin.getOptions();
            await plugin.ensureModelAvailable(options, (progress) => {
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
}
