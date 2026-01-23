/**
 * AI provider configuration and validation utilities.
 * Provides functions for API key validation, model loading, and configuration management.
 */

/**
 * @typedef {Object} AiModel
 * @property {string} id - Model identifier
 * @property {string} [name] - Human-friendly model name
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Whether validation succeeded
 * @property {AiModel[]} [models] - Available models if successful
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} AiConfigValidationResult
 * @property {boolean} isValid - Whether configuration is valid
 * @property {AiModel[]} [models] - Available models if valid
 * @property {string} [error] - Error message if invalid
 */

/**
 * Validate an API key and list available models
 * @param {string} baseUrl - The AI provider base URL
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<ValidationResult>}
 */
export async function validateApiKeyAndListModels(baseUrl, apiKey) {
  try {
    return await window.electronAPI.validateApiKeyAndListModels(
      baseUrl,
      apiKey,
    );
  } catch (error) {
    console.error("Error validating API key:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Validate full AI configuration
 * @param {string} baseUrl - The AI provider base URL
 * @param {string} model - The selected model
 * @param {string} apiKey - The API key
 * @returns {Promise<AiConfigValidationResult>}
 */
export async function validateAiConfiguration(baseUrl, model, apiKey) {
  try {
    return await window.electronAPI.validateAiConfiguration(
      baseUrl,
      model,
      apiKey,
    );
  } catch (error) {
    console.error("Error validating AI configuration:", error);
    return { isValid: false, error: error.message };
  }
}

/**
 * Save API key to secure storage
 * @param {string} apiKey - The API key to save
 * @returns {Promise<void>}
 */
export async function saveApiKeySecure(apiKey) {
  if (window.electronAPI?.saveApiKeySecure) {
    await window.electronAPI.saveApiKeySecure(apiKey);
  } else if (window.onboardingAPI?.saveApiKey) {
    await window.onboardingAPI.saveApiKey(apiKey);
  }
}

/**
 * Get API key from secure storage
 * @returns {Promise<string|null>}
 */
export async function getApiKeySecure() {
  try {
    return await window.electronAPI.getApiKeySecure();
  } catch (error) {
    console.error("Failed to get API key:", error);
    return null;
  }
}

/**
 * Load AI models if API key and base URL are configured
 * @param {Object} settings - The settings object with ai.baseUrl
 * @returns {Promise<{models: AiModel[], loadedForBaseUrl: string|null}>}
 */
export async function loadAiModelsIfConfigured(settings) {
  const result = { models: [], loadedForBaseUrl: null };

  try {
    const apiKey = await getApiKeySecure();
    if (apiKey && settings?.ai?.baseUrl) {
      const validationResult = await validateApiKeyAndListModels(
        settings.ai.baseUrl,
        apiKey,
      );
      if (validationResult.success && validationResult.models?.length > 0) {
        result.models = validationResult.models;
        result.loadedForBaseUrl = settings.ai.baseUrl;
      }
    }
  } catch (error) {
    console.error("Failed to auto-load AI models:", error);
  }

  return result;
}

/**
 * Set AI enabled state via onboarding API
 * @param {boolean} enabled - Whether AI should be enabled
 * @returns {Promise<void>}
 */
export async function setAiEnabled(enabled) {
  if (window.electronAPI?.setAiEnabled) {
    await window.electronAPI.setAiEnabled(enabled);
  } else if (window.onboardingAPI?.setAiEnabled) {
    await window.onboardingAPI.setAiEnabled(enabled);
  }
}

/**
 * Set AI provider configuration via onboarding API
 * @param {string} baseUrl - The base URL
 * @param {string} model - The model
 * @returns {Promise<void>}
 */
export async function setAiProvider(baseUrl, model) {
  if (window.electronAPI?.setAiProvider) {
    await window.electronAPI.setAiProvider(baseUrl, model);
  } else if (window.onboardingAPI?.setAiProvider) {
    await window.onboardingAPI.setAiProvider(baseUrl, model);
  }
}

/**
 * Create debounced API key validation function
 * @param {Function} validateFn - The validation function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {{validate: Function, cancel: Function}}
 */
export function createDebouncedValidator(validateFn, delay = 1000) {
  let timeoutId = null;

  return {
    validate: () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(validateFn, delay);
    },
    cancel: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}
