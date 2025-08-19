# Comprehensive Plan for Gemini Plugin Implementation with Secure Storage

This plan combines the implementation of a Gemini plugin with a comprehensive secure storage system for plugins, unified with the existing TransformationService architecture.

## **Gemini API Implementation Details**

### **API Endpoint and Authentication**

- **Base URL**: `https://generativelanguage.googleapis.com/v1beta`
- **Model**: `gemini-2.5-flash` (default)
- **Authentication**: API key via query parameter
- **Endpoint**: `/models/{modelId}:generateContent?key={apiKey}`

### **Request Structure**

The Gemini API expects a multipart request with the following structure:

```typescript
interface GeminiRequest {
  contents: [
    {
      role: "user";
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string; // base64 encoded
        };
      }>;
    }
  ];
  generationConfig: {
    temperature: number;
    thinkingConfig: {
      thinkingBudget: number;
    };
  };
}
```

### **Request Parts Assembly**

The implementation builds the request parts dynamically:

1. **System Prompt + Message Prompt** (text part)
2. **Screenshot** (optional, image/png, base64)
3. **Audio Data** (audio/x-wav, base64)
4. **Selection Reminder** (optional text part)

```typescript
const parts = [
  { text: p(systemPrompt) + "\n\n" + p(messagePrompt) },
  ...(screenshotBase64
    ? [
        {
          inlineData: {
            mimeType: "image/png",
            data: screenshotBase64,
          },
        },
      ]
    : []),
  {
    inlineData: {
      mimeType: "audio/x-wav",
      data: audioWavBase64,
    },
  },
];

// Add selection reminder if needed
if (savedState.hasSelection) {
  parts.push({ text: "Remember, output the new selection." });
}
```

### **Response Structure**

The Gemini API returns a structured response:

```typescript
interface GeminiResponse {
  candidates: [
    {
      content: {
        parts: Array<{
          text: string;
        }>;
      };
    }
  ];
  // ... other metadata
}
```

### **Key Implementation Features**

1. **Dual Role Architecture**: Acts as both transcription AND transformation service
   - `runOnAll: true` - Receives all audio chunks and processes them together
   - `skipTransformation: true` - Handles both transcription and text enhancement, bypassing TransformationService
   - Provides complete audio context to Gemini for better understanding and enhancement
2. **Multimodal Support**: Handles text, audio, and images in a single request
3. **Context Integration**: Includes selected text, window title, and app name
4. **Conditional Content**: Dynamically includes/excludes content based on context
5. **Code Extraction**: Automatically extracts code blocks from responses
6. **Error Handling**: Comprehensive error handling with detailed error messages
7. **Debug Logging**: Extensive logging for troubleshooting

## **Part 1: TransformationService Unification Plan**

### **Phase 1: Enhance TransformationService (Estimated: 2-3 hours)**

#### **Step 1.1: Add processPrompt Method**

- **Objective**: Add a unified prompt processing method to TransformationService
- **Deliverable**: Enhanced TransformationService with processPrompt method
- **Key Implementation**:

  ````typescript
  export class TransformationService {
    // ... existing code ...

    /**
     * Process a prompt by replacing placeholders and handling sel tags
     * @param prompt The base prompt template
     * @param savedState Selected text state
     * @param windowInfo Active window information
     * @returns Processed prompt with all placeholders replaced
     */
    static processPrompt(
      prompt: string,
      savedState: SelectedTextResult,
      windowInfo: { title: string; appName: string }
    ): string {
      let processed = prompt
        .replace(/{selection}/g, savedState.text || "")
        .replace(/{title}/g, windowInfo.title || "")
        .replace(/{app}/g, windowInfo.appName || "")
        .replace(/{text}/g, savedState.text || "");

      if (savedState.hasSelection) {
        processed = processed.replace(/<sel>/g, "");
        processed = processed.replace(/<\/sel>/g, "");
      } else {
        processed = processed.replace(/<sel>[\s\S]*?<\/sel>/g, "");
      }

      return processed;
    }

    /**
     * Extract code block content if it's significantly longer than non-code content
     * @param text The text to extract code from
     * @returns Extracted code or null if no code block found
     */
    static extractCode(text: string): string | null {
      const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)\n```/g;
      const matches = Array.from(text.matchAll(codeBlockRegex));

      if (matches.length === 0) {
        return null;
      }

      let longestCodeContent = "";

      for (const match of matches) {
        const codeContent = match[2] || "";
        if (codeContent.length > longestCodeContent.length) {
          longestCodeContent = codeContent;
        }
      }

      const textWithoutCodeBlocks = text.replace(codeBlockRegex, "");
      const nonCodeContent = textWithoutCodeBlocks.trim();

      if (
        longestCodeContent.length > nonCodeContent.length * 2 &&
        longestCodeContent.length > 0
      ) {
        return longestCodeContent.trim();
      }

      return null;
    }

    /**
     * Remove content between <think> tags and trim the result
     * @param text The text to process
     * @returns Text with think tags removed
     */
    static removeThink(text: string): string {
      return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    }

    /**
     * Remove "changed/new/replaced text:" prefixes
     * @param text The text to process
     * @returns Text with prefixes removed
     */
    static async removeChanged(text: string): Promise<string> {
      const transformed = text
        .trim()
        .replace(/^(?:changed|new|replaced)\s*(?:text)\:?\s*/gi, "")
        .trim();
      return transformed;
    }
  }
  ````

- **Validation**: All existing functionality continues to work
- **Timeline**: 1 hour
- **Dependencies**: None
- **Risks**: Low - adding methods to existing service

#### **Step 1.2: Make extractCode Public**

- **Objective**: Make the extractCode method public for use by other services
- **Deliverable**: Public extractCode method
- **Key Changes**:
  - Change `private extractCode` to `public extractCode`
  - Update method documentation
  - Ensure it's properly exported
- **Validation**: Method can be called from other services
- **Timeline**: 15 minutes
- **Dependencies**: Step 1.1
- **Risks**: Low - simple visibility change

#### **Step 1.3: Add Static Utility Methods**

- **Objective**: Add static utility methods to TransformationService
- **Deliverable**: Static methods for request building
- **Key Implementation**:

  ```typescript
  export class TransformationService {
    // ... existing code ...

    /**
     * Build Gemini API request parts from various inputs
     * @param systemPrompt Processed system prompt
     * @param messagePrompt Processed message prompt
     * @param audioWavBase64 Base64 audio data
     * @param screenshotBase64 Optional base64 screenshot data
     * @param savedState Selected text state
     * @returns Array of request parts
     */
    static buildGeminiRequestParts(
      systemPrompt: string,
      messagePrompt: string,
      audioWavBase64: string,
      screenshotBase64?: string,
      savedState?: SelectedTextResult
    ): Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string;
      };
    }> {
      const parts = [
        { text: systemPrompt + "\n\n" + messagePrompt },
        ...(screenshotBase64
          ? [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: screenshotBase64,
                },
              },
            ]
          : []),
        {
          inlineData: {
            mimeType: "audio/x-wav",
            data: audioWavBase64,
          },
        },
      ];

      // Add selection reminder if needed
      if (savedState?.hasSelection) {
        parts.push({ text: "Remember, output the new selection." });
      }

      return parts;
    }
  }
  ```

- **Audio Conversion**: Use existing `WavProcessor` for audio conversion
- **Validation**: Static methods work correctly
- **Timeline**: 1 hour
- **Dependencies**: Step 1.2
- **Risks**: Low - static method implementation

- **Validation**: Static methods work correctly
- **Timeline**: 1 hour
- **Dependencies**: Step 1.2
- **Risks**: Low - static method implementation

## **Part 2: Gemini Plugin Implementation Plan**

Based on the enhanced TransformationService, here's a comprehensive plan for creating a Gemini plugin that integrates with the existing transcription plugin architecture.

### **Phase 2: Analysis and Design (Estimated: 1-2 hours)**

#### **Step 2.1: Understand Current Architecture**

- **Objective**: Map out the existing plugin system and identify integration points
- **Deliverable**: Architecture diagram showing how Gemini plugin will fit
- **Validation**: Verify understanding by examining key interfaces and flows
- **Timeline**: 30 minutes
- **Dependencies**: None
- **Risks**: Low - documentation is comprehensive

#### **Step 2.2: Design Plugin Interface**

- **Objective**: Define the Gemini plugin interface that extends BaseTranscriptionPlugin
- **Deliverable**: Interface specification and configuration schema
- **Key Components**:

  ```typescript
  export class GeminiTranscriptionPlugin extends BaseTranscriptionPlugin {
    readonly name = "gemini";
    readonly displayName = "Gemini AI";
    readonly version = "1.0.0";
    readonly description =
      "Google Gemini AI-powered transcription and processing";
    readonly supportsRealtime = true;
    readonly supportsBatchProcessing = true;

    constructor(config: AppConfig) {
      super();
      this.config = config;
      // Set activation criteria: runOnAll (gets all audio) + skipTransformation (handles both transcription and transformation)
      this.setActivationCriteria({ runOnAll: true, skipTransformation: true });
    }
  }
  ```

- **Key Design Decision**: The Gemini plugin acts as both transcription AND transformation service
  - `runOnAll: true` - Plugin receives all audio chunks and processes them together
  - `skipTransformation: true` - Plugin handles both transcription and text enhancement, bypassing TransformationService
  - This allows Gemini to process the complete audio context and provide enhanced output directly
- **Validation**: Interface is compatible with existing plugin manager
- **Timeline**: 45 minutes
- **Dependencies**: Step 2.1
- **Risks**: Low - clear base class to extend

### **Phase 3: Core Plugin Implementation (Estimated: 3-4 hours)**

#### **Step 3.1: Create GeminiTranscriptionPlugin Class**

- **Objective**: Implement the core Gemini plugin class using TransformationService
- **Deliverable**: `src/plugins/GeminiTranscriptionPlugin.ts`
- **Key Implementation**:

  ```typescript
  export class GeminiTranscriptionPlugin extends BaseTranscriptionPlugin {
    private readonly apiBase =
      "https://generativelanguage.googleapis.com/v1beta";
    private apiKey: string | null = null;
    private modelConfig: any = null;

    // Core transcription methods
    async isAvailable(): Promise<boolean> {
      return this.apiKey !== null;
    }

    async startTranscription(
      onUpdate: (update: SegmentUpdate) => void,
      onProgress?: (progress: TranscriptionSetupProgress) => void,
      onLog?: (line: string) => void
    ): Promise<void> {
      // Initialize Gemini API connection
      if (!this.apiKey) {
        throw new Error("Gemini API key not configured");
      }

      this.isRunning = true;
      this.onTranscriptionCallback = onUpdate;
    }

    async processAudioSegment(audioData: Float32Array): Promise<void> {
      // With runOnAll enabled, audio segments are buffered by the plugin manager
      // This method will be called for each audio chunk, but we don't process immediately
      // Instead, we wait for finalizeBufferedAudio() to be called with all accumulated audio
      console.log(
        `Gemini plugin buffering audio segment: ${audioData.length} samples`
      );
    }

    async finalizeBufferedAudio(): Promise<void> {
      // This method is called by the plugin manager when all audio has been collected
      // Process the complete audio context with Gemini for both transcription and transformation
      console.log("Gemini plugin processing complete audio context");

      // Get all buffered audio from the plugin manager
      const bufferedAudio = this.getBufferedAudioChunks();
      if (!bufferedAudio || bufferedAudio.length === 0) {
        console.log("No buffered audio to process");
        return;
      }

      // Combine all audio chunks
      const totalSamples = bufferedAudio.reduce(
        (acc, chunk) => acc + chunk.length,
        0
      );
      const combinedAudio = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of bufferedAudio) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert combined audio to WAV and process with Gemini
      const tempDir = require("os").tmpdir();
      const wavPath = await WavProcessor.saveAudioAsWav(combinedAudio, tempDir);
      const audioWavBase64 = require("fs").readFileSync(wavPath, "base64");

      // Process with full context (transcription + transformation)
      const result = await this.processAudioWithContext(audioWavBase64);

      // Create final segment update with enhanced text
      const update: SegmentUpdate = {
        segments: [
          {
            type: "transcribed",
            text: result,
            completed: true,
            start: Date.now(),
            end: Date.now(),
            confidence: 1.0,
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

      // Use TransformationService static methods for prompt processing
      const systemPrompt = TransformationService.processPrompt(
        this.options.system_prompt || "You are a helpful AI assistant.",
        savedState,
        windowInfo
      );

      const messagePrompt = TransformationService.processPrompt(
        this.options.message_prompt ||
          "Please transcribe the audio and provide a helpful response.",
        savedState,
        windowInfo
      );

      // Make Gemini API request for both transcription and transformation
      const response = await this.makeGeminiRequest(
        systemPrompt,
        messagePrompt,
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
      const modelId = this.modelConfig?.model || "gemini-2.5-flash";
      const url = `${this.apiBase}/models/${encodeURIComponent(
        modelId
      )}:generateContent?key=${encodeURIComponent(this.apiKey!)}`;

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
  }
  ```

- **Validation**: Plugin compiles and can be registered
- **Timeline**: 2 hours
- **Dependencies**: Phase 1 complete
- **Risks**: Medium - API integration complexity

#### **Step 3.2: Implement Plugin Configuration**

- **Objective**: Add Gemini-specific configuration options
- **Deliverable**: Configuration schema with API key, model selection, etc.
- **Key Options**:
  ```typescript
  getOptions(): PluginOption[] {
    return [
      {
        key: "api_key",
        type: "string",
        label: "API Key",
        description: "Google Gemini API key",
        default: "",
        required: true,
        category: "basic"
      },
      {
        key: "model",
        type: "select",
        label: "Model",
        description: "Gemini model to use",
        default: "gemini-2.5-flash",
        options: [
          { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Fast and efficient" },
          { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp", description: "Experimental features" }
        ],
        category: "basic"
      },
      {
        key: "temperature",
        type: "number",
        label: "Temperature",
        description: "Creativity level (0.0-1.0)",
        default: 1.0,
        min: 0.0,
        max: 1.0,
        category: "advanced"
      },
      {
        key: "enable_screenshots",
        type: "boolean",
        label: "Enable Screenshots",
        description: "Include screenshots in processing",
        default: true,
        category: "advanced"
      },
      {
        key: "system_prompt",
        type: "string",
        label: "System Prompt",
        description: "Custom system prompt with {selection}, {title}, {app} placeholders",
        default: "You are a helpful AI assistant.",
        category: "advanced"
      },
      {
        key: "message_prompt",
        type: "string",
        label: "Message Prompt",
        description: "Custom message prompt for audio processing (handles both transcription and transformation)",
        default: "Please transcribe the audio and provide a helpful response.",
        category: "advanced"
      },
      {
        key: "processing_mode",
        type: "select",
        label: "Processing Mode",
        description: "How Gemini should process the audio",
        default: "transcription_and_transformation",
        options: [
          { value: "transcription_and_transformation", label: "Transcription + Transformation", description: "Handle both transcription and text enhancement (recommended)" },
          { value: "transcription_only", label: "Transcription Only", description: "Only transcribe, use existing transformation service" }
        ],
        category: "advanced"
      }
    ];
  }
  ```
- **Integration with Existing Flow**:
  - When `processing_mode` is "transcription_and_transformation": Uses `runOnAll: true` and `skipTransformation: true`
  - When `processing_mode` is "transcription_only": Uses `runOnAll: false` and `skipTransformation: false`
  - This allows users to choose between Gemini handling everything or just transcription
- **Validation**: Configuration appears in settings UI
- **Timeline**: 1 hour
- **Dependencies**: Step 3.1
- **Risks**: Low - follows existing pattern

### **Phase 4: Integration and Enhancement (Estimated: 2-3 hours)**

#### **Step 4.1: Integrate with Plugin Manager**

- **Objective**: Register and enable the Gemini plugin
- **Deliverable**: Updated plugin registration and management
- **Changes**:
  - Update `src/plugins/index.ts` to export Gemini plugin
  - Ensure plugin manager can handle Gemini-specific features
- **Validation**: Plugin appears in available plugins list
- **Timeline**: 1 hour
- **Dependencies**: Phase 3 complete
- **Risks**: Low - follows existing pattern

#### **Step 4.2: Implement Screenshot Integration**

- **Objective**: Add screenshot capture and processing capability
- **Deliverable**: Screenshot-aware transcription processing
- **Key Features**:

  ```typescript
  private async captureScreenshot(): Promise<string | null> {
    if (!this.options.enable_screenshots) {
      return null;
    }

    try {
      // Capture active window screenshot
      const screenshot = await this.captureActiveWindow();
      return screenshot;
    } catch (error) {
      console.warn("Failed to capture screenshot:", error);
      return null;
    }
  }

  private async captureActiveWindow(): Promise<string> {
    // Implementation using Electron's desktopCapturer
    // or native screenshot APIs
  }
  ```

- **Validation**: Can process audio + screenshot combinations
- **Timeline**: 1.5 hours
- **Dependencies**: Step 4.1
- **Risks**: Medium - screenshot capture complexity

## **Part 3: Secure Storage Integration Plan**

### **Phase 5: Secure Storage Implementation (Estimated: 3-4 hours)**

#### **Step 5.1: Extend SecureStorageService**

- **Objective**: Enhance the existing service with plugin support
- **Deliverable**: Updated `SecureStorageService` with plugin methods
- **Key Implementation**:

  ```typescript
  export class SecureStorageService {
    private readonly SERVICE_NAME = "WhisperMac";

    // Existing API key methods (unchanged)
    async setApiKey(apiKey: string): Promise<void> {
      /* existing */
    }
    async getApiKey(): Promise<string | null> {
      /* existing */
    }
    async deleteApiKey(): Promise<void> {
      /* existing */
    }

    // New plugin methods
    async setSecureValue(
      pluginName: string,
      key: string,
      value: string
    ): Promise<void> {
      const accountName = `plugin_${pluginName}_${key}`;
      await keytar.setPassword(this.SERVICE_NAME, accountName, value);
    }

    async getSecureValue(
      pluginName: string,
      key: string
    ): Promise<string | null> {
      const accountName = `plugin_${pluginName}_${key}`;
      return keytar.getPassword(this.SERVICE_NAME, accountName);
    }

    async deleteSecureValue(pluginName: string, key: string): Promise<void> {
      const accountName = `plugin_${pluginName}_${key}`;
      await keytar.deletePassword(this.SERVICE_NAME, accountName);
    }

    async setSecureData(
      pluginName: string,
      key: string,
      data: any
    ): Promise<void> {
      const serialized = JSON.stringify(data);
      await this.setSecureValue(pluginName, key, serialized);
    }

    async getSecureData(pluginName: string, key: string): Promise<any | null> {
      const serialized = await this.getSecureValue(pluginName, key);
      if (!serialized) return null;
      try {
        return JSON.parse(serialized);
      } catch {
        return null;
      }
    }

    async listSecureKeys(pluginName: string): Promise<string[]> {
      const accounts = await keytar.findCredentials(this.SERVICE_NAME);
      const pluginPrefix = `plugin_${pluginName}_`;
      return accounts
        .filter((acc) => acc.account.startsWith(pluginPrefix))
        .map((acc) => acc.account.substring(pluginPrefix.length));
    }

    async clearPluginData(pluginName: string): Promise<void> {
      const keys = await this.listSecureKeys(pluginName);
      await Promise.all(
        keys.map((key) => this.deleteSecureValue(pluginName, key))
      );
    }
  }
  ```

- **Validation**: Service compiles and basic functionality works
- **Timeline**: 2 hours
- **Dependencies**: Phase 4 complete
- **Risks**: Medium - keytar integration complexity

#### **Step 5.2: Add Plugin Storage Interface to BaseTranscriptionPlugin**

- **Objective**: Extend the base plugin class with secure storage capabilities
- **Deliverable**: Updated `BaseTranscriptionPlugin` with storage methods
- **Key Additions**:

  ```typescript
  export abstract class BaseTranscriptionPlugin extends EventEmitter {
    // ... existing code ...

    protected secureStorage: SecureStorageService;

    constructor() {
      super();
      this.secureStorage = new SecureStorageService();
    }

    // Plugin secure storage methods
    protected async setSecureValue(key: string, value: string): Promise<void> {
      await this.secureStorage.setSecureValue(this.name, key, value);
    }

    protected async getSecureValue(key: string): Promise<string | null> {
      return this.secureStorage.getSecureValue(this.name, key);
    }

    protected async deleteSecureValue(key: string): Promise<void> {
      await this.secureStorage.deleteSecureValue(this.name, key);
    }

    protected async setSecureData(key: string, data: any): Promise<void> {
      await this.secureStorage.setSecureData(this.name, key, data);
    }

    protected async getSecureData(key: string): Promise<any | null> {
      return this.secureStorage.getSecureData(this.name, key);
    }

    protected async listSecureKeys(): Promise<string[]> {
      return this.secureStorage.listSecureKeys(this.name);
    }

    protected async clearSecureData(): Promise<void> {
      await this.secureStorage.clearPluginData(this.name);
    }

    // Enhanced clearData method
    async clearData(): Promise<void> {
      // Clear secure storage
      await this.clearSecureData();

      // Clear file-based data (existing implementation)
      // ... existing clearData logic ...
    }
  }
  ```

- **Validation**: Base class compiles and plugins can access secure storage
- **Timeline**: 1 hour
- **Dependencies**: Step 5.1
- **Risks**: Low - straightforward extension

#### **Step 5.3: Integrate Secure Storage with Gemini Plugin**

- **Objective**: Update Gemini plugin to use secure storage
- **Deliverable**: Gemini plugin with secure storage integration
- **Key Updates**:

  ```typescript
  export class GeminiTranscriptionPlugin extends BaseTranscriptionPlugin {
    // ... existing code ...

    async initialize(): Promise<void> {
      // Load secure configuration
      this.apiKey = await this.getSecureValue("api_key");
      this.modelConfig = await this.getSecureData("model_config");

      if (!this.apiKey) {
        throw new Error("Gemini API key not configured");
      }

      // ... initialization logic ...
    }

    async updateOptions(
      options: Record<string, any>,
      uiFunctions?: PluginUIFunctions
    ): Promise<void> {
      this.setOptions(options);

      // Store API key securely
      if (options.api_key) {
        await this.setSecureValue("api_key", options.api_key);
        this.apiKey = options.api_key;
      }

      // Store model configuration securely
      if (options.model) {
        await this.setSecureData("model_config", {
          model: options.model,
          temperature: options.temperature || 0.7,
          maxTokens: options.maxTokens || 4096,
          lastUpdated: new Date().toISOString(),
        });
        this.modelConfig = await this.getSecureData("model_config");
      }

      // ... validation and setup logic ...
    }

    async processAudioWithContext(
      audioWavBase64: string,
      screenshotBase64?: string
    ): Promise<string> {
      if (!this.apiKey) {
        throw new Error("Gemini API key not available");
      }

      // Use secure API key and configuration
      const config = this.modelConfig || {};

      // ... Gemini API integration logic using TransformationService ...
    }
  }
  ```

- **Validation**: Gemini plugin works with secure storage
- **Timeline**: 1 hour
- **Dependencies**: Step 5.2
- **Risks**: Low - straightforward integration

### **Phase 6: Settings UI Integration (Estimated: 2-3 hours)**

#### **Step 6.1: Update Settings Service**

- **Objective**: Add secure storage management to settings UI
- **Deliverable**: Enhanced settings service with secure storage support
- **Key Changes**:

  ```typescript
  export class SettingsService {
    // ... existing code ...

    // Add secure storage management handlers
    ipcMain.handle("plugins:getSecureStorageInfo", async (event, payload: { pluginName: string }) => {
      const plugin = this.transcriptionPluginManager?.getPlugin(payload.pluginName);
      if (!plugin) {
        throw new Error(`Plugin ${payload.pluginName} not found`);
      }

      const keys = await plugin.listSecureKeys();
      const dataSize = await this.transcriptionPluginManager.getPluginDataSize(payload.pluginName);

      return {
        keys: keys.map(key => ({ name: key, type: 'secure' })),
        totalSize: dataSize,
        hasSecureData: keys.length > 0
      };
    });

    ipcMain.handle("plugins:clearSecureData", async (event, payload: { pluginName: string }) => {
      const plugin = this.transcriptionPluginManager?.getPlugin(payload.pluginName);
      if (!plugin) {
        throw new Error(`Plugin ${payload.pluginName} not found`);
      }

      await plugin.clearSecureData();
      return { success: true };
    });

    ipcMain.handle("plugins:exportSecureData", async (event, payload: { pluginName: string }) => {
      const plugin = this.transcriptionPluginManager?.getPlugin(payload.pluginName);
      if (!plugin) {
        throw new Error(`Plugin ${payload.pluginName} not found`);
      }

      const keys = await plugin.listSecureKeys();
      const data: Record<string, any> = {};

      for (const key of keys) {
        data[key] = await plugin.getSecureData(key);
      }

      return { data, timestamp: new Date().toISOString() };
    });
  }
  ```

- **Validation**: Settings service handles secure storage operations
- **Timeline**: 1.5 hours
- **Dependencies**: Phase 5 complete
- **Risks**: Low - straightforward IPC handlers

#### **Step 6.2: Update Settings UI**

- **Objective**: Add secure storage management to the settings interface
- **Deliverable**: Enhanced settings UI with secure storage controls
- **Key Features**:
  - Secure storage status indicator
  - Clear secure data button
  - Export secure data option
  - Secure storage size display
- **Validation**: UI properly displays and manages secure storage
- **Timeline**: 1.5 hours
- **Dependencies**: Step 6.1
- **Risks**: Low - UI enhancement task

## **Phase 7: Testing and Validation (Estimated: 3-4 hours)**

### **Step 7.1: Unit Testing**

- **Objective**: Comprehensive testing of plugin functionality
- **Deliverable**: Test suite for Gemini plugin and secure storage
- **Key Tests**:
  - API key validation and secure storage
  - Audio processing with Gemini API
  - Screenshot integration
  - Context integration
  - Error scenarios
  - Configuration handling
  - TransformationService integration
- **Validation**: All tests pass
- **Timeline**: 2 hours
- **Dependencies**: Phase 6 complete
- **Risks**: Low - standard testing practices

### **Step 7.2: Integration Testing**

- **Objective**: Test plugin integration with full application
- **Deliverable**: End-to-end testing scenarios
- **Key Tests**:
  - Plugin switching with secure storage
  - Settings persistence
  - Performance under load
  - Secure storage isolation
  - Data migration scenarios
  - TransformationService method usage
- **Validation**: Plugin works seamlessly in full app
- **Timeline**: 2 hours
- **Dependencies**: Step 7.1
- **Risks**: Medium - integration complexity

## **Phase 8: Documentation and Deployment (Estimated: 1-2 hours)**

### **Step 8.1: Update Documentation**

- **Objective**: Document Gemini plugin usage and secure storage
- **Deliverable**: Updated README and configuration docs
- **Key Content**:
  - Gemini plugin setup instructions
  - Secure storage API reference
  - Configuration options
  - Troubleshooting guide
  - Security considerations
  - TransformationService integration guide
- **Validation**: Documentation is clear and complete
- **Timeline**: 1 hour
- **Dependencies**: Phase 7 complete
- **Risks**: Low - documentation task

### **Step 8.2: Final Integration and Cleanup**

- **Objective**: Ensure clean integration and remove any temporary code
- **Deliverable**: Production-ready Gemini plugin with secure storage
- **Key Tasks**:
  - Code cleanup and optimization
  - Remove debug code
  - Final testing
  - Performance optimization
- **Validation**: Plugin is production-ready
- **Timeline**: 1 hour
- **Dependencies**: Step 8.1
- **Risks**: Low - cleanup task

## **Key Implementation Details**

### **File Structure Changes**

```
src/services/
├── TransformationService.ts          # Enhanced with processPrompt and public methods
└── SettingsService.ts               # Updated with secure storage handlers

src/plugins/
├── TranscriptionPlugin.ts           # Enhanced base class with secure storage
├── TranscriptionPluginManager.ts    # Updated manager
├── GeminiTranscriptionPlugin.ts     # New plugin using TransformationService
└── index.ts                         # Updated exports
```

### **TransformationService Enhancements**

The enhanced TransformationService will provide:

1. **processPrompt()**: Static method for unified prompt processing with placeholder replacement and sel tag handling
2. **extractCode()**: Static method for code extraction from responses
3. **removeThink()**: Static method for removing think tags
4. **removeChanged()**: Static method for removing change prefixes
5. **buildGeminiRequestParts()**: Static method for request assembly utility

**Audio Conversion**: Uses existing `WavProcessor` for audio processing instead of duplicating functionality

### **Dependencies to Add**

- No new dependencies required (uses existing fetch API and keytar)
- May need to add Google AI SDK if preferred over direct API calls

### **Configuration Schema**

```typescript
interface GeminiPluginConfig {
  apiKey: string; // Stored securely
  model: string; // gemini-2.5-flash, etc.
  temperature: number; // 0.0-1.0
  maxTokens: number; // 4096 default
  enableScreenshots: boolean; // true default
  systemPrompt: string; // Custom system prompt
  messagePrompt: string; // Custom message prompt
}
```

### **Integration Points**

1. **Plugin Manager**: Register and manage Gemini plugin with dual role support
2. **Settings Service**: Store and retrieve Gemini configuration
3. **Secure Storage**: Store API key and sensitive configuration securely
4. **Dictation Flow**: Integrate with transcription pipeline using `runOnAll` and `skipTransformation`
5. **UI Components**: Add Gemini-specific settings UI with processing mode selection
6. **Screenshot Service**: Capture and process screenshots
7. **Context Service**: Integrate selected text and window info
8. **TransformationService**: Use static methods for unified parsing and transformation logic
9. **WavProcessor**: Use existing audio processing utilities
10. **Audio Buffering**: Leverage plugin manager's audio buffering for complete context processing

## **Risk Mitigation**

1. **API Changes**: Use versioned Gemini API endpoints
2. **Rate Limiting**: Implement exponential backoff and retry logic
3. **Performance**: Monitor API response times and optimize chunking
4. **Compatibility**: Ensure plugin works with existing transcription flow
5. **Security**: Proper API key handling and validation
6. **Data Loss**: Implement backup and recovery mechanisms
7. **Platform Support**: Test on all supported platforms
8. **Service Integration**: Ensure TransformationService changes don't break existing functionality

## **Success Criteria**

1. ✅ Gemini plugin can be selected and configured
2. ✅ API keys are stored securely using the new secure storage system
3. ✅ Audio transcription works with Gemini API
4. ✅ Screenshot integration functions properly
5. ✅ Context (selected text, window info) is included
6. ✅ Real-time processing works smoothly
7. ✅ Error handling is robust
8. ✅ Plugin integrates seamlessly with existing UI
9. ✅ Performance is acceptable (sub-2 second response times)
10. ✅ Secure storage is properly isolated between plugins
11. ✅ Settings UI provides secure storage management
12. ✅ Clear data operations work completely
13. ✅ Security validation passes all tests
14. ✅ Documentation is comprehensive and clear
15. ✅ Backward compatibility is maintained
16. ✅ TransformationService provides unified parsing and transformation via static methods
17. ✅ Gemini plugin uses TransformationService static methods instead of duplicate code
18. ✅ processPrompt() method handles all placeholder replacements and sel tags
19. ✅ Audio conversion uses existing WavProcessor instead of duplicate implementation
20. ✅ **Dual Role Functionality**: Plugin acts as both transcription and transformation service
21. ✅ **runOnAll Integration**: Plugin receives all audio chunks and processes complete context
22. ✅ **skipTransformation Integration**: Plugin bypasses TransformationService when handling both roles
23. ✅ **Processing Mode Selection**: Users can choose between transcription-only and full processing modes
24. ✅ **Audio Buffering**: Plugin properly handles buffered audio from plugin manager
25. ✅ **Complete Context Processing**: Gemini receives full audio context for better understanding and enhancement

## **Timeline Summary**

- **Phase 1**: Enhance TransformationService (2-3 hours)
- **Phase 2**: Analysis and Design (1-2 hours)
- **Phase 3**: Core Plugin Implementation (3-4 hours)
- **Phase 4**: Integration and Enhancement (2-3 hours)
- **Phase 5**: Secure Storage Implementation (3-4 hours)
- **Phase 6**: Settings UI Integration (2-3 hours)
- **Phase 7**: Testing and Validation (3-4 hours)
- **Phase 8**: Documentation and Deployment (1-2 hours)

**Total Estimated Time**: 17-25 hours

This comprehensive plan provides a complete roadmap for implementing a Gemini plugin with secure storage capabilities, unified with the existing TransformationService architecture to eliminate code duplication and provide consistent parsing and transformation logic across all plugins.
