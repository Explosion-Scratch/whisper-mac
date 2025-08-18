import { spawn, ChildProcess } from "child_process";
import {
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { v4 as uuidv4 } from "uuid";
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
  TranscriptionPluginConfigSchema,
} from "./TranscriptionPlugin";
import { readPrompt } from "../helpers/getPrompt";

/**
 * Whisper.cpp transcription plugin
 */
export class WhisperCppTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "whisper-cpp";
  readonly displayName = "Whisper.cpp";
  readonly version = "1.7.6";
  readonly description =
    "High-performance C++ implementation of OpenAI Whisper for local transcription";
  readonly supportsRealtime = true;
  readonly supportsBatchProcessing = true;

  private config: AppConfig;
  private sessionUid: string = "";
  private currentSegments: Segment[] = [];
  private tempDir: string;
  private whisperBinaryPath: string;
  private modelPath: string;
  private vadModelPath?: string;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "whisper-cpp-plugin-"));
    this.whisperBinaryPath = this.resolveWhisperBinaryPath();
    this.modelPath = this.resolveModelPath();
    this.vadModelPath = this.resolveVadModelPath();
  }

  private resolveWhisperBinaryPath(): string {
    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "whisper-cpp",
      "whisper-cli"
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(process.cwd(), "vendor", "whisper-cpp", "whisper-cli");
    if (existsSync(devPath)) {
      return devPath;
    }

    // Fall back to system whisper-cli (if installed)
    return "whisper-cli";
  }

  private resolveModelPath(): string {
    // Default to base.en model
    const modelName = this.config.get("whisperCppModel") || "ggml-base.en.bin";

    // Models are now stored directly as files in the models directory
    const userModelPath = join(this.config.getModelsDir(), modelName);
    if (existsSync(userModelPath)) {
      return userModelPath;
    }

    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "whisper-cpp",
      "models",
      modelName
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(
      process.cwd(),
      "vendor",
      "whisper-cpp",
      "models",
      modelName
    );
    if (existsSync(devPath)) {
      return devPath;
    }

    // Return expected path for download
    return userModelPath;
  }

  private resolveVadModelPath(): string | undefined {
    const vadModelName = "ggml-silero-v5.1.2.bin";

    // Prefer user-downloaded models directory first
    const userVadPath = join(this.config.getModelsDir(), vadModelName);
    if (existsSync(userVadPath)) {
      return userVadPath;
    }

    // Try production bundled path first
    const packagedPath = join(
      process.resourcesPath,
      "whisper-cpp",
      "models",
      vadModelName
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }

    // Fall back to development vendor path
    const devPath = join(
      process.cwd(),
      "vendor",
      "whisper-cpp",
      "models",
      vadModelName
    );
    if (existsSync(devPath)) {
      return devPath;
    }

    return undefined;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Refresh paths from current config in case onboarding updated them
      this.modelPath = this.resolveModelPath();
      this.vadModelPath = this.resolveVadModelPath();

      // Check if whisper binary and model exist
      if (!existsSync(this.modelPath)) {
        console.log(`Whisper.cpp model not found at: ${this.modelPath}`);
        return false;
      }

      // Check if whisper binary exists and is executable
      return new Promise((resolve) => {
        const whisperProcess = spawn(this.whisperBinaryPath, ["--help"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        console.log("Whisper.cpp binary check started", this.whisperBinaryPath);

        let hasOutput = false;
        whisperProcess.stdout?.on("data", (data) => {
          console.log("Whisper.cpp data: ", data.toString());
          hasOutput = true;
        });

        whisperProcess.on("close", (code) => {
          console.log("Whisper.cpp binary check closed with code:", {
            code,
            hasOutput,
          });
          resolve(code === 0); // Some versions return 1 for --help
        });

        whisperProcess.on("error", (error) => {
          console.log("Whisper.cpp binary check failed:", error.message);
          resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!whisperProcess.killed) {
            console.log("Whisper.cpp binary check timed out");
            whisperProcess.kill();
            resolve(false);
          }
        }, 5000);
      });
    } catch (error) {
      console.error("Whisper.cpp availability check failed:", error);
      return false;
    }
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    console.log("=== Starting Whisper.cpp transcription plugin ===");

    if (this.isRunning) {
      onLog?.("[Whisper.cpp Plugin] Service already running");
      onProgress?.({ status: "complete", message: "Whisper.cpp plugin ready" });
      return;
    }

    try {
      // Refresh paths in case onboarding updated them
      this.modelPath = this.resolveModelPath();
      this.vadModelPath = this.resolveVadModelPath();

      onProgress?.({
        status: "starting",
        message: "Initializing Whisper.cpp plugin",
      });

      this.setTranscriptionCallback(onUpdate);
      this.sessionUid = uuidv4();
      this.currentSegments = [];
      this.setRunning(true);

      onProgress?.({ status: "complete", message: "Whisper.cpp plugin ready" });
      onLog?.(
        "[Whisper.cpp Plugin] Service initialized and ready for audio segments"
      );
    } catch (error: any) {
      console.error("Failed to start Whisper.cpp plugin:", error);
      this.setRunning(false);
      onProgress?.({
        status: "error",
        message: `Failed to start plugin: ${error.message}`,
      });

      this.emit("error", error);
      throw error;
    }
  }

  async processAudioSegment(audioData: Float32Array): Promise<void> {
    if (!this.isRunning || !this.onTranscriptionCallback) {
      console.log("Whisper.cpp plugin not running, ignoring audio segment");
      return;
    }

    try {
      console.log(`Processing audio segment: ${audioData.length} samples`);

      // Create temporary WAV file for whisper.cpp
      const tempAudioPath = await this.saveAudioAsWav(audioData);

      // Show in-progress transcription
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

      // Transcribe with whisper.cpp
      const rawTranscription = await this.transcribeWithWhisperCpp(
        tempAudioPath
      );

      // Clean up temp file
      try {
        unlinkSync(tempAudioPath);
      } catch (err) {
        console.warn("Failed to delete temp audio file:", err);
      }

      // Use uniform post-processing API
      const postProcessed = this.postProcessTranscription(rawTranscription, {
        parseTimestamps: true,
        cleanText: true,
        extractConfidence: false,
      });

      // Create completed segment
      const completedSegment: TranscribedSegment = {
        id: uuidv4(),
        type: "transcribed",
        text: postProcessed.text,
        completed: true,
        timestamp: Date.now(),
        confidence: postProcessed.confidence ?? 0.95, // Whisper.cpp generally has good confidence
        start: postProcessed.start,
        end: postProcessed.end,
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
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    const rawTranscription = await this.transcribeWithWhisperCpp(filePath);
    const postProcessed = this.postProcessTranscription(rawTranscription, {
      parseTimestamps: true,
      cleanText: true,
      extractConfidence: false,
    });
    return postProcessed.text;
  }

  async stopTranscription(): Promise<void> {
    console.log("=== Stopping Whisper.cpp transcription plugin ===");

    this.setRunning(false);
    this.setTranscriptionCallback(null);
    this.currentSegments = [];

    console.log("Whisper.cpp transcription plugin stopped");
  }

  async cleanup(): Promise<void> {
    await this.stopTranscription();

    // Clean up temp directory
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

  getConfigSchema(): TranscriptionPluginConfigSchema {
    return {
      model: {
        type: "select",
        label: "Model",
        description: "Whisper model to use for transcription",
        default: "ggml-base.en.bin",
        options: [
          "ggml-tiny.bin",
          "ggml-tiny-q5_1.bin",
          "ggml-tiny-q8_0.bin",
          "ggml-tiny.en.bin",
          "ggml-tiny.en-q5_1.bin",
          "ggml-tiny.en-q8_0.bin",
          "ggml-base.bin",
          "ggml-base-q5_1.bin",
          "ggml-base-q8_0.bin",
          "ggml-base.en.bin",
          "ggml-base.en-q5_1.bin",
          "ggml-base.en-q8_0.bin",
          "ggml-small.bin",
          "ggml-small-q5_1.bin",
          "ggml-small-q8_0.bin",
          "ggml-small.en.bin",
          "ggml-small.en-q5_1.bin",
          "ggml-small.en-q8_0.bin",
          "ggml-medium.bin",
          "ggml-medium-q5_0.bin",
          "ggml-medium-q8_0.bin",
          "ggml-medium.en.bin",
          "ggml-medium.en-q5_0.bin",
          "ggml-medium.en-q8_0.bin",
          "ggml-large-v2.bin",
          "ggml-large-v2-q5_0.bin",
          "ggml-large-v2-q8_0.bin",
          "ggml-large-v3.bin",
          "ggml-large-v3-q5_0.bin",
          "ggml-large-v3-turbo.bin",
          "ggml-large-v3-turbo-q5_0.bin",
          "ggml-large-v3-turbo-q8_0.bin",
        ],
      },
      language: {
        type: "select",
        label: "Language",
        description: "Language for transcription",
        default: "auto",
        options: [
          "auto",
          "en",
          "es",
          "fr",
          "de",
          "it",
          "pt",
          "zh",
          "ja",
          "ko",
          "ru",
          "ar",
          "hi",
        ],
      },
      useVad: {
        type: "boolean",
        label: "Use VAD",
        description: "Use Voice Activity Detection for better performance",
        default: true,
      },
      threads: {
        type: "number",
        label: "Threads",
        description: "Number of threads to use for processing",
        default: 4,
        min: 1,
        max: 16,
      },
    };
  }

  configure(config: Record<string, any>): void {
    if (config.model !== undefined) {
      this.config.set("whisperCppModel", config.model);
      this.modelPath = this.resolveModelPath();
    }
    if (config.language !== undefined) {
      this.config.set("whisperCppLanguage", config.language);
    }
    if (config.useVad !== undefined) {
      this.config.set("whisperCppUseVad", config.useVad);
    }
    if (config.threads !== undefined) {
      this.config.set("whisperCppThreads", config.threads);
    }
  }

  /**
   * Update the model path after model switch
   */
  updateModelPath(): void {
    this.modelPath = this.resolveModelPath();
    console.log(
      `WhisperCppTranscriptionPlugin: Updated model path to ${this.modelPath}`
    );
  }

  /**
   * Convert Float32Array audio data to WAV file for whisper.cpp
   */
  private async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    const sampleRate = 16000; // Whisper expects 16kHz
    const numChannels = 1;
    const bitsPerSample = 16;

    const tempPath = join(this.tempDir, `audio_${Date.now()}.wav`);

    // Convert Float32Array to 16-bit PCM
    const pcmData = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      // Clamp to [-1, 1] and convert to 16-bit
      const clamped = Math.max(-1, Math.min(1, audioData[i]));
      pcmData[i] = Math.round(clamped * 32767);
    }

    // Create WAV header
    const wavHeader = this.createWavHeader(
      pcmData.length * 2,
      sampleRate,
      numChannels,
      bitsPerSample
    );

    // Combine header and data
    const wavBuffer = new ArrayBuffer(
      wavHeader.byteLength + pcmData.byteLength
    );
    const wavView = new Uint8Array(wavBuffer);
    wavView.set(new Uint8Array(wavHeader), 0);
    wavView.set(new Uint8Array(pcmData.buffer), wavHeader.byteLength);

    // Write to file
    writeFileSync(tempPath, Buffer.from(wavBuffer));

    return tempPath;
  }

  /**
   * Create WAV file header
   */
  private createWavHeader(
    dataLength: number,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLength, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // Format chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true); // ByteRate
    view.setUint16(32, (numChannels * bitsPerSample) / 8, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // Data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true); // Subchunk2Size

    return buffer;
  }

  /**
   * Transcribe audio file using whisper.cpp CLI
   */
  private async transcribeWithWhisperCpp(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "--file",
        audioPath,
        "--model",
        this.modelPath,
        "--output-txt",
      ];

      // Add whisper prompt
      try {
        const whisperPrompt = readPrompt("whisper");
        if (whisperPrompt.trim()) {
          args.push("--prompt", whisperPrompt.trim());
        }
      } catch (error) {
        console.warn("Failed to read whisper prompt:", error);
      }

      // Add configuration options
      const language = this.config.get("whisperCppLanguage");
      if (language && language !== "auto") {
        args.push("--language", language);
      }

      const useVad = this.config.get("whisperCppUseVad");
      if (useVad && this.vadModelPath) {
        args.push("--vad");
        args.push("--vad-model", this.vadModelPath);
      }

      const threads = this.config.get("whisperCppThreads");
      if (threads) {
        args.push("--threads", threads.toString());
      }

      console.log(
        `Running Whisper.cpp: ${this.whisperBinaryPath} ${args.join(" ")}`
      );

      const whisperProcess = spawn(this.whisperBinaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      whisperProcess.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      whisperProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      whisperProcess.on("close", (code) => {
        if (code === 0) {
          // Try to read the output txt file
          const txtOutputPath = audioPath.replace(/\.[^/.]+$/, ".txt");
          try {
            const rawTranscription = readFileSync(txtOutputPath, "utf8").trim();
            unlinkSync(txtOutputPath); // Clean up output file

            console.log(
              `Whisper.cpp raw transcription from file: "${rawTranscription}"`
            );
            resolve(rawTranscription || "[No speech detected]");
          } catch (fileError) {
            // If we can't read the file, try to get output from stdout
            const rawTranscription = stdout.trim();

            console.log(
              `Whisper.cpp raw transcription from stdout: "${rawTranscription}"`
            );
            resolve(rawTranscription || "[No speech detected]");
          }
        } else {
          const error = new Error(
            `Whisper.cpp failed with code ${code}: ${stderr}`
          );
          console.error("Whisper.cpp error:", error.message);
          reject(error);
        }
      });

      whisperProcess.on("error", (error) => {
        console.error("Whisper.cpp spawn error:", error);
        reject(error);
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        if (!whisperProcess.killed) {
          whisperProcess.kill();
          reject(new Error("Whisper.cpp transcription timeout"));
        }
      }, 60000); // 60 second timeout (whisper.cpp can be slower than YAP)
    });
  }
}
