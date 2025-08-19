import { AiProviderService } from "./AiProviderService";
import { SecureStorageService } from "./SecureStorageService";

export interface AiValidationResult {
  isValid: boolean;
  error?: string;
  models?: Array<{ id: string; name?: string }>;
}

export class AiValidationService {
  private aiProviderService: AiProviderService;
  private secureStorageService: SecureStorageService;

  constructor() {
    this.aiProviderService = new AiProviderService();
    this.secureStorageService = new SecureStorageService();
  }

  /**
   * Validates if AI polishing can be enabled with the current configuration
   */
  async validateAiConfiguration(
    baseUrl: string,
    model: string,
    apiKey?: string
  ): Promise<AiValidationResult> {
    // Check if base URL is provided
    if (!baseUrl || baseUrl.trim() === "") {
      return {
        isValid: false,
        error: "API Base URL is required",
      };
    }

    // Check if model is provided
    if (!model || model.trim() === "") {
      return {
        isValid: false,
        error: "Model selection is required",
      };
    }

    // Get API key from secure storage if not provided
    let keyToUse: string | null = apiKey || null;
    if (!keyToUse) {
      try {
        keyToUse = await this.secureStorageService.getApiKey();
      } catch (error) {
        // Ignore error, will be caught below
      }
    }

    // Check if API key is available
    if (!keyToUse || keyToUse.trim() === "") {
      return {
        isValid: false,
        error: "API key is required. Please provide your API key.",
      };
    }

    // Validate API key and get available models
    try {
      const result = await this.aiProviderService.validateAndListModels(
        baseUrl,
        keyToUse
      );

      if (!result.success) {
        return {
          isValid: false,
          error: result.error || "Failed to validate API key",
        };
      }

      // Check if the selected model is available
      const availableModels = result.models || [];
      const modelExists = availableModels.some((m) => m.id === model);

      if (!modelExists) {
        return {
          isValid: false,
          error: `Selected model "${model}" is not available. Available models: ${availableModels
            .map((m) => m.id)
            .join(", ")}`,
          models: availableModels,
        };
      }

      return {
        isValid: true,
        models: availableModels,
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Validates if AI polishing can be enabled with current settings
   */
  async validateCurrentAiSettings(): Promise<AiValidationResult> {
    // This would need to be called with current settings from the app config
    // For now, return a placeholder that indicates validation is needed
    return {
      isValid: false,
      error: "AI configuration validation required",
    };
  }
}
