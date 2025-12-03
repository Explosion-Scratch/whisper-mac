import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";

// Augment NodeJS Process interface to include resourcesPath
declare global {
    namespace NodeJS {
        interface Process {
            readonly resourcesPath: string;
        }
    }
}

// Polyfill process.resourcesPath for CLI environment
// When running as a compiled binary (bun build --compile), the binary is in bin/
// We assume resources are in the same directory or parent directory depending on structure
// For development (bun run), we can point to the project root or vendor directory
if (!process.resourcesPath) {
    // Check if we are in a bundled environment (e.g. inside .app or just a binary in bin/)
    // If running from source, cwd is project root.
    // If running from binary in bin/, cwd might be anywhere, but __dirname (if preserved) or process.execPath helps.
    
    // Simple heuristic: if vendor exists in cwd, use cwd. Else try to find it relative to execPath.
    if (existsSync(join(process.cwd(), "vendor"))) {
        (process as any).resourcesPath = process.cwd();
    } else {
        // Fallback to directory of executable
        (process as any).resourcesPath = join(process.execPath, "..");
    }
}

// Import these AFTER polyfilling process.resourcesPath
import { AppConfig } from "../config/AppConfig";
import { CliPluginManager } from "./CliPluginManager";
import { WavProcessor } from "../helpers/WavProcessor";

const program = new Command();
const config = new AppConfig();
const pluginManager = new CliPluginManager(config);

// Custom logger to handle verbose mode
const logger = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
};

// Monkey-patch console to suppress output unless verbose
// We will restore it for the final output
const originalConsole = { ...console };
let isVerbose = false;

function setVerbose(verbose: boolean) {
    isVerbose = verbose;
    if (!verbose) {
        console.log = () => {};
        console.warn = () => {};
        console.info = () => {};
        // Keep console.error for fatal errors
    } else {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.info = originalConsole.info;
    }
}

// Default to silent (setVerbose(false) will be called in action if flag not present)

program
    .name("whisper-mac-cli")
    .description("CLI for Whisper Mac transcription")
    .version("1.0.0");

program
    .command("list-plugins")
    .description("List available transcription plugins")
    .action(() => {
        // Always show output for list-plugins
        console.log = originalConsole.log; 
        const plugins = pluginManager.getAllPlugins();
        console.log("Available Plugins:");
        plugins.forEach(p => {
            console.log(`- ${p.name} (${p.version}): ${p.description}`);
        });
    });

program
    .command("transcribe")
    .description("Transcribe an audio file")
    .argument("<file>", "Path to audio file")
    .option("-p, --plugin <plugin>", "Plugin to use", "parakeet")
    .option("-m, --model <model>", "Model to use")
    .option("-o, --output <format>", "Output format (json, text, srt, vtt)", "text")
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

        if (options.verbose) {
            originalConsole.log(`Using plugin: ${plugin.name}`);
            originalConsole.log(`Input file: ${filePath}`);
        }

        // Initialize plugin
        const initialized = await pluginManager.initializePlugin(pluginName);
        if (!initialized) {
            originalConsole.error(`Failed to initialize plugin ${pluginName}`);
            process.exit(1);
        }

        // Check and convert audio file if necessary (Parakeet requires 16-bit)
        let fileToTranscribe = filePath;
        let tempConvertedFile: string | null = null;

        try {
            const fd = readFileSync(filePath);
            const view = new DataView(fd.buffer);
            
            // Check if it's a WAV file
            const isWav = view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
            
            if (isWav) {
                const bitsPerSample = view.getUint16(34, true);
                const audioFormat = view.getUint16(20, true);
                
                if (bitsPerSample === 32) {
                    if (options.verbose) originalConsole.log("Detected 32-bit WAV, converting to 16-bit...");
                    
                    // Find data chunk
                    let offset = 12;
                    while (offset < fd.length) {
                        const chunkId = view.getUint32(offset, false);
                        const chunkSize = view.getUint32(offset + 4, true);
                        
                        if (chunkId === 0x64617461) { // "data"
                            const dataOffset = offset + 8;
                            const dataLength = chunkSize;
                            
                            let audioData: Float32Array;
                            
                            if (audioFormat === 3) { // IEEE Float
                                audioData = new Float32Array(fd.buffer.slice(dataOffset, dataOffset + dataLength));
                            } else if (audioFormat === 1) { // PCM
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
            // Proceed with original file and let the plugin handle/fail
        }

        // Start transcription
        try {
            if (options.verbose) originalConsole.log("Starting transcription...");
            
            await plugin.startTranscription((update) => {
                if (options.verbose) {
                    // console.log("Update:", JSON.stringify(update, null, 2));
                }
            });

            const resultText = await plugin.transcribeFile(fileToTranscribe);
            
            if (options.output === 'json') {
                originalConsole.log(JSON.stringify({ text: resultText }, null, 2));
            } else {
                originalConsole.log(resultText);
            }

            await plugin.stopTranscription();
        } catch (error: any) {
            originalConsole.error("Transcription failed:", error.message);
            process.exit(1);
        } finally {
            // Cleanup temp file
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

program.parse();
