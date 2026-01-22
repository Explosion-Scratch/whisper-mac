import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync, readFileSync, mkdirSync } from "fs";

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
        (process as any).resourcesPath = join(process.execPath, "..");
    }
}

import { AppConfig } from "../config/AppConfig";
import { CliPluginManager, PluginInfo } from "./CliPluginManager";
import { WavProcessor } from "../helpers/WavProcessor";

const program = new Command();
const config = new AppConfig();
const pluginManager = new CliPluginManager(config);

const originalConsole = { ...console };
let isVerbose = false;

function setVerbose(verbose: boolean) {
    isVerbose = verbose;
    if (!verbose) {
        console.log = () => {};
        console.warn = () => {};
        console.info = () => {};
    } else {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.info = originalConsole.info;
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function printPluginTable(plugins: PluginInfo[]) {
    const nameWidth = 15;
    const typeWidth = 12;
    const descWidth = 50;
    
    originalConsole.log('\n' + '─'.repeat(nameWidth + typeWidth + descWidth + 8));
    originalConsole.log(
        'Plugin'.padEnd(nameWidth) + ' │ ' +
        'Type'.padEnd(typeWidth) + ' │ ' +
        'Description'
    );
    originalConsole.log('─'.repeat(nameWidth + typeWidth + descWidth + 8));
    
    for (const p of plugins) {
        const type = p.requiresApiKey ? 'Cloud API' : 'Local';
        originalConsole.log(
            p.name.padEnd(nameWidth) + ' │ ' +
            type.padEnd(typeWidth) + ' │ ' +
            p.description.slice(0, descWidth)
        );
    }
    originalConsole.log('─'.repeat(nameWidth + typeWidth + descWidth + 8) + '\n');
}

program
    .name("whisper-mac-cli")
    .description("CLI for Whisper Mac transcription - supports multiple transcription engines")
    .version("1.0.0");

program
    .command("list-plugins")
    .alias("plugins")
    .description("List available transcription plugins")
    .option("-j, --json", "Output as JSON")
    .action((options) => {
        console.log = originalConsole.log;
        const plugins = pluginManager.getAllPluginInfo();
        
        if (options.json) {
            originalConsole.log(JSON.stringify(plugins, null, 2));
        } else {
            printPluginTable(plugins);
        }
    });

program
    .command("plugin-info")
    .alias("info")
    .description("Show detailed information about a plugin")
    .argument("<plugin>", "Plugin name")
    .option("-j, --json", "Output as JSON")
    .action((pluginName, options) => {
        console.log = originalConsole.log;
        const info = pluginManager.getPluginInfo(pluginName);
        
        if (!info) {
            originalConsole.error(`Plugin '${pluginName}' not found`);
            process.exit(1);
        }
        
        if (options.json) {
            originalConsole.log(JSON.stringify(info, null, 2));
        } else {
            originalConsole.log(`\n${info.displayName} (${info.name})`);
            originalConsole.log('─'.repeat(50));
            originalConsole.log(`Version: ${info.version}`);
            originalConsole.log(`Description: ${info.description}`);
            originalConsole.log(`Type: ${info.requiresApiKey ? 'Cloud API' : 'Local'}`);
            originalConsole.log(`Realtime: ${info.supportsRealtime ? 'Yes' : 'No'}`);
            originalConsole.log(`Batch Processing: ${info.supportsBatchProcessing ? 'Yes' : 'No'}`);
            
            if (info.requiresApiKey) {
                originalConsole.log(`\nRequires API key: Yes`);
                originalConsole.log(`Set with: whisper-mac-cli set-api-key ${pluginName} <key>`);
            }
            
            if (info.availableModels.length > 0) {
                originalConsole.log(`\nAvailable Models:`);
                for (const model of info.availableModels) {
                    const size = model.size ? ` (${model.size})` : '';
                    originalConsole.log(`  - ${model.value}: ${model.label}${size}`);
                    if (model.description) {
                        originalConsole.log(`    ${model.description}`);
                    }
                }
            }
            originalConsole.log('');
        }
    });

program
    .command("list-models")
    .alias("models")
    .description("List available models for a plugin")
    .argument("<plugin>", "Plugin name")
    .option("-j, --json", "Output as JSON")
    .action((pluginName, options) => {
        console.log = originalConsole.log;
        const info = pluginManager.getPluginInfo(pluginName);
        
        if (!info) {
            originalConsole.error(`Plugin '${pluginName}' not found`);
            process.exit(1);
        }
        
        if (!info.requiresModelDownload) {
            originalConsole.log(`Plugin '${pluginName}' uses cloud-based models (no downloads required)`);
            if (info.availableModels.length > 0) {
                originalConsole.log('\nAvailable models:');
                for (const model of info.availableModels) {
                    originalConsole.log(`  - ${model.value}: ${model.label}`);
                }
            }
            return;
        }
        
        if (options.json) {
            originalConsole.log(JSON.stringify(info.availableModels, null, 2));
        } else {
            originalConsole.log(`\nModels for ${info.displayName}:`);
            originalConsole.log('─'.repeat(60));
            for (const model of info.availableModels) {
                const size = model.size ? ` [${model.size}]` : '';
                originalConsole.log(`${model.value}${size}`);
                originalConsole.log(`  ${model.label}`);
                if (model.description) {
                    originalConsole.log(`  ${model.description}`);
                }
                originalConsole.log('');
            }
        }
    });

program
    .command("download-model")
    .alias("download")
    .description("Download a model for a plugin")
    .argument("<plugin>", "Plugin name")
    .argument("<model>", "Model name")
    .option("-v, --verbose", "Verbose output")
    .action(async (pluginName, modelName, options) => {
        setVerbose(!!options.verbose);
        
        const info = pluginManager.getPluginInfo(pluginName);
        if (!info) {
            originalConsole.error(`Plugin '${pluginName}' not found`);
            process.exit(1);
        }
        
        if (!info.requiresModelDownload) {
            originalConsole.log(`Plugin '${pluginName}' uses cloud-based models (no downloads required)`);
            return;
        }
        
        originalConsole.log(`Downloading model '${modelName}' for ${info.displayName}...`);
        
        try {
            const success = await pluginManager.downloadModel(pluginName, modelName, (msg, percent) => {
                if (percent !== undefined) {
                    process.stdout.write(`\r${msg} ${percent}%`);
                } else {
                    originalConsole.log(msg);
                }
            });
            
            if (success) {
                originalConsole.log(`\nModel '${modelName}' downloaded successfully`);
            } else {
                originalConsole.error(`\nFailed to download model '${modelName}'`);
                process.exit(1);
            }
        } catch (error: any) {
            originalConsole.error(`\nError: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command("set-api-key")
    .description("Set API key for a cloud-based plugin")
    .argument("<plugin>", "Plugin name (gemini or mistral)")
    .argument("<api-key>", "API key")
    .option("--validate", "Validate the API key before saving")
    .action(async (pluginName, apiKey, options) => {
        const info = pluginManager.getPluginInfo(pluginName);
        if (!info) {
            originalConsole.error(`Plugin '${pluginName}' not found`);
            process.exit(1);
        }
        
        if (!info.requiresApiKey) {
            originalConsole.error(`Plugin '${pluginName}' does not require an API key`);
            process.exit(1);
        }
        
        if (options.validate) {
            originalConsole.log(`Validating API key for ${info.displayName}...`);
            const result = await pluginManager.validateApiKey(pluginName, apiKey);
            if (!result.valid) {
                originalConsole.error(`API key validation failed: ${result.error}`);
                process.exit(1);
            }
            originalConsole.log('API key is valid');
        }
        
        try {
            await pluginManager.setApiKey(pluginName, apiKey);
            originalConsole.log(`API key set successfully for ${info.displayName}`);
        } catch (error: any) {
            originalConsole.error(`Failed to set API key: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command("config")
    .description("Show configuration paths and settings")
    .option("-j, --json", "Output as JSON")
    .action((options) => {
        console.log = originalConsole.log;
        const cfg = pluginManager.getConfig();
        
        const configData = {
            dataDir: cfg.dataDir,
            modelsDir: cfg.getModelsDir(),
            cacheDir: cfg.getCacheDir(),
        };
        
        if (options.json) {
            originalConsole.log(JSON.stringify(configData, null, 2));
        } else {
            originalConsole.log('\nWhisper Mac Configuration:');
            originalConsole.log('─'.repeat(50));
            originalConsole.log(`Data Directory: ${configData.dataDir}`);
            originalConsole.log(`Models Directory: ${configData.modelsDir}`);
            originalConsole.log(`Cache Directory: ${configData.cacheDir}`);
            originalConsole.log('');
        }
    });

program
    .command("transcribe")
    .description("Transcribe an audio file")
    .argument("<file>", "Path to audio file")
    .option("-p, --plugin <plugin>", "Plugin to use", "parakeet")
    .option("-m, --model <model>", "Model to use (for local plugins)")
    .option("-k, --api-key <key>", "API key (for cloud plugins, overrides stored key)")
    .option("-o, --output <format>", "Output format (json, text)", "text")
    .option("-v, --verbose", "Verbose output")
    .action(async (file, options) => {
        setVerbose(!!options.verbose);

        const filePath = resolve(file);
        if (!existsSync(filePath)) {
            originalConsole.error(`File not found: ${filePath}`);
            process.exit(1);
        }

        const pluginName = options.plugin;
        const plugin = pluginManager.getPlugin(pluginName);

        if (!plugin) {
            originalConsole.error(`Plugin '${pluginName}' not found. Use 'list-plugins' to see available plugins.`);
            process.exit(1);
        }

        const info = pluginManager.getPluginInfo(pluginName);
        if (options.verbose) {
            originalConsole.log(`Using plugin: ${info?.displayName || plugin.name}`);
            originalConsole.log(`Input file: ${filePath}`);
        }

        const pluginOptions: Record<string, any> = {};
        
        if (options.model) {
            pluginOptions.model = options.model;
        }
        
        if (options.apiKey) {
            pluginOptions.api_key = options.apiKey;
        }

        const initialized = await pluginManager.initializePlugin(pluginName, pluginOptions);
        if (!initialized) {
            if (info?.requiresApiKey && !options.apiKey) {
                originalConsole.error(`Plugin ${pluginName} requires an API key. Use --api-key or 'set-api-key' command.`);
            } else {
                originalConsole.error(`Failed to initialize plugin ${pluginName}`);
            }
            process.exit(1);
        }

        let fileToTranscribe = filePath;
        let tempConvertedFile: string | null = null;

        try {
            const fd = readFileSync(filePath);
            const view = new DataView(fd.buffer);
            
            const isWav = view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
            
            if (isWav) {
                const bitsPerSample = view.getUint16(34, true);
                const audioFormat = view.getUint16(20, true);
                
                if (bitsPerSample === 32) {
                    if (options.verbose) originalConsole.log("Detected 32-bit WAV, converting to 16-bit...");
                    
                    let offset = 12;
                    while (offset < fd.length) {
                        const chunkId = view.getUint32(offset, false);
                        const chunkSize = view.getUint32(offset + 4, true);
                        
                        if (chunkId === 0x64617461) {
                            const dataOffset = offset + 8;
                            const dataLength = chunkSize;
                            
                            let audioData: Float32Array;
                            
                            if (audioFormat === 3) {
                                audioData = new Float32Array(fd.buffer.slice(dataOffset, dataOffset + dataLength));
                            } else if (audioFormat === 1) {
                                const int32Data = new Int32Array(fd.buffer.slice(dataOffset, dataOffset + dataLength));
                                audioData = new Float32Array(int32Data.length);
                                for (let i = 0; i < int32Data.length; i++) {
                                    audioData[i] = int32Data[i] / 2147483648.0;
                                }
                            } else {
                                throw new Error(`Unsupported 32-bit WAV format: ${audioFormat}`);
                            }
                            
                            const { tmpdir } = require("os");
                            tempConvertedFile = await WavProcessor.saveAudioAsWav(audioData, tmpdir());
                            fileToTranscribe = tempConvertedFile;
                            break;
                        }
                        
                        offset += 8 + chunkSize;
                    }
                }
            }
        } catch (e: any) {
            if (options.verbose) originalConsole.warn("Failed to check/convert audio file:", e.message);
        }

        try {
            if (options.verbose) originalConsole.log("Starting transcription...");
            
            await plugin.startTranscription((update) => {
                if (options.verbose) {
                    // Progress updates
                }
            });

            const resultText = await plugin.transcribeFile(fileToTranscribe);
            
            if (options.output === 'json') {
                originalConsole.log(JSON.stringify({ 
                    text: resultText,
                    plugin: pluginName,
                    model: options.model || 'default',
                    file: filePath
                }, null, 2));
            } else {
                originalConsole.log(resultText);
            }

            await plugin.stopTranscription();
        } catch (error: any) {
            originalConsole.error("Transcription failed:", error.message);
            process.exit(1);
        } finally {
            if (tempConvertedFile && existsSync(tempConvertedFile)) {
                try {
                    const { unlinkSync } = require("fs");
                    unlinkSync(tempConvertedFile);
                } catch (e) {
                    // ignore
                }
            }
        }
    });

program
    .command("check-plugin")
    .description("Check if a plugin is available and properly configured")
    .argument("<plugin>", "Plugin name")
    .option("-k, --api-key <key>", "API key to test (for cloud plugins)")
    .action(async (pluginName, options) => {
        console.log = originalConsole.log;
        
        const info = pluginManager.getPluginInfo(pluginName);
        if (!info) {
            originalConsole.error(`Plugin '${pluginName}' not found`);
            process.exit(1);
        }
        
        originalConsole.log(`\nChecking ${info.displayName}...`);
        
        const plugin = pluginManager.getPlugin(pluginName);
        if (!plugin) {
            originalConsole.error('Plugin instance not found');
            process.exit(1);
        }
        
        try {
            await plugin.initialize();
            originalConsole.log('✓ Plugin initialized');
        } catch (e: any) {
            originalConsole.error(`✗ Plugin initialization failed: ${e.message}`);
            process.exit(1);
        }
        
        if (info.requiresApiKey) {
            const apiKey = options.apiKey;
            if (apiKey) {
                originalConsole.log('  Validating API key...');
                const result = await pluginManager.validateApiKey(pluginName, apiKey);
                if (result.valid) {
                    originalConsole.log('✓ API key is valid');
                } else {
                    originalConsole.error(`✗ API key validation failed: ${result.error}`);
                }
            } else {
                originalConsole.log('  (Provide --api-key to validate)');
            }
        }
        
        const available = await plugin.isAvailable();
        if (available) {
            originalConsole.log('✓ Plugin is available');
        } else {
            originalConsole.error('✗ Plugin is not available (check dependencies)');
            process.exit(1);
        }
        
        if (info.requiresModelDownload) {
            const cfg = pluginManager.getConfig();
            const modelsDir = cfg.getModelsDir();
            
            if (existsSync(modelsDir)) {
                const { readdirSync } = require('fs');
                const files = readdirSync(modelsDir);
                const relevantFiles = files.filter((f: string) => {
                    if (pluginName === 'whisper-cpp') return f.endsWith('.bin');
                    if (pluginName === 'parakeet') return f.startsWith('parakeet');
                    return false;
                });
                
                if (relevantFiles.length > 0) {
                    originalConsole.log(`✓ Models found: ${relevantFiles.join(', ')}`);
                } else {
                    originalConsole.log('  No models downloaded yet');
                }
            }
        }
        
        originalConsole.log('\n');
    });

program.parse();
