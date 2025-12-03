// import "isomorphic-fetch";
import { spawn } from "child_process";
import {
    unlinkSync,
    mkdtempSync,
    existsSync,
    readFileSync,
    createWriteStream,
    mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { v4 as uuidv4 } from "uuid";
import * as https from "https";
import { AppConfig } from "../config/AppConfig";
import {
    Segment,
    TranscribedSegment,
    InProgressSegment,
    SegmentUpdate,
} from "../types/SegmentTypes";
import {
    BaseTranscriptionPlugin,
    TranscriptionSetupProgress,
    PluginSchemaItem,
    PluginUIFunctions,
} from "./TranscriptionPlugin";
import { WavProcessor } from "../helpers/WavProcessor";

/**
 * Parakeet transcription plugin using custom Rust backend
 */
export class ParakeetTranscriptionPlugin extends BaseTranscriptionPlugin {
    readonly name = "parakeet";
    readonly displayName = "Parakeet";
    readonly version = "0.1.0";
    readonly description =
        "Fast Parakeet-based transcription using local Rust backend";
    readonly supportsRealtime = false; // Parakeet might be fast enough, but let's start with batch
    readonly supportsBatchProcessing = true;

    private config: AppConfig;
    private sessionUid: string = "";
    private currentSegments: Segment[] = [];
    private tempDir: string;
    private binaryPath: string;
    private modelPath: string = "";
    private isCurrentlyTranscribing = false;
    private warmupTimer: NodeJS.Timeout | null = null;
    private isWarmupRunning = false;
    private isWindowVisible = false;

    constructor(config: AppConfig) {
        super();
        this.config = config;
        this.tempDir = mkdtempSync(join(tmpdir(), "parakeet-plugin-"));
        this.binaryPath = this.resolveBinaryPath();

        // Initialize schema
        this.schema = this.getSchema();
    }

    getFallbackChain(): string[] {
        return ["whisper-cpp", "vosk"];
    }

    private resolveBinaryPath(): string {
        // Try production bundled path first
        const packagedPath = join(
            process.resourcesPath,
            "parakeet-backend",
        );
        if (existsSync(packagedPath)) {
            return packagedPath;
        }

        // Fall back to development path
        const devPath = join(
            process.cwd(),
            "native",
            "parakeet-backend",
            "target",
            "release",
            "parakeet-backend"
        );
        if (existsSync(devPath)) {
            return devPath;
        }

        return "parakeet-backend";
    }

    private resolveModelPath(): string {
        const modelName = this.options.model || "parakeet-tdt-0.6b-v3-onnx";
        const userModelPath = join(this.config.getModelsDir(), modelName);
        return userModelPath;
    }

    async isAvailable(): Promise<boolean> {
        try {
            return new Promise((resolve) => {
                const process = spawn(this.binaryPath, ["--help"], {
                    stdio: ["ignore", "pipe", "pipe"],
                });

                process.on("close", (code) => {
                    resolve(code === 0);
                });

                process.on("error", () => {
                    resolve(false);
                });
            });
        } catch (error) {
            return false;
        }
    }

    async startTranscription(
        onUpdate: (update: SegmentUpdate) => void,
        onProgress?: (progress: TranscriptionSetupProgress) => void,
        onLog?: (line: string) => void,
    ): Promise<void> {
        if (this.isRunning) {
            return;
        }

        try {
            onProgress?.({
                status: "starting",
                message: "Initializing Parakeet plugin",
            });

            this.modelPath = this.resolveModelPath();

            // Check if model exists
            if (!existsSync(this.modelPath)) {
                throw new Error(`Model not found at ${this.modelPath}. Please download it first.`);
            }

            this.setTranscriptionCallback(onUpdate);
            this.sessionUid = uuidv4();
            this.currentSegments = [];
            this.setRunning(true);

            onProgress?.({ status: "complete", message: "Parakeet plugin ready" });
        } catch (error: any) {
            this.setRunning(false);
            onProgress?.({
                status: "error",
                message: `Failed to start plugin: ${error.message}`,
            });
            throw error;
        }
    }

    async processAudioSegment(audioData: Float32Array): Promise<void> {
        if (!this.isRunning || !this.onTranscriptionCallback) {
            return;
        }

        try {
            this.isCurrentlyTranscribing = true;
            const tempAudioPath = await this.saveAudioAsWav(audioData);

            const inProgressSegment: InProgressSegment = {
                id: uuidv4(),
                type: "inprogress",
                text: "Transcribing...",
                timestamp: Date.now(),
            };

            this.currentSegments = [inProgressSegment];
            this.onTranscriptionCallback({
                segments: [...this.currentSegments],
                sessionUid: this.sessionUid,
            });

            const result = await this.transcribeWithBinary(tempAudioPath);

            // Clean up temp file
            try {
                unlinkSync(tempAudioPath);
            } catch (err) {
                console.warn("Failed to delete temp audio file:", err);
            }

            const completedSegment: TranscribedSegment = {
                id: uuidv4(),
                type: "transcribed",
                text: result.text,
                completed: true,
                timestamp: Date.now(),
                start: result.segments[0]?.start,
                end: result.segments[result.segments.length - 1]?.end,
            };

            this.currentSegments = [completedSegment];
            if (this.onTranscriptionCallback) {
                this.onTranscriptionCallback({
                    segments: [...this.currentSegments],
                    sessionUid: this.sessionUid,
                });
            }
        } catch (error: any) {
            console.error("Failed to process audio segment:", error);
            const errorSegment: TranscribedSegment = {
                id: uuidv4(),
                type: "transcribed",
                text: "[Transcription failed]",
                completed: true,
                timestamp: Date.now(),
                confidence: 0,
            };
            this.currentSegments = [errorSegment];
            if (this.onTranscriptionCallback) {
                this.onTranscriptionCallback({
                    segments: [...this.currentSegments],
                    sessionUid: this.sessionUid,
                });
            }
        } finally {
            this.isCurrentlyTranscribing = false;
        }
    }

    async transcribeFile(filePath: string): Promise<string> {
        const result = await this.transcribeWithBinary(filePath);
        return result.text;
    }

    async stopTranscription(): Promise<void> {
        this.setRunning(false);
        this.setTranscriptionCallback(null);
        this.currentSegments = [];
        this.isCurrentlyTranscribing = false;
    }

    async cleanup(): Promise<void> {
        await this.stopTranscription();
        try {
            const { readdirSync } = require("fs");
            const files = readdirSync(this.tempDir);
            for (const file of files) {
                unlinkSync(join(this.tempDir, file));
            }
        } catch (err) {
            console.warn("Failed to clean temp directory:", err);
        }
    }



    getSchema(): PluginSchemaItem[] {
        return [{
            key: "runOnAll",
            type: "boolean",
            label: "Process All Audio Together",
            description:
                "When enabled, processes all audio segments together for better context. When disabled, processes each segment individually.",
            default: false,
            category: "advanced",
        }
    ];
    }

    // Files needed for Parakeet TDT model
    private readonly modelFiles = [
        { remote: "encoder-model.int8.onnx", local: "encoder-model.onnx" },
        { remote: "decoder_joint-model.int8.onnx", local: "decoder_joint-model.onnx" },
        { remote: "nemo128.onnx", local: "nemo128.onnx" },
        { remote: "vocab.txt", local: "vocab.txt" },
    ];

    private readonly hfRepo = "istupakov/parakeet-tdt-0.6b-v3-onnx";

    async downloadModel(
        modelName: string,
        uiFunctions?: PluginUIFunctions,
    ): Promise<void> {
        const modelDir = join(this.config.getModelsDir(), modelName);
        if (!existsSync(modelDir)) {
            mkdirSync(modelDir, { recursive: true });
        }

        this.setLoadingState(true, `Downloading ${modelName}...`);

        try {
            let completedFiles = 0;
            const totalFiles = this.modelFiles.length;

            for (const file of this.modelFiles) {
                const url = `https://huggingface.co/${this.hfRepo}/resolve/main/${file.remote}`;
                const destPath = join(modelDir, file.local);

                if (existsSync(destPath)) {
                    completedFiles++;
                    continue;
                }

                if (uiFunctions) {
                    uiFunctions.showProgress(
                        `Downloading ${file.local} (${completedFiles + 1}/${totalFiles})...`,
                        Math.round((completedFiles / totalFiles) * 100),
                    );
                }

                await this.downloadFileWithProgress(
                    url,
                    destPath,
                    file.local,
                    (percent) => {
                        const totalPercent = Math.round(
                            ((completedFiles + percent / 100) / totalFiles) * 100,
                        );
                        uiFunctions?.showProgress(
                            `Downloading ${file.local}... ${percent}%`,
                            totalPercent,
                        );
                    },
                );

                completedFiles++;
            }

            if (uiFunctions) {
                uiFunctions.showSuccess(`Model ${modelName} downloaded successfully`);
                uiFunctions.hideProgress();
            }
            this.setLoadingState(false);
        } catch (error: any) {
            const errorMsg = `Failed to download model: ${error.message}`;
            this.setError(errorMsg);
            this.setLoadingState(false);
            if (uiFunctions) {
                uiFunctions.showError(errorMsg);
                uiFunctions.hideProgress();
            }
            throw error;
        }
    }

    async ensureModelAvailable(
        options: Record<string, any>,
        onProgress?: (progress: any) => void,
        onLog?: (line: string) => void,
    ): Promise<boolean> {
        const modelName = options.model || "parakeet-tdt-0.6b-v3-onnx";
        const modelDir = join(this.config.getModelsDir(), modelName);

        // Check if all files exist
        const allFilesExist = this.modelFiles.every((file) =>
            existsSync(join(modelDir, file.local)),
        );

        if (allFilesExist) {
            onLog?.(`Parakeet model ${modelName} already available`);
            return true;
        }

        try {
            await this.downloadModel(modelName, {
                showProgress: (message: string, percent: number) => {
                    onProgress?.({
                        message,
                        percent,
                        status: percent >= 100 ? "complete" : "downloading",
                    });
                },
                showDownloadProgress: (downloadProgress: any) => {
                    onProgress?.(downloadProgress);
                },
                hideProgress: () => { },
                showError: (error: string) => {
                    onLog?.(`Error: ${error}`);
                },
                showSuccess: (message: string) => {
                    onLog?.(message);
                },
                confirmAction: async () => true,
            });
            return true;
        } catch (error: any) {
            onLog?.(`Failed to download model ${modelName}: ${error.message}`);
            throw error;
        }
    }

    private async downloadFileWithProgress(
        url: string,
        destPath: string,
        fileName: string,
        onProgress?: (percent: number) => void,
    ): Promise<void> {
        console.log(`Downloading ${url} to ${destPath}...`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download ${fileName}: ${response.statusText} (${response.status})`);
        }

        const totalBytes = parseInt(response.headers.get("content-length") || "0", 10);
        let downloadedBytes = 0;
        const fileStream = createWriteStream(destPath);

        if (response.body && typeof (response.body as any).pipe === 'function') {
            // Node-fetch v2 style (Node stream)
            return new Promise((resolve, reject) => {
                (response.body as any).on("data", (chunk: Buffer) => {
                    downloadedBytes += chunk.length;
                    const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
                    onProgress?.(percent);
                });

                (response.body as any).pipe(fileStream);

                fileStream.on("finish", () => {
                    onProgress?.(100);
                    resolve();
                });

                fileStream.on("error", (error: any) => reject(error));
                (response.body as any).on("error", (error: any) => reject(error));
            });
        } else if (response.body) {
            // Web Streams API (standard fetch)
            const reader = response.body.getReader();

            return new Promise(async (resolve, reject) => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        if (value) {
                            downloadedBytes += value.length;
                            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
                            onProgress?.(percent);
                            fileStream.write(Buffer.from(value));
                        }
                    }

                    fileStream.end();
                    fileStream.on("finish", () => {
                        onProgress?.(100);
                        resolve();
                    });
                } catch (error) {
                    reject(error);
                }
            });
        } else {
            throw new Error("Response body is empty");
        }
    }

    // Helpers

    private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
        return WavProcessor.saveAudioAsWav(audioData, this.tempDir, {
            sampleRate: 16000,
            numChannels: 1,
            bitsPerSample: 16,
        });
    }

    private async transcribeWithBinary(audioPath: string): Promise<{ text: string; segments: any[] }> {
        return new Promise((resolve, reject) => {
            const args = [
                "--file",
                audioPath,
                "--model",
                this.modelPath,
                "--output",
                "json",
            ];

            const process = spawn(this.binaryPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            process.stdout?.on("data", (data) => {
                stdout += data.toString();
            });

            process.stderr?.on("data", (data) => {
                stderr += data.toString();
            });

            process.on("close", (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON output: ${stdout}`));
                    }
                } else {
                    reject(new Error(`Parakeet binary failed with code ${code}: ${stderr}`));
                }
            });
        });
    }

    onDictationWindowShow(): void {
        this.isWindowVisible = true;
    }

    onDictationWindowHide(): void {
        this.isWindowVisible = false;
    }

    private startWarmupLoop() {
        if (this.warmupTimer) return;
        this.warmupTimer = setInterval(() => {
            this.runWarmupIfIdle();
        }, 5000);
    }

    private stopWarmupLoop() {
        if (this.warmupTimer) {
            clearInterval(this.warmupTimer);
            this.warmupTimer = null;
        }
    }

    private async runWarmupIfIdle() {
        if (this.isWarmupRunning) return;
        if (!this.isPluginActive()) return;
        if (this.isCurrentlyTranscribing) return;
        if (this.isWindowVisible) return;

        this.isWarmupRunning = true;
        try {
            const dummy = new Float32Array(16000);
            const tempAudioPath = await this.saveAudioAsWav(dummy);

            try {
                await this.transcribeWithBinary(tempAudioPath);
                unlinkSync(tempAudioPath);
            } catch (e) {
                // Ignore warmup errors
            }
        } catch (e) {
            // Ignore warmup errors
        } finally {
            this.isWarmupRunning = false;
        }
    }

    // Required abstract methods
    async validateOptions(options: Record<string, any>): Promise<{ valid: boolean; errors: string[] }> {
        return { valid: true, errors: [] };
    }

    async onActivated(uiFunctions?: any): Promise<void> {
        this.setActive(true);
        this.startWarmupLoop();
        this.runWarmupIfIdle();
    }
    async initialize(): Promise<void> {
        this.setInitialized(true);
    }
    async destroy(): Promise<void> {
        this.stopWarmupLoop();
    }
    async onDeactivate(): Promise<void> {
        this.setActive(false);
        this.stopWarmupLoop();
    }
    getDataPath(): string { return this.config.getModelsDir(); }
    async listData(): Promise<any[]> { return []; }
    async deleteDataItem(id: string): Promise<void> { }
    async deleteAllData(): Promise<void> { }
    async updateOptions(options: Record<string, any>): Promise<void> {
        this.setOptions(options);
    }
}
