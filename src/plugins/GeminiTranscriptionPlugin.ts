import {
  BaseTranscriptionPlugin,
  PluginSchemaItem,
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

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.setActivationCriteria({
      runOnAll: true,
      skipTransformation: true,
      overridesTransformationSettings: true,
    });
    this.setAiCapabilities({
      isAiPlugin: true,
      supportsCombinedMode: true,
      processingMode: "transcription_and_transformation",
      transformationSettingsKeys: ["model", "temperature", "maxTokens", "baseUrl"],
    });
  }

  /**
   * Define fallback chain for Gemini plugin
   * Prefer offline plugins when API is unavailable: Whisper.cpp first, then Vosk, then YAP
   */
  getFallbackChain(): string[] {
    return ["whisper-cpp", "vosk", "yap"];
  }

  /**
   * Validate an API key by making a simple API call to Gemini
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
      const url = `${this.apiBase}/models?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403
        ) {
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
    console.log("Checking Gemini availability...");
    console.log("Current API key:", this.apiKey);
    console.log("Current options:", this.options);

    // First, check if we have an API key in current options (for onboarding)
    // Handle both cases: direct value or schema structure
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
          "Failed to load Gemini API key from secure storage:",
          error,
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
    onLog?: (line: string) => void,
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
    screenshotBase64?: string,
  ): Promise<string> {
    const selectedTextService = new SelectedTextService();
    const savedState = await selectedTextService.getSelectedText();
    const windowInfo = await selectedTextService.getActiveWindowInfo();

    const isTranscriptionAndTransformation =
      this.options.processing_mode !== "transcription_only";

    let systemPromptSource: string;
    let messagePromptSource: string;

    if (isTranscriptionAndTransformation) {
      systemPromptSource =
        this.config.ai?.prompt ||
        this.readPromptFile("gemini_system_prompt.txt");
      messagePromptSource =
        this.config.ai?.messagePrompt ||
        this.readPromptFile("gemini_message_prompt.txt");
    } else {
      const defaultSystemPrompt = this.readPromptFile(
        "gemini_system_prompt.txt",
      );
      const defaultMessagePrompt = this.readPromptFile(
        "gemini_message_prompt.txt",
      );
      systemPromptSource = this.options.system_prompt || defaultSystemPrompt;
      messagePromptSource = this.options.message_prompt || defaultMessagePrompt;
    }

    const processedSystemPrompt = TransformationService.processPrompt({
      prompt: systemPromptSource,
      savedState,
      windowInfo,
      text: undefined,
      config: this.config,
      includeTranscriptionInstructions: isTranscriptionAndTransformation,
    });

    const processedMessagePrompt = TransformationService.processPrompt({
      prompt: messagePromptSource,
      savedState,
      windowInfo,
      text: undefined,
      config: this.config,
      includeTranscriptionInstructions: isTranscriptionAndTransformation,
    });

    // Make Gemini API request for both transcription and transformation
    const response = await this.makeGeminiRequest(
      processedSystemPrompt,
      processedMessagePrompt,
      audioWavBase64,
      screenshotBase64,
      savedState,
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
    savedState?: SelectedTextResult,
  ): Promise<string> {
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const modelId = this.modelConfig?.model || "gemini-2.5-flash";
    const url = `${this.apiBase}/models/${encodeURIComponent(
      modelId,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Use TransformationService static methods to build request parts
    const parts = TransformationService.buildGeminiRequestParts(
      systemPrompt,
      messagePrompt,
      audioWavBase64,
      screenshotBase64,
      savedState,
    );
    console.log("Gemni: ", { systemPrompt, messagePrompt });
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

  configure(config: Record<string, any>): void {
    this.setOptions(config);
  }

  getSchema(): PluginSchemaItem[] {
    const systemPrompt = this.readPromptFile("gemini_system_prompt.txt");
    const messagePrompt = this.readPromptFile("gemini_message_prompt.txt");

    return [
      {
        key: "api_key",
        type: "api-key",
        label: "API Key",
        description: "Enter your Google Gemini API key",
        default: "",
        required: true,
        category: "basic",
        secureStorageKey: "api_key",
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
              "Handle both transcription and text enhancement in a single AI call (recommended). Prompts are configured in the AI Enhancement section.",
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
        key: "model",
        type: "select",
        label: "Model",
        description: "Gemini model to use",
        default: "gemini-2.5-flash",
        options: [
          {
            value: "gemini-3-pro-preview",
            label: "Gemini 3 Pro Preview",
            description: "Most capable Gemini 3 model",
          },
          {
            value: "gemini-3-flash-preview",
            label: "Gemini 3 Flash Preview",
            description: "Fastest Gemini 3 model",
          },
          {
            value: "gemini-2.5-flash",
            label: "Gemini 2.5 Flash",
            description: "Latest stable Flash model",
          },
          {
            value: "gemini-2.5-flash-lite",
            label: "Gemini 2.5 Flash Lite",
            description: "Efficient and lightweight",
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
        type: "textarea",
        label: "System Prompt",
        description:
          "Custom system prompt with {selection}, {title}, {app} placeholders",
        default: systemPrompt,
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
        default: messagePrompt,
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

  private async loadApiKey(): Promise<string | null> {
    // Load secure configuration
    this.apiKey = await this.getSecureValue("api_key");
    this.modelConfig = await this.getSecureData("model_config");

    // Check if we have an API key in current options (for onboarding)
    if (
      this.options.api_key &&
      typeof this.options.api_key === "string" &&
      this.options.api_key.trim() !== ""
    ) {
      this.apiKey = this.options.api_key;
    }

    return await this.ensureApiKey();
  }

  async onActivated(uiFunctions?: PluginUIFunctions): Promise<void> {
    const apiKey = await this.loadApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    this.setActive(true);
    uiFunctions?.showSuccess("Gemini plugin activated");
  }

  async initialize(): Promise<void> {
    const apiKey = await this.loadApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    this.setInitialized(true);
  }



  async updateOptions(
    options: Record<string, any>,
    uiFunctions?: PluginUIFunctions,
  ): Promise<void> {
    this.setOptions(options);

    if (options.api_key) {
      await this.setSecureValue("api_key", options.api_key);
      this.apiKey = options.api_key;
    }

    if (options.model) {
      await this.setSecureData("model_config", {
        model: options.model,
        temperature: options.temperature || 0.7,
        maxTokens: options.maxTokens || 4096,
        lastUpdated: new Date().toISOString(),
      });
      this.modelConfig = await this.getSecureData("model_config");
    }

    const isTranscriptionOnly =
      options.processing_mode === "transcription_only";
    this.setActivationCriteria({
      runOnAll: true,
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
