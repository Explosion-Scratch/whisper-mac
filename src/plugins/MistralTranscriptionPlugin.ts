import {
  BaseTranscriptionPlugin,
  PluginSchemaItem,
  PluginUIFunctions,
  TranscriptionSetupProgress,
} from "./TranscriptionPlugin";
import { SegmentUpdate } from "../types/SegmentTypes";
import { WavProcessor } from "../helpers/WavProcessor";
import { AppConfig } from "../config/AppConfig";
import { TransformationService } from "../services/TransformationService";
import {
  SelectedTextService,
  SelectedTextResult,
} from "../services/SelectedTextService";
import * as os from "os";
import * as fs from "fs";
import { join } from "path";
import { mkdtempSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { v4 as uuidv4 } from "uuid";

const PROCESS_ALL_AUDIO = true;

export class MistralTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "mistral";
  readonly displayName = "Mistral AI";
  readonly version = "1.0.0";
  readonly description =
    "Mistral AI-powered transcription using Voxtral models";
  readonly supportsRealtime = true;
  readonly supportsBatchProcessing = true;

  private readonly apiBase = "https://api.mistral.ai/v1";
  private apiKey: string | null = null;
  private config: AppConfig;
  private tempDir: string;
  private sessionUid: string = "";

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "mistral-plugin-"));
    // Default activation criteria - always process all audio
    this.setActivationCriteria({
      runOnAll: PROCESS_ALL_AUDIO,
      skipTransformation: false,
      overridesTransformationSettings: false,
    });
    // Set AI plugin capabilities
    this.setAiCapabilities({
      isAiPlugin: true,
      supportsCombinedMode: true,
      processingMode: "transcription_only",
    });

    // Initialize schema
    this.schema = this.getSchema();
  }

  /**
   * Define fallback chain for Mistral plugin
   * Prefer offline plugins when API is unavailable: Whisper.cpp first, then Vosk, then YAP
   */
  getFallbackChain(): string[] {
    return ["whisper-cpp", "vosk", "yap"];
  }

  /**
   * Validate an API key by making a simple API call to Mistral
   * Returns success status and any error message
   */
  async validateApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || apiKey.trim() === "") {
      return { valid: false, error: "API key is required" };
    }

    try {
      // Use a simple models list call to validate the API key
      const url = `${this.apiBase}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: "Invalid API key" };
        }
        return {
          valid: false,
          error: `API error: ${response.status} ${errText}`,
        };
      }

      // If we get a valid response, the key is valid
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || "Failed to validate API key",
      };
    }
  }

  /**
   * Ensures API key is available by checking secure storage first, then this.apiKey
   */
  private async ensureApiKey(): Promise<string | null> {
    // First try to get from secure storage
    try {
      const secureKey = await this.getSecureValue("api_key");
      if (secureKey) {
        return secureKey;
      }
    } catch (error) {
      console.warn("Failed to get API key from secure storage:", error);
    }

    // Fall back to this.apiKey
    return this.apiKey;
  }

  async isAvailable(): Promise<boolean> {
    console.log("Checking Mistral availability...");
    console.log("Current API key:", this.apiKey);
    console.log("Current options:", this.options);

    // Check if we have an API key in current options (for onboarding)
    if (
      this.options.api_key &&
      typeof this.options.api_key === "string" &&
      this.options.api_key.trim() !== ""
    ) {
      console.log("Found API key in current options, using it");
      this.apiKey = this.options.api_key;
      return true;
    }

    // Try to load the API key from secure storage if not already loaded
    if (this.apiKey === null) {
      try {
        console.log("Loading API key from secure storage...");
        this.apiKey = await this.getSecureValue("api_key");
        console.log(
          "API key loaded from secure storage:",
          this.apiKey ? "present" : "not found",
        );
      } catch (error) {
        console.warn(
          "Failed to load Mistral API key from secure storage:",
          error,
        );
        console.log("No API key available");
        return false;
      }
    }

    const isAvailable = this.apiKey !== null;
    console.log("Mistral availability result:", isAvailable);
    return isAvailable;
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void,
  ): Promise<void> {
    // Initialize Mistral API connection
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Mistral API key not configured");
    }

    this.isRunning = true;
    this.onTranscriptionCallback = onUpdate;
    this.sessionUid = uuidv4();

    onProgress?.({
      status: "complete",
      message: "Mistral plugin ready for transcription",
    });
  }

  async processAudioSegment(audioData: Float32Array): Promise<void> {
    if (!this.isRunning || !this.onTranscriptionCallback) {
      return;
    }

    try {
      console.log(`Processing audio segment: ${audioData.length} samples`);

      // Create temporary WAV file for Mistral
      const tempAudioPath = await this.saveAudioAsWav(audioData);

      // Show in-progress transcription
      const inProgressSegment = {
        id: uuidv4(),
        type: "inprogress" as const,
        text: "Transcribing...",
        timestamp: Date.now(),
      };

      this.onTranscriptionCallback({
        segments: [inProgressSegment],
        sessionUid: this.sessionUid,
      });

      // Transcribe with Mistral
      const rawTranscription = await this.transcribeWithMistral(tempAudioPath);

      // Clean up temp file
      try {
        fs.unlinkSync(tempAudioPath);
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
      const completedSegment = {
        id: uuidv4(),
        type: "transcribed" as const,
        text: postProcessed.text,
        completed: true,
        timestamp: Date.now(),
        confidence: postProcessed.confidence ?? 0.95,
        start: postProcessed.start,
        end: postProcessed.end,
      };

      this.onTranscriptionCallback({
        segments: [completedSegment],
        sessionUid: this.sessionUid,
      });
    } catch (error: any) {
      console.error("Failed to process audio segment:", error);
      this.emit("error", error);
    }
  }

  async transcribeWithMistral(audioPath: string): Promise<string> {
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Mistral API key not configured");
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const audioBase64 = audioBuffer.toString("base64");

    const model = this.options.model || "voxtral-mini-latest";

    const isTranscriptionAndTransformation =
      this.options.processing_mode !== "transcription_only";

    let systemPromptText: string;
    let messagePromptText: string;

    if (isTranscriptionAndTransformation) {
      systemPromptText =
        this.config.ai?.prompt ||
        "You are a transcription assistant. Accurately transcribe the audio provided.";
      messagePromptText =
        this.config.ai?.messagePrompt ||
        "Please transcribe and transform this audio accurately.";
    } else {
      systemPromptText =
        this.options.system_prompt ||
        "You are a transcription assistant. Accurately transcribe the audio provided.";
      messagePromptText =
        this.options.message_prompt ||
        "Please transcribe this audio accurately.";
    }

    const selectedTextService = new SelectedTextService();
    const savedState = await selectedTextService.getSelectedText();
    const windowInfo = await selectedTextService.getActiveWindowInfo();

    const processedSystemPrompt = TransformationService.processPrompt({
      prompt: systemPromptText,
      savedState,
      windowInfo,
      text: undefined,
      config: this.config,
      includeTranscriptionInstructions: isTranscriptionAndTransformation,
    });

    const processedMessagePrompt = TransformationService.processPrompt({
      prompt: messagePromptText,
      savedState,
      windowInfo,
      text: undefined,
      config: this.config,
      includeTranscriptionInstructions: isTranscriptionAndTransformation,
    });

    // Prepare request payload with system prompt
    const payload = {
      model: model,
      messages: [
        {
          role: "system",
          content: processedSystemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: audioBase64,
            },
            {
              type: "text",
              text: processedMessagePrompt,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || "";
    } catch (error) {
      console.error("Mistral transcription error:", error);
      throw error;
    }
  }

  async saveAudioAsWav(audioData: Float32Array): Promise<string> {
    return await WavProcessor.saveAudioAsWav(audioData, this.tempDir);
  }

  async stopTranscription(): Promise<void> {
    this.isRunning = false;
    this.onTranscriptionCallback = null;
  }

  async cleanup(): Promise<void> {
    await this.stopTranscription();

    // Clean up temp directory
    try {
      if (existsSync(this.tempDir)) {
        const files = readdirSync(this.tempDir);
        for (const file of files) {
          const filePath = join(this.tempDir, file);
          try {
            fs.unlinkSync(filePath);
          } catch (error) {
            console.warn(`Failed to delete temp file ${file}:`, error);
          }
        }
        fs.rmdirSync(this.tempDir);
      }
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Mistral API key not configured");
    }

    // Read file and encode as base64
    const audioBuffer = fs.readFileSync(filePath);
    const audioBase64 = audioBuffer.toString("base64");

    // Get model from options or use default
    const model = this.options.model || "voxtral-mini-latest";

    // Prepare request payload
    const payload = {
      model: model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: audioBase64,
            },
            {
              type: "text",
              text: "Please transcribe this audio accurately.",
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || "";
    } catch (error) {
      console.error("Mistral file transcription error:", error);
      throw error;
    }
  }

  getSchema(): PluginSchemaItem[] {
    return [
      {
        key: "api_key",
        type: "api-key",
        label: "API Key",
        description: "Enter your Mistral AI API key",
        default: "",
        category: "basic",
        required: true,
        secureStorageKey: "api_key",
      },
      {
        key: "model",
        type: "select",
        label: "Model",
        description: "Mistral model to use for transcription",
        default: "voxtral-mini-latest",
        options: [
          {
            value: "voxtral-mini-latest",
            label: "Voxtral Mini",
            description: "Fast and efficient transcription model",
          },
          {
            value: "voxtral-small-latest",
            label: "Voxtral Small",
            description: "Higher quality transcription model",
          },
        ],
        category: "basic",
      },
      {
        key: "processing_mode",
        type: "select",
        label: "Processing Mode",
        description: "How Mistral should process the audio",
        default: "transcription_only",
        options: [
          {
            value: "transcription_and_transformation",
            label: "Transcription + Transformation",
            description:
              "Handle both transcription and text enhancement in a single AI call. Prompts are configured in the AI Enhancement section.",
          },
          {
            value: "transcription_only",
            label: "Transcription Only",
            description:
              "Only transcribe audio, use separate AI Enhancement for text transformation",
          },
        ],
        category: "basic",
      },
      {
        key: "system_prompt",
        type: "textarea",
        label: "System Prompt",
        description:
          "Custom system prompt with {selection}, {title}, {app} placeholders",
        default:
          "You are a transcription assistant. Accurately transcribe the audio provided.",
        category: "advanced",
        dependsOn: {
          key: "processing_mode",
          value: "transcription_and_transformation",
          negate: true,
        },
        conditionalDescription: {
          condition: {
            key: "processing_mode",
            value: "transcription_and_transformation",
          },
          description:
            "When using Transcription + Transformation mode, prompts are configured in the AI Enhancement section.",
        },
      },
      {
        key: "message_prompt",
        type: "textarea",
        label: "Message Prompt",
        description:
          "Custom message prompt for audio processing with {selection}, {title}, {app}, {text} placeholders",
        default: "Please transcribe the following audio accurately.",
        category: "advanced",
        dependsOn: {
          key: "processing_mode",
          value: "transcription_and_transformation",
          negate: true,
        },
        conditionalDescription: {
          condition: {
            key: "processing_mode",
            value: "transcription_and_transformation",
          },
          description:
            "When using Transcription + Transformation mode, prompts are configured in the AI Enhancement section.",
        },
      },
    ];
  }

  async validateOptions(
    options: Record<string, any>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!options.api_key) {
      if (!(await this.ensureApiKey())) {
        errors.push("API key is required");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    // Load secure configuration
    this.apiKey = await this.getSecureValue("api_key");

    // Check if we have an API key in current options (for onboarding)
    if (
      this.options.api_key &&
      typeof this.options.api_key === "string" &&
      this.options.api_key.trim() !== ""
    ) {
      this.apiKey = this.options.api_key;
    }

    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Mistral API key not configured");
    }

    // Update activation criteria based on processing mode
    const isTranscriptionOnly =
      this.options.processing_mode !== "transcription_and_transformation";
    this.setActivationCriteria({
      runOnAll: PROCESS_ALL_AUDIO,
      skipTransformation: !isTranscriptionOnly,
      overridesTransformationSettings: !isTranscriptionOnly,
    });
    this.setAiCapabilities({
      isAiPlugin: true,
      supportsCombinedMode: true,
      processingMode: isTranscriptionOnly
        ? "transcription_only"
        : "transcription_and_transformation",
    });

    this.setActive(true);
    uiFunctions?.showSuccess("Mistral plugin activated");
  }

  async initialize(): Promise<void> {
    // Load secure configuration
    this.apiKey = await this.getSecureValue("api_key");

    // Check if we have an API key in current options (for onboarding)
    if (
      this.options.api_key &&
      typeof this.options.api_key === "string" &&
      this.options.api_key.trim() !== ""
    ) {
      this.apiKey = this.options.api_key;
    }

    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Mistral API key not configured");
    }

    this.setInitialized(true);
  }

  async destroy(): Promise<void> {
    await this.stopTranscription();
    this.setInitialized(false);
    this.setActive(false);

    // Clean up temporary directory
    try {
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const tempFile of tempFiles) {
          const tempPath = join(this.tempDir, tempFile);
          try {
            fs.unlinkSync(tempPath);
          } catch (error) {
            console.warn(`Failed to delete temp file ${tempFile}:`, error);
          }
        }
        // Remove the temp directory itself
        fs.rmdirSync(this.tempDir);
        console.log("Cleaned up Mistral temp directory");
      }
    } catch (error) {
      console.warn("Failed to clean up Mistral temp directory:", error);
    }
  }

  async onDeactivate(): Promise<void> {
    this.setActive(false);
  }

  getDataPath(): string {
    return "secure_storage"; // Mistral uses secure storage, not file-based
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    console.log("=== Mistral updateOptions called ===");
    console.log("Options received:", options);
    console.log("Current options before update:", this.options);

    this.setOptions(options);
    console.log("Options set, current options after update:", this.options);

    // Store API key securely
    if (options.api_key) {
      console.log("Storing Mistral API key securely...");
      try {
        await this.setSecureValue("api_key", options.api_key);
        this.apiKey = options.api_key;
        console.log("✅ Mistral API key stored and set successfully");

        // Verify the key was stored
        const storedKey = await this.getSecureValue("api_key");
        console.log(
          "Verification - stored key matches:",
          storedKey === options.api_key,
        );
      } catch (error) {
        console.error("❌ Failed to store Mistral API key:", error);
        throw error;
      }
    } else {
      console.log("No API key in options to store");
    }

    // Update activation criteria and AI capabilities based on processing mode
    const isTranscriptionOnly =
      options.processing_mode !== "transcription_and_transformation";
    if (isTranscriptionOnly) {
      this.setActivationCriteria({
        runOnAll: PROCESS_ALL_AUDIO,
        skipTransformation: false,
        overridesTransformationSettings: false,
      });
      this.setAiCapabilities({
        isAiPlugin: true,
        supportsCombinedMode: true,
        processingMode: "transcription_only",
      });
    } else {
      this.setActivationCriteria({
        runOnAll: PROCESS_ALL_AUDIO,
        skipTransformation: true,
        overridesTransformationSettings: true,
      });
      this.setAiCapabilities({
        isAiPlugin: true,
        supportsCombinedMode: true,
        processingMode: "transcription_and_transformation",
        transformationSettingsKeys: [
          "model",
          "temperature",
          "maxTokens",
          "baseUrl",
        ],
      });
    }

    uiFunctions?.showSuccess("Mistral configuration updated");
    console.log("=== Mistral options update completed ===");
  }

  /**
   * Mistral doesn't require model downloads, so this is a no-op that always succeeds
   */
  public async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    onLog?.("Mistral plugin doesn't require model downloads");
    onProgress?.({
      status: "complete",
      message: "Mistral ready",
      percent: 100,
    });
    return true;
  }

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    // Mistral models are cloud-based, no download needed
    uiFunctions?.showSuccess(`Mistral model ${modelName} is ready to use`);
  }

  async listData(): Promise<
    Array<{ name: string; description: string; size: number; id: string }>
  > {
    const dataItems: Array<{
      name: string;
      description: string;
      size: number;
      id: string;
    }> = [];

    try {
      // List temp files (Mistral doesn't store models locally)
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const tempFile of tempFiles) {
          const tempPath = join(this.tempDir, tempFile);
          try {
            const stats = require("fs").statSync(tempPath);
            dataItems.push({
              name: tempFile,
              description: `Temporary audio file`,
              size: stats.size,
              id: `temp:${tempFile}`,
            });
          } catch (error) {
            console.warn(`Failed to stat temp file ${tempFile}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn("Failed to list Mistral data:", error);
    }

    return dataItems;
  }

  async deleteDataItem(dataId: string): Promise<void> {
    if (dataId.startsWith("temp:")) {
      const fileName = dataId.substring(5);
      const filePath = join(this.tempDir, fileName);
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted temp file: ${fileName}`);
      } catch (error) {
        console.warn(`Failed to delete temp file ${fileName}:`, error);
      }
    }
  }

  async deleteAllData(): Promise<void> {
    try {
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const tempFile of tempFiles) {
          const tempPath = join(this.tempDir, tempFile);
          try {
            fs.unlinkSync(tempPath);
          } catch (error) {
            console.warn(`Failed to delete temp file ${tempFile}:`, error);
          }
        }
        console.log("Cleared all Mistral temp files");
      }
    } catch (error) {
      console.warn("Failed to clear Mistral data:", error);
    }
  }
}
