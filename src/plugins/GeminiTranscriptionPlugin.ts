import {
  BaseTranscriptionPlugin,
  PluginOption,
  PluginUIFunctions,
  TranscriptionSetupProgress,
} from "./TranscriptionPlugin";
import { SegmentUpdate } from "../types/SegmentTypes";
import { TransformationService } from "../services/TransformationService";
import {
  SelectedTextService,
  SelectedTextResult,
} from "../services/SelectedTextService";
import { WavProcessor } from "../helpers/WavProcessor";
import { AppConfig } from "../config/AppConfig";
import * as os from "os";
import * as fs from "fs";
import { join } from "path";
import { mkdtempSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";

export class GeminiTranscriptionPlugin extends BaseTranscriptionPlugin {
  readonly name = "gemini";
  readonly displayName = "Gemini AI";
  readonly version = "1.0.0";
  readonly description =
    "Google Gemini AI-powered transcription and processing";
  readonly supportsRealtime = true;
  readonly supportsBatchProcessing = true;

  private readonly apiBase = "https://generativelanguage.googleapis.com/v1beta";
  private apiKey: string | null = null;
  private modelConfig: any = null;
  private config: AppConfig;
  private tempDir: string;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.tempDir = mkdtempSync(join(tmpdir(), "gemini-plugin-"));
    // Set activation criteria: runOnAll (gets all audio) + skipTransformation (handles both transcription and transformation)
    this.setActivationCriteria({ runOnAll: true, skipTransformation: true });
  }

  /**
   * Define fallback chain for Gemini plugin
   * Prefer offline plugins when API is unavailable: Whisper.cpp first, then Vosk, then YAP
   */
  getFallbackChain(): string[] {
    return ["whisper-cpp", "vosk", "yap"];
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
    console.log("Checking Gemini availability...");
    console.log("Current API key:", this.apiKey);
    console.log("Current options:", this.options);

    // First, check if we have an API key in current options (for onboarding)
    if (this.options.api_key) {
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
          this.apiKey ? "present" : "not found"
        );
      } catch (error) {
        console.warn(
          "Failed to load Gemini API key from secure storage:",
          error
        );
        console.log("No API key available");
        return false;
      }
    }

    const isAvailable = this.apiKey !== null;
    console.log("Gemini availability result:", isAvailable);
    return isAvailable;
  }

  async startTranscription(
    onUpdate: (update: SegmentUpdate) => void,
    onProgress?: (progress: TranscriptionSetupProgress) => void,
    onLog?: (line: string) => void
  ): Promise<void> {
    // Initialize Gemini API connection
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    this.isRunning = true;
    this.onTranscriptionCallback = onUpdate;

    onProgress?.({
      status: "complete",
      message: "Gemini plugin ready for transcription",
    });
  }

  async processAudioSegment(audioData: Float32Array): Promise<void> {
    // With runOnAll enabled, this method receives the complete combined audio segment
    // Process the complete audio context with Gemini for both transcription and transformation
    console.log("Gemini plugin processing complete audio context");

    if (!audioData || audioData.length === 0) {
      console.log("No audio data to process");
      return;
    }

    // Convert audio to WAV and process with Gemini
    const tempDir = os.tmpdir();
    const wavPath = await WavProcessor.saveAudioAsWav(audioData, tempDir);
    const audioWavBase64 = fs.readFileSync(wavPath, "base64");

    // Clean up temp file
    try {
      fs.unlinkSync(wavPath);
    } catch (e) {
      console.warn("Failed to clean up temp WAV file:", e);
    }

    // Process with full context (transcription + transformation)
    const result = await this.processAudioWithContext(audioWavBase64);

    // Create final segment update with enhanced text
    const update: SegmentUpdate = {
      segments: [
        {
          id: `gemini_${Date.now()}`,
          type: "transcribed",
          text: result,
          completed: true,
          start: Date.now(),
          end: Date.now(),
          confidence: 1.0,
          timestamp: Date.now(),
        },
      ],
    };

    this.onTranscriptionCallback?.(update);
  }

  async processAudioWithContext(
    audioWavBase64: string,
    screenshotBase64?: string
  ): Promise<string> {
    // Get context using existing services
    const selectedTextService = new SelectedTextService();
    const savedState = await selectedTextService.getSelectedText();
    const windowInfo = await selectedTextService.getActiveWindowInfo();

    // Read prompt files
    const systemPrompt = this.readPromptFile("gemini_system_prompt.txt");
    const messagePrompt = this.readPromptFile("gemini_message_prompt.txt");

    // Use TransformationService static methods for prompt processing
    const processedSystemPrompt = TransformationService.processPrompt({
      prompt: this.options.system_prompt || systemPrompt,
      savedState,
      windowInfo,
      text: undefined,
      config: this.config,
    });

    const processedMessagePrompt = TransformationService.processPrompt({
      prompt: this.options.message_prompt || messagePrompt,
      savedState,
      windowInfo,
      text: undefined,
      config: this.config,
    });

    // Make Gemini API request for both transcription and transformation
    const response = await this.makeGeminiRequest(
      processedSystemPrompt,
      processedMessagePrompt,
      audioWavBase64,
      screenshotBase64,
      savedState
    );

    // Use TransformationService static methods for response processing
    // Since skipTransformation is true, this is the final enhanced text
    return TransformationService.extractCode(response) || response;
  }

  // Gemini API request using TransformationService
  private async makeGeminiRequest(
    systemPrompt: string,
    messagePrompt: string,
    audioWavBase64: string,
    screenshotBase64?: string,
    savedState?: SelectedTextResult
  ): Promise<string> {
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const modelId = this.modelConfig?.model || "gemini-2.5-flash";
    const url = `${this.apiBase}/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Use TransformationService static methods to build request parts
    const parts = TransformationService.buildGeminiRequestParts(
      systemPrompt,
      messagePrompt,
      audioWavBase64,
      screenshotBase64,
      savedState
    );

    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: this.modelConfig?.temperature || 1,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Gemini request failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    return this.extractTextFromResponse(data);
  }

  // Response processing using TransformationService
  private extractTextFromResponse(payload: any): string {
    try {
      const candidates = payload?.candidates || [];
      if (!candidates.length) return "";
      const parts = candidates[0]?.content?.parts || [];
      const texts = parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean);
      return texts.join("\n");
    } catch {
      return "";
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    // Read file and convert to base64
    const audioData = fs.readFileSync(filePath);
    const audioWavBase64 = audioData.toString("base64");

    // Process with context
    return await this.processAudioWithContext(audioWavBase64);
  }

  async stopTranscription(): Promise<void> {
    this.isRunning = false;
    this.onTranscriptionCallback = null;
  }

  async cleanup(): Promise<void> {
    await this.stopTranscription();
  }

  getConfigSchema(): any {
    return {
      api_key: {
        type: "string",
        label: "API Key",
        description: "Google Gemini API key",
        default: "",
      },
      model: {
        type: "string",
        label: "Model",
        description: "Gemini model to use",
        default: "gemini-2.5-flash",
      },
      temperature: {
        type: "number",
        label: "Temperature",
        description: "Creativity level (0.0-1.0)",
        default: 1.0,
      },
    };
  }

  configure(config: Record<string, any>): void {
    this.setOptions(config);
  }

  getOptions(): PluginOption[] {
    const systemPrompt = this.readPromptFile("gemini_system_prompt.txt");
    const messagePrompt = this.readPromptFile("gemini_message_prompt.txt");

    return [
      {
        key: "api_key",
        type: "string",
        label: "API Key",
        description: "Google Gemini API key",
        default: "",
        required: true,
        category: "basic",
      },
      {
        key: "model",
        type: "select",
        label: "Model",
        description: "Gemini model to use",
        default: "gemini-2.5-flash",
        options: [
          {
            value: "gemini-2.5-flash",
            label: "Gemini 2.5 Flash",
            description: "Fast and efficient",
          },
          {
            value: "gemini-2.0-flash-exp",
            label: "Gemini 2.0 Flash Exp",
            description: "Experimental features",
          },
        ],
        category: "basic",
      },
      {
        key: "temperature",
        type: "number",
        label: "Temperature",
        description: "Creativity level (0.0-1.0)",
        default: 1.0,
        min: 0.0,
        max: 1.0,
        category: "advanced",
      },
      {
        key: "enable_screenshots",
        type: "boolean",
        label: "Enable Screenshots",
        description: "Include screenshots in processing",
        default: true,
        category: "advanced",
      },
      {
        key: "system_prompt",
        type: "string",
        label: "System Prompt",
        description:
          "Custom system prompt with {selection}, {title}, {app} placeholders",
        default: systemPrompt,
        category: "advanced",
      },
      {
        key: "message_prompt",
        type: "string",
        label: "Message Prompt",
        description:
          "Custom message prompt for audio processing (handles both transcription and transformation)",
        default: messagePrompt,
        category: "advanced",
      },
      {
        key: "processing_mode",
        type: "select",
        label: "Processing Mode",
        description: "How Gemini should process the audio",
        default: "transcription_and_transformation",
        options: [
          {
            value: "transcription_and_transformation",
            label: "Transcription + Transformation",
            description:
              "Handle both transcription and text enhancement (recommended)",
          },
          {
            value: "transcription_only",
            label: "Transcription Only",
            description: "Only transcribe, use existing transformation service",
          },
        ],
        category: "advanced",
      },
    ];
  }

  async verifyOptions(
    options: Record<string, any>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!options.api_key) {
      if (!(await this.ensureApiKey())) {
        errors.push("API key is required");
      }
    }

    if (
      options.temperature !== undefined &&
      (options.temperature < 0 || options.temperature > 1)
    ) {
      errors.push("Temperature must be between 0.0 and 1.0");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    // Load secure configuration
    this.apiKey = await this.getSecureValue("api_key");
    this.modelConfig = await this.getSecureData("model_config");

    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    this.setActive(true);
    uiFunctions?.showSuccess("Gemini plugin activated");
  }

  async initialize(): Promise<void> {
    // Load secure configuration
    this.apiKey = await this.getSecureValue("api_key");
    this.modelConfig = await this.getSecureData("model_config");

    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    this.setInitialized(true);
  }

  async destroy(): Promise<void> {
    await this.stopTranscription();
    this.setInitialized(false);
    this.setActive(false);
  }

  async onDeactivate(): Promise<void> {
    this.setActive(false);
  }

  getDataPath(): string {
    return "secure_storage"; // Gemini uses secure storage, not file-based
  }

  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions
  ): Promise<void> {
    console.log("=== Gemini updateOptions called ===");
    console.log("Options received:", options);
    console.log("Current options before update:", this.options);

    this.setOptions(options);
    console.log("Options set, current options after update:", this.options);

    // Store API key securely
    if (options.api_key) {
      console.log("Storing Gemini API key securely...");
      try {
        await this.setSecureValue("api_key", options.api_key);
        this.apiKey = options.api_key;
        console.log("✅ Gemini API key stored and set successfully");

        // Verify the key was stored
        const storedKey = await this.getSecureValue("api_key");
        console.log(
          "Verification - stored key matches:",
          storedKey === options.api_key
        );
      } catch (error) {
        console.error("❌ Failed to store Gemini API key:", error);
        throw error;
      }
    } else {
      console.log("No API key in options to store");
    }

    // Store model configuration securely
    if (options.model) {
      console.log("Storing Gemini model configuration...");
      try {
        await this.setSecureData("model_config", {
          model: options.model,
          temperature: options.temperature || 0.7,
          maxTokens: options.maxTokens || 4096,
          lastUpdated: new Date().toISOString(),
        });
        this.modelConfig = await this.getSecureData("model_config");
        console.log("✅ Gemini model configuration stored");
      } catch (error) {
        console.error("❌ Failed to store model configuration:", error);
        throw error;
      }
    }

    // Update activation criteria based on processing mode
    if (options.processing_mode === "transcription_only") {
      this.setActivationCriteria({
        runOnAll: true,
        skipTransformation: false,
      });
    } else {
      this.setActivationCriteria({ runOnAll: true, skipTransformation: true });
    }

    uiFunctions?.showSuccess("Gemini configuration updated");
    console.log("=== Gemini options update completed ===");
  }

  /**
   * Gemini doesn't require model downloads, so this is a no-op that always succeeds
   */
  public async ensureModelAvailable(
    options: Record<string, any>,
    onProgress?: (progress: any) => void,
    onLog?: (line: string) => void
  ): Promise<boolean> {
    onLog?.("Gemini plugin doesn't require model downloads");
    onProgress?.({
      status: "complete",
      message: "Gemini ready",
      percent: 100,
    });
    return true;
  }

  async downloadModel(
    modelName: string,
    uiFunctions?: PluginUIFunctions
  ): Promise<void> {
    // Gemini models are cloud-based, no download needed
    uiFunctions?.showSuccess(`Gemini model ${modelName} is ready to use`);
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
      // List temp files (Gemini doesn't store models locally)
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

      // List secure storage keys
      const secureKeys = await this.listSecureKeys();
      for (const key of secureKeys) {
        dataItems.push({
          name: key,
          description: `Secure storage item`,
          size: 0,
          id: `secure:${key}`,
        });
      }
    } catch (error) {
      console.warn("Failed to list Gemini plugin data:", error);
    }

    return dataItems;
  }

  async deleteDataItem(id: string): Promise<void> {
    const [type, identifier] = id.split(":", 2);

    try {
      switch (type) {
        case "temp":
          const tempPath = join(this.tempDir, identifier);
          if (existsSync(tempPath)) {
            require("fs").unlinkSync(tempPath);
            console.log(`Deleted temp file: ${identifier}`);
          }
          break;

        case "secure":
          await this.deleteSecureValue(identifier);
          console.log(`Deleted secure data: ${identifier}`);
          break;

        default:
          throw new Error(`Unknown data type: ${type}`);
      }
    } catch (error) {
      console.error(`Failed to delete data item ${id}:`, error);
      throw error;
    }
  }

  async deleteAllData(): Promise<void> {
    try {
      // Clear temp files
      if (existsSync(this.tempDir)) {
        const tempFiles = readdirSync(this.tempDir);
        for (const file of tempFiles) {
          try {
            require("fs").unlinkSync(join(this.tempDir, file));
          } catch (error) {
            console.warn(`Failed to delete temp file ${file}:`, error);
          }
        }
      }

      // Clear secure storage
      await this.clearSecureData();

      console.log("Gemini plugin: all data cleared");
    } catch (error) {
      console.error("Failed to clear all Gemini plugin data:", error);
      throw error;
    }
  }

  /**
   * Read a prompt file synchronously from the prompts directory
   */
  private readPromptFile(filename: string): string {
    try {
      const { join } = require("path");
      const { readFileSync } = require("fs");
      const promptsDir = join(__dirname, "../prompts");
      const filePath = join(promptsDir, filename);
      return readFileSync(filePath, "utf8");
    } catch (error) {
      console.warn(`Failed to read prompt file ${filename}:`, error);
      return "";
    }
  }
}
