/**
 * Plugin management utilities.
 * Provides helpers for plugin initialization, activation testing, and option management.
 */

/**
 * @typedef {Object} Plugin
 * @property {string} name - Plugin identifier
 * @property {string} displayName - Human-friendly name
 */

/**
 * @typedef {Object} PluginOption
 * @property {string} key - Option key
 * @property {*} default - Default value
 * @property {string} type - Option type
 */

/**
 * @typedef {Object} PluginData
 * @property {Plugin[]} plugins - Available plugins
 * @property {Object<string, PluginOption[]>} schemas - Plugin option schemas
 */

/**
 * Ensure plugin settings objects exist with default values
 * @param {Object} settings - The settings object to modify
 * @param {PluginData} pluginData - The plugin data with schemas
 */
export function ensurePluginSettingsObjects(settings, pluginData) {
  if (!settings.plugin) settings.plugin = {};
  if (!pluginData?.plugins || !pluginData?.schemas) {
    console.warn(
      "Plugin data structure is incomplete, skipping plugin settings initialization",
    );
    return;
  }

  for (const plugin of pluginData.plugins) {
    if (!settings.plugin[plugin.name]) {
      settings.plugin[plugin.name] = {};
    }
    const options = pluginData.schemas[plugin.name] || [];
    for (const option of options) {
      if (settings.plugin[plugin.name][option.key] === undefined) {
        settings.plugin[plugin.name][option.key] = option.default;
      }
    }
  }
}

/**
 * Get the display name for a plugin
 * @param {Plugin[]} plugins - Available plugins
 * @param {string} pluginName - The plugin identifier
 * @returns {string} The display name or the plugin name as fallback
 */
export function getPluginDisplayName(plugins, pluginName) {
  const plugin = plugins.find((p) => p.name === pluginName);
  return plugin?.displayName || pluginName;
}

/**
 * Test if a plugin can be activated with given options
 * @param {string} pluginName - The plugin to test
 * @param {Object} options - The plugin options
 * @returns {Promise<{canActivate: boolean, error?: string}>}
 */
export async function testPluginActivation(pluginName, options) {
  try {
    return await window.electronAPI.testPluginActivation(pluginName, options);
  } catch (error) {
    console.error("Error testing plugin activation:", error);
    return { canActivate: false, error: error.message };
  }
}

/**
 * Switch to a different plugin
 * @param {string} pluginName - The plugin to switch to
 * @param {string} [modelName] - Optional model name for model switch
 * @returns {Promise<void>}
 */
export async function switchPlugin(pluginName, modelName) {
  return window.electronAPI.switchPlugin(pluginName, modelName);
}

/**
 * Get the currently active plugin
 * @returns {Promise<string|null>}
 */
export async function getActivePlugin() {
  try {
    return await window.electronAPI.getActivePlugin();
  } catch (error) {
    console.error("Failed to get active plugin:", error);
    return null;
  }
}

/**
 * Get plugin schemas from the main process
 * @returns {Promise<PluginData>}
 */
export async function getPluginSchemas() {
  try {
    const api = window.electronAPI || window.onboardingAPI;
    return await api.getPluginSchemas();
  } catch (error) {
    console.error("Failed to load plugin schemas:", error);
    return { plugins: [], schemas: {} };
  }
}

/**
 * Initialize selected options for all plugins with defaults
 * @param {Object<string, PluginOption[]>} pluginOptions - Plugin option schemas
 * @returns {Object<string, Object>} Selected options by plugin name
 */
export function initializePluginOptions(pluginOptions) {
  const selectedOptions = {};
  for (const [pluginName, options] of Object.entries(pluginOptions)) {
    selectedOptions[pluginName] = {};
    for (const option of options) {
      selectedOptions[pluginName][option.key] = option.default;
    }
  }
  return selectedOptions;
}

/**
 * Update a plugin option value
 * @param {Object} settings - The settings object
 * @param {string} pluginName - The plugin name
 * @param {string} key - The option key
 * @param {*} value - The new value
 */
export function updatePluginOption(settings, pluginName, key, value) {
  if (!settings.plugin) settings.plugin = {};
  if (!settings.plugin[pluginName]) settings.plugin[pluginName] = {};
  settings.plugin[pluginName][key] = value;
}

/**
 * Set plugin and options via onboarding API
 * @param {string} pluginName - The plugin name
 * @param {Object} options - The plugin options
 * @returns {Promise<void>}
 */
export async function setPluginOnboarding(pluginName, options) {
  if (window.onboardingAPI?.setPlugin) {
    await window.onboardingAPI.setPlugin(pluginName, options);
  }
}
