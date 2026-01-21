import { log, info, warn, error } from "../utils/logger";
import SettingsField from "../components/settings/ui/Field.vue";
import TranscriptionSection from "../components/settings/transcription/TranscriptionSection.vue";
import PermissionsSection from "../components/settings/PermissionsSection.vue";

import {
  enumerateMicrophones,
  updateSchemaWithMicrophones,
} from "../utils/microphone";

import {
  getSettingValue,
  setSettingValue,
  isStandardFieldType,
  deepClone,
} from "../utils/settings-store";

import {
  ensurePluginSettingsObjects,
  getPluginDisplayName,
  testPluginActivation,
  switchPlugin,
  getActivePlugin,
  getPluginSchemas,
  updatePluginOption,
} from "../utils/plugins";

import {
  validateApiKeyAndListModels,
  saveApiKeySecure,
  loadAiModelsIfConfigured,
  createDebouncedValidator,
} from "../utils/ai-provider";

import { captureHotkey } from "../utils/hotkey";

import {
  showStatus as showStatusUtil,
  showProgress as showProgressUtil,
  hideProgress as hideProgressUtil,
} from "../utils/status-notification";

import {
  formatBytes,
  formatRepoUrl,
  getAuthorUrl,
  openExternalUrl,
} from "../utils/formatters";

import {
  addAction,
  deleteAction as deleteActionUtil,
  addPattern,
  deletePattern as deletePatternUtil,
  addHandler,
  deleteHandler as deleteHandlerUtil,
  updateHandlerType as updateHandlerTypeUtil,
  getHandlerIcon,
  getHandlerTypeName,
  getHandlerSummary,
  getPatternTypeBadge,
  moveItem,
  resyncOrder,
} from "../utils/actions-editor";

import {
  addRule,
  deleteRule as deleteRuleUtil,
  moveRule as moveRuleUtil,
  addExample,
  deleteExample as deleteExampleUtil,
  updateRuleCondition,
  getConditionIcon,
  getConditionLabel,
} from "../utils/rules-editor";

export default {
  components: {
    SettingsField,
    TranscriptionSection,
    PermissionsSection,
  },
  data() {
    return {
      schema: [],
      settings: {},
      originalSettings: {},
      currentSectionId: null,
      validationErrors: {},
      pluginData: { plugins: [], schemas: {} },
      activePlugin: null,
      pluginDataInfo: [],
      pluginDataItems: {},
      expandedActions: {},
      expandedRules: {},
      expandedDataPlugins: {},
      editingPattern: null,
      expandedHandlers: {},
      configSections: {},
      aiModelsState: { loading: false, loadedForBaseUrl: null, models: [] },
      status: { visible: false, message: "", type: "success" },
      progress: { visible: false, message: "", percent: 0 },
      isSaving: false,
      isClearingAll: false,
      apiKeyInput: "",
      apiKeyValidationTimeout: null,
      pendingPluginSwitch: false, // Track when plugin switch is pending due to failed immediate activation
      appVersion: "1.0.0", // Will be populated from package.json
      packageInfo: null, // Will be populated from package.json
      activePluginAiCapabilities: {
        isAiPlugin: false,
        supportsCombinedMode: false,
        processingMode: null,
        transformationSettingsKeys: [],
      },
    };
  },
  computed: {
    currentSection() {
      return this.schema.find((s) => s.id === this.currentSectionId) || null;
    },
    totalDataUsage() {
      return this.pluginDataInfo.reduce((total, plugin) => {
        return total + (plugin.dataSize || 0);
      }, 0);
    },
    pluginCountWithData() {
      return this.pluginDataInfo.filter((plugin) => plugin.dataSize > 0).length;
    },
    enabledRulesCount() {
      return (this.settings.rules || []).filter((rule) => rule.enabled).length;
    },
    totalRulesCount() {
      return (this.settings.rules || []).length;
    },
    /**
     * Check if AI transformation settings are overridden by the active transcription plugin
     * Returns true if the plugin is an AI plugin in combined transcription+transformation mode
     */
    aiTransformationOverridden() {
      const caps = this.activePluginAiCapabilities;
      return (
        caps.isAiPlugin &&
        caps.supportsCombinedMode &&
        caps.processingMode === "transcription_and_transformation"
      );
    },
    /**
     * Get the display name of the active plugin that overrides transformation
     */
    overridingPluginName() {
      if (!this.aiTransformationOverridden) return null;
      const plugin = this.pluginData.plugins.find(
        (p) => p.name === this.activePlugin,
      );
      return plugin?.displayName || this.activePlugin;
    },
  },
  methods: {
    /**
     * Check if a specific field should be disabled because it's overridden by the plugin
     * These fields are managed by the AI transcription plugin when in combined mode
     */
    isFieldOverriddenByPlugin(fieldKey) {
      if (!this.aiTransformationOverridden) return false;

      // Fields that are overridden by the AI transcription plugin
      const overriddenFields = [
        "ai.baseUrl",
        "ai.model",
        "ai.maxTokens",
        "ai.temperature",
        "ai.topP",
      ];

      return overriddenFields.includes(fieldKey);
    },

    // --- INITIALIZATION ---
    async openAuthorLink(event) {
      event.preventDefault();
      if (this.packageInfo?.repository?.url) {
        const authorUrl = getAuthorUrl(this.packageInfo.repository.url);
        await openExternalUrl(authorUrl);
      }
    },

    getRepoUrl() {
      if (this.packageInfo?.repository?.url) {
        return formatRepoUrl(this.packageInfo.repository.url);
      }
      return "https://github.com/explosion-scratch/whisper-mac";
    },

    getReleasesUrl() {
      return `${this.getRepoUrl()}/releases/tag/v${this.appVersion}`;
    },

    async openExternalLink(url) {
      await openExternalUrl(url);
    },

    async init() {
      try {
        this.schema = deepClone(await window.electronAPI.getSettingsSchema());
        this.settings = deepClone(await window.electronAPI.getSettings());
        this.originalSettings = deepClone(this.settings);
        window.log("this.settings", this.originalSettings);

        try {
          const microphones = await enumerateMicrophones();
          console.log("Enumerated microphones:", microphones);
          this.schema = updateSchemaWithMicrophones(this.schema, microphones);
        } catch (error) {
          console.error("Failed to enumerate microphones:", error);
        }

        try {
          this.pluginData = await getPluginSchemas();
          window.log("this.pluginData", this.pluginData);
        } catch (error) {
          window.error("Failed to load plugin schemas:", error);
          this.pluginData = { plugins: [], schemas: {} };
        }

        const pluginManagerActive = await getActivePlugin();
        this.activePlugin =
          pluginManagerActive || this.settings.transcriptionPlugin || "yap";
        window.log("this.activePlugin", this.activePlugin);
        ensurePluginSettingsObjects(this.settings, this.pluginData);

        // Fetch AI capabilities of active plugin
        await this.fetchActivePluginAiCapabilities();

        try {
          this.appVersion = await window.electronAPI.getAppVersion();
          this.packageInfo = await window.electronAPI.getPackageInfo();
        } catch (error) {
          window.error("Failed to load app version:", error);
          this.appVersion = "1.0.0";
          this.packageInfo = null;
        }

        if (this.schema.length > 0) {
          this.showSection(this.schema[0].id);
        }

        this.setupIpcListeners();
      } catch (error) {
        window.error("Failed to initialize settings window:", error);
        this.showStatus("Failed to load settings", "error");
      }
    },

    /**
     * Fetch AI capabilities of the active transcription plugin
     * Used to determine if AI transformation settings should be overridden
     */
    async fetchActivePluginAiCapabilities() {
      try {
        const capabilities =
          await window.electronAPI.getActivePluginAiCapabilities();
        this.activePluginAiCapabilities = capabilities || {
          isAiPlugin: false,
          supportsCombinedMode: false,
          processingMode: null,
          transformationSettingsKeys: [],
        };
        window.log(
          "Active plugin AI capabilities:",
          this.activePluginAiCapabilities,
        );
      } catch (error) {
        window.error("Failed to fetch active plugin AI capabilities:", error);
        this.activePluginAiCapabilities = {
          isAiPlugin: false,
          supportsCombinedMode: false,
          processingMode: null,
          transformationSettingsKeys: [],
        };
      }
    },

    setupIpcListeners() {
      window.electronAPI.onPluginSwitchProgress((progress) => {
        this.showProgress(
          progress.message || "Processing...",
          progress.percent || progress.progress || 0,
        );
      });

      // Listen for navigation to specific sections
      window.electronAPI.onNavigateToSection((sectionId) => {
        this.showSection(sectionId);
      });

      // Listen for settings updates from main process (e.g., when hotkeys change)
      window.electronAPI.onSettingsUpdated((newSettings) => {
        // Update local settings to stay in sync with backend
        this.settings = deepClone(newSettings);
        this.originalSettings = deepClone(newSettings);
        ensurePluginSettingsObjects(this.settings, this.pluginData);
      });
    },

    ensurePluginSettingsObjects() {
      if (!this.settings.plugin) this.settings.plugin = {};
      if (
        !this.pluginData ||
        !this.pluginData.plugins ||
        !this.pluginData.schemas
      ) {
        window.warn(
          "Plugin data structure is incomplete, skipping plugin settings initialization",
        );
        return;
      }

      for (const plugin of this.pluginData.plugins) {
        if (!this.settings.plugin[plugin.name]) {
          this.settings.plugin[plugin.name] = {};
        }
        // Ensure all options from schema have a default value if not present
        const options = this.pluginData.schemas[plugin.name] || [];
        for (const option of options) {
          if (this.settings.plugin[plugin.name][option.key] === undefined) {
            this.settings.plugin[plugin.name][option.key] = option.default;
          }
        }
      }
    },

    // --- UI & NAVIGATION ---
    showSection(sectionId) {
      this.currentSectionId = sectionId;
      if (sectionId === "data") {
        this.loadPluginDataInfo();
      }
      if (sectionId === "ai") {
        this.loadAiModelsIfConfigured();
      }
      // Permissions section now handles its own initialization via PermissionsSection component
    },

    async loadAiModelsIfConfigured() {
      try {
        const apiKey = await window.electronAPI.getApiKeySecure();
        if (apiKey && this.settings.ai && this.settings.ai.baseUrl) {
          this.aiModelsState.loading = true;
          const result = await window.electronAPI.validateApiKeyAndListModels(
            this.settings.ai.baseUrl,
            apiKey,
          );
          if (result.success && result.models.length > 0) {
            this.aiModelsState.models = result.models;
            this.aiModelsState.loadedForBaseUrl = this.settings.ai.baseUrl;
          }
        }
      } catch (e) {
        window.error("Failed to auto-load AI models:", e);
      } finally {
        this.aiModelsState.loading = false;
      }
    },

    getIcon(iconName) {
      const iconMap = {
        settings: "ph-gear-six",
        window: "ph-app-window",
        "document-text": "ph-text-aa",
        flash: "ph-lightning",
        cog: "ph-gear",
        slider: "ph-sliders-horizontal",
        transcription: "ph-plugs-connected",
        dictation: "ph-app-window",
        text: "ph-text-aa",
        ai: "ph-robot",
        actions: "ph-lightning",
        advanced: "ph-sliders-horizontal",
        data: "ph-database",
        waveform: "ph-waveform",
        "flow-arrow": "ph-flow-arrow",
        database: "ph-database",
        shield: "ph-shield",
        keyboard: "ph-keyboard",
      };
      return iconMap[iconName] || "ph-gear";
    },

    getFieldIcon(field) {
      const iconMap = {
        text: "ph-text-aa",
        number: "ph-hash",
        boolean: "ph-toggle-left",
        select: "ph-list",
        textarea: "ph-text-align-left",
        slider: "ph-sliders-horizontal",
        directory: "ph-folder",
        "ai.model": "ph-brain",
        "ai.baseUrl": "ph-link",
        "rules-editor": "ph-text-aa",
      };
      return iconMap[field.key] || iconMap[field.type] || "ph-gear";
    },

    showStatus(message, type = "success", timeout = 3000) {
      this.status = { visible: true, message, type };
      setTimeout(() => {
        this.status.visible = false;
      }, timeout);
    },

    showProgress(message, percent) {
      this.progress = { visible: true, message, percent };
    },

    hideProgress() {
      this.progress.visible = false;
    },

    // --- PERMISSIONS STATUS HANDLER ---
    /**
     * Handle status events from PermissionsSection component
     * @param {Object} payload - { message: string, type: 'success' | 'error' | 'warning' | 'info' }
     */
    handlePermissionStatus(payload) {
      this.showStatus(payload.message, payload.type);
    },

    // --- DATA HANDLING ---
    getSettingValue(key) {
      return getSettingValue(this.settings, key);
    },

    setSettingValue(key, value) {
      setSettingValue(this.settings, key, value);
    },

    isStandardFieldType(type) {
      return isStandardFieldType(type);
    },

    /**
     * Handles field value updates from SettingsField component
     * @param {string} key - The setting key
     * @param {*} value - The new value
     */
    handleFieldUpdate(key, value) {
      setSettingValue(this.settings, key, value);
    },

    /**
     * Handles plugin selection change from TranscriptionSection
     * @param {string} newPlugin - The new plugin name
     */
    async handleTranscriptionPluginChange(newPlugin) {
      this.activePlugin = newPlugin;
      this.handlePluginChange();
      // Refresh AI capabilities when plugin changes
      await this.fetchActivePluginAiCapabilities();
    },

    /**
     * Handles option change from TranscriptionSection
     * @param {Object} payload - { pluginName, optionKey, value }
     */
    async handleTranscriptionOptionChange(payload) {
      const { pluginName, optionKey, value } = payload;
      this.settings.plugin[pluginName][optionKey] = value;

      // If processing_mode changed, refresh AI capabilities
      if (optionKey === "processing_mode") {
        // Update plugin options first so the backend knows the new mode
        try {
          await window.electronAPI.setPluginOptions(pluginName, {
            ...this.settings.plugin[pluginName],
            [optionKey]: value,
          });
        } catch (error) {
          window.error("Failed to update plugin options:", error);
        }
        // Refresh AI capabilities to update the override state
        await this.fetchActivePluginAiCapabilities();
      }
    },

    /**
     * Handles model change from TranscriptionSection (triggers download)
     * @param {Object} payload - { pluginName, optionKey, value }
     */
    handleTranscriptionModelChange(payload) {
      const { pluginName, optionKey, value } = payload;
      this.handlePluginModelChange(pluginName, optionKey, value);
    },

    /**
     * Handles API key validation result from TranscriptionSection
     * @param {Object} payload - { pluginName, valid, error? }
     */
    async handlePluginApiKeyValidated(payload) {
      const { pluginName, valid, error } = payload;
      if (valid) {
        this.showStatus(`${pluginName} API key validated and saved`, "success");
        // Refresh AI capabilities in case this affects override state
        await this.fetchActivePluginAiCapabilities();
        // Clear any pending plugin switch since we now have valid config
        if (this.pendingPluginSwitch && this.activePlugin === pluginName) {
          this.pendingPluginSwitch = false;
        }
      } else if (error) {
        this.showStatus(`API key validation failed: ${error}`, "error");
      }
    },

    async saveSettings() {
      this.isSaving = true;
      try {
        const currentActivePlugin = this.settings.transcriptionPlugin;
        const newActivePlugin = this.activePlugin;
        const pluginChanged = currentActivePlugin !== newActivePlugin;

        if (pluginChanged && this.pendingPluginSwitch) {
          const pluginOptions = JSON.parse(
            JSON.stringify(this.settings.plugin[newActivePlugin] || {}),
          );
          const testResult = await window.electronAPI.testPluginActivation(
            newActivePlugin,
            pluginOptions,
          );

          if (!testResult.canActivate) {
            this.showStatus(
              `Cannot save: ${newActivePlugin} configuration is invalid. ${testResult.error}`,
              "error",
            );
            return;
          }

          this.showProgress(`Switching to ${newActivePlugin}...`, 0);
          try {
            await window.electronAPI.switchPlugin(newActivePlugin);
            this.showStatus(
              `Switched to ${newActivePlugin} successfully`,
              "success",
            );
          } catch (switchError) {
            this.showStatus(
              `Failed to switch to ${newActivePlugin}: ${switchError.message}`,
              "error",
            );
            this.activePlugin = currentActivePlugin;
            return;
          } finally {
            this.hideProgress();
          }
          this.pendingPluginSwitch = false;
        } else if (pluginChanged) {
          this.settings.transcriptionPlugin = this.activePlugin;
        }

        this.settings.transcriptionPlugin = this.activePlugin;

        const settingsToSave = JSON.parse(JSON.stringify(this.settings));

        await window.electronAPI.saveSettings(settingsToSave);

        this.originalSettings = settingsToSave;

        if (!pluginChanged) {
          this.showStatus("Settings saved successfully", "success");
        }
      } catch (error) {
        window.error("Failed to save settings:", error);
        this.showStatus(`Failed to save settings: ${error.message}`, "error");
      } finally {
        this.isSaving = false;
      }
    },

    cancelChanges() {
      this.settings = deepClone(this.originalSettings);
      this.activePlugin = this.originalSettings.transcriptionPlugin || "yap";
      this.pendingPluginSwitch = false;
      this.showStatus("Changes cancelled", "info");
    },

    // --- IMPORT/EXPORT/RESET ---
    async resetSection() {
      if (
        confirm(
          `Reset all settings in the "${this.currentSection.title}" section to defaults?`,
        )
      ) {
        await window.electronAPI.resetSettingsSection(this.currentSectionId);
        this.settings = await window.electronAPI.getSettings();
        ensurePluginSettingsObjects(this.settings, this.pluginData);
        this.showStatus("Section reset to defaults", "success");
      }
    },

    async resetAll() {
      if (confirm("Reset all settings to defaults? This cannot be undone.")) {
        await window.electronAPI.resetAllSettings();
        this.settings = await window.electronAPI.getSettings();
        ensurePluginSettingsObjects(this.settings, this.pluginData);
        this.showStatus("All settings reset to defaults", "success");
      }
    },

    async importSettings() {
      const result = await window.electronAPI.showOpenDialog({
        filters: [{ name: "JSON Files", extensions: ["json"] }],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        this.settings = await window.electronAPI.importSettings(
          result.filePaths[0],
        );
        this.showStatus("Settings imported successfully", "success");
      }
    },

    async exportSettings() {
      const result = await window.electronAPI.showSaveDialog({
        defaultPath: "whispermac-settings.json",
      });
      if (!result.canceled) {
        await window.electronAPI.exportSettings(result.filePath, this.settings);
        this.showStatus("Settings exported successfully", "success");
      }
    },

    async browseDirectory(key) {
      const result = await window.electronAPI.showDirectoryDialog({});
      if (!result.canceled && result.filePaths.length > 0) {
        setSettingValue(this.settings, key, result.filePaths[0]);
      }
    },

    // --- HOTKEY METHODS ---
    captureHotkeyEvent(event, key) {
      const hotkey = captureHotkey(event);
      if (hotkey) {
        setSettingValue(this.settings, key, hotkey);
      }
    },

    async clearHotkey(key) {
      // Update local state immediately
      setSettingValue(this.settings, key, "");

      // Call backend to update, save, and re-register shortcuts
      try {
        await window.electronAPI.updateHotkey(key, "");
      } catch (error) {
        window.error("Failed to clear hotkey:", error);
        this.showStatus(`Failed to clear hotkey: ${error.message}`, "error");
      }
    },

    async handleHotkeyChanged(key, value) {
      // Update local state immediately
      setSettingValue(this.settings, key, value);

      // Call backend to update with conflict detection, save, and re-register shortcuts
      try {
        const result = await window.electronAPI.updateHotkey(key, value);
        if (result.clearedConflicts && result.clearedConflicts.length > 0) {
          // Settings were updated due to conflicts - the onSettingsUpdated listener
          // will sync the local state automatically
          const clearedNames = result.clearedConflicts
            .map((k) => k.replace("hotkeys.", ""))
            .join(", ");
          this.showStatus(
            `Hotkey set. Cleared conflicting shortcut(s): ${clearedNames}`,
            "info",
          );
        }
      } catch (error) {
        window.error("Failed to update hotkey:", error);
        this.showStatus(`Failed to update hotkey: ${error.message}`, "error");
      }
    },

    // --- AI PROVIDER METHODS ---
    debouncedValidateApiKey() {
      clearTimeout(this.apiKeyValidationTimeout);
      this.apiKeyValidationTimeout = setTimeout(
        this.validateApiKeyAndModelsData,
        1000,
      );
    },

    async validateApiKeyAndModelsData() {
      if (!this.apiKeyInput || !this.settings.ai?.baseUrl) return;

      this.aiModelsState.loading = true;
      try {
        const result = await validateApiKeyAndListModels(
          this.settings.ai.baseUrl,
          this.apiKeyInput,
        );
        if (result.success && result.models?.length > 0) {
          this.aiModelsState.models = result.models;
          if (!result.models.some((m) => m.id === this.settings.ai.model)) {
            this.settings.ai.model = result.models[0].id;
          }
          await saveApiKeySecure(this.apiKeyInput);
          this.apiKeyInput = "";
          this.showStatus("API Key validated and models loaded.", "success");
        } else {
          this.aiModelsState.models = [];
          this.showStatus(
            `API Key validation failed: ${result.error}`,
            "error",
          );
        }
      } catch (e) {
        this.aiModelsState.models = [];
        this.showStatus(`Error validating API key: ${e.message}`, "error");
      } finally {
        this.aiModelsState.loading = false;
      }
    },

    // --- PLUGIN MANAGEMENT ---
    handleOptionChange(pluginName, option, newValue) {
      if (option.type === "model-select") {
        this.handlePluginModelChange(pluginName, option.key, newValue);
      } else {
        this.settings.plugin[pluginName][option.key] = newValue;
      }
    },

    async handlePluginChange() {
      const oldPlugin = this.settings.transcriptionPlugin;
      const newPlugin = this.activePlugin;

      if (newPlugin === oldPlugin) {
        return; // No change needed
      }

      // Show confirmation dialog for immediate switch attempt
      if (
        !confirm(
          `Switch to ${newPlugin} plugin?\n\nThis may download required models if they are not already present.`,
        )
      ) {
        this.activePlugin = oldPlugin; // Revert selection
        this.pendingPluginSwitch = false; // Clear any pending switch
        return;
      }

      // First, try the original immediate activation flow
      this.showProgress(`Switching to ${newPlugin}...`, 0);
      try {
        await window.electronAPI.switchPlugin(this.activePlugin);
        this.settings.transcriptionPlugin = this.activePlugin; // Update internal setting tracking
        this.showStatus(
          `Switched to ${this.activePlugin} successfully`,
          "success",
        );
        this.pendingPluginSwitch = false; // Clear any pending switch
        return; // Success - no need for fallback behavior
      } catch (switchError) {
        // Original switch failed - now fall back to test-and-configure behavior
        window.log(
          `Immediate switch failed for ${newPlugin}, falling back to configuration mode:`,
          switchError.message,
        );

        this.hideProgress();

        // Test if the plugin can be activated with current configuration
        const pluginOptions = JSON.parse(
          JSON.stringify(this.settings.plugin[newPlugin] || {}),
        );

        try {
          const testResult = await window.electronAPI.testPluginActivation(
            newPlugin,
            pluginOptions,
          );

          if (!testResult.canActivate) {
            // Plugin cannot be activated with current configuration
            if (testResult.error && testResult.error.includes("API key")) {
              // Show informative message for API key issues
              this.showStatus(
                `${newPlugin} requires configuration. Please set up the API key and click "Save Settings" to activate.`,
                "warning",
                6000,
              );
            } else {
              // Show generic configuration error
              this.showStatus(
                `${newPlugin} cannot be activated: ${testResult.error}. Please configure the plugin and click "Save Settings".`,
                "warning",
                6000,
              );
            }

            // Don't revert the selection - allow user to configure and save
            // The actual plugin switch will happen when they click "Save Settings"
            this.pendingPluginSwitch = true; // Mark that we have a pending plugin switch
            return;
          } else {
            // Plugin test passed but original switch failed for other reasons
            this.showStatus(
              `Failed to switch to ${newPlugin}: ${switchError.message}. You can still configure and try again with "Save Settings".`,
              "error",
              6000,
            );
            this.pendingPluginSwitch = true; // Mark that we have a pending plugin switch
            return;
          }
        } catch (testError) {
          window.error("Error testing plugin activation:", testError);
          this.showStatus(
            `Error with ${newPlugin}: ${testError.message}. Please check configuration and try "Save Settings".`,
            "warning",
            6000,
          );
          this.pendingPluginSwitch = true; // Mark that we have a pending plugin switch
          return;
        }
      } finally {
        this.hideProgress();
      }
    },

    async handlePluginModelChange(pluginName, optionKey, newModelName) {
      const oldModelName = this.settings.plugin[pluginName][optionKey];
      if (newModelName === oldModelName) return;

      if (
        !confirm(
          `This will switch to the '${newModelName}' model and download it if it's not available. Continue?`,
        )
      ) {
        // The UI will be out of sync temporarily, but since we haven't
        // updated `this.settings`, Vue's reactivity and the :value binding
        // will correct the <select> element on the next render.
        this.$forceUpdate();
        return;
      }

      this.showProgress(`Downloading model ${newModelName}...`, 0);

      try {
        await window.electronAPI.switchPlugin(pluginName, newModelName);
        // If successful, update our state
        this.settings.plugin[pluginName][optionKey] = newModelName;
        this.showStatus(`Switched to model ${newModelName}`, "success");
      } catch (e) {
        this.showStatus(`Failed to switch model: ${e.message}`, "error");
        // On failure, the settings data remains unchanged, so the UI will
        // correctly show the old model.
        this.$forceUpdate();
      } finally {
        setTimeout(() => this.hideProgress(), 2000);
      }
    },

    async loadPluginDataInfo() {
      this.pluginDataInfo = await window.electronAPI.getPluginDataInfo();
    },

    async refreshDataManagement() {
      try {
        this.showProgress("Refreshing data management...", 0);
        await this.loadPluginDataInfo();
        // Clear any cached plugin data items to force fresh load
        this.pluginDataItems = {};
        this.expandedDataPlugins = {};
        this.showStatus("Data management refreshed", "success");
      } catch (error) {
        window.error("Failed to refresh data management:", error);
        this.showStatus("Failed to refresh data management", "error");
      } finally {
        setTimeout(() => this.hideProgress(), 1000);
      }
    },

    async togglePluginDetails(pluginName) {
      this.expandedDataPlugins[pluginName] =
        !this.expandedDataPlugins[pluginName];
      if (
        this.expandedDataPlugins[pluginName] &&
        !this.pluginDataItems[pluginName]
      ) {
        this.pluginDataItems[pluginName] =
          await window.electronAPI.listPluginData(pluginName);
      }
    },

    async clearPluginData(pluginName) {
      if (
        confirm(
          `Are you sure you want to clear all data for ${pluginName}? This cannot be undone.`,
        )
      ) {
        try {
          await window.electronAPI.deleteAllPluginData(pluginName);
          this.showStatus(`Data for ${pluginName} cleared.`, "success");
          this.loadPluginDataInfo();
        } catch (e) {
          this.showStatus(`Failed to clear data: ${e.message}`, "error");
        }
      }
    },

    async deletePluginDataItem(pluginName, itemId, itemName) {
      if (confirm(`Delete "${itemName}" from ${pluginName}?`)) {
        try {
          await window.electronAPI.deletePluginDataItem(pluginName, itemId);
          this.showStatus(`Item deleted from ${pluginName}.`, "success");
          this.pluginDataItems[pluginName] =
            await window.electronAPI.listPluginData(pluginName);
          this.loadPluginDataInfo();
        } catch (e) {
          this.showStatus(`Failed to delete item: ${e.message}`, "error");
        }
      }
    },

    async clearAllPluginData() {
      if (
        !confirm(
          "This will delete ALL data from ALL plugins.\n\nThis includes:\n" +
            "• Downloaded models and temporary files\n" +
            "• Secure storage data (API keys, settings)\n" +
            "• All plugin-specific data\n\n" +
            "If the current plugin can't reactivate after clearing, " +
            "the system will automatically switch to an available fallback plugin.\n\n" +
            "This action cannot be undone. Continue?",
        )
      ) {
        return;
      }

      this.isClearingAll = true;
      const originalPlugin = this.activePlugin;

      try {
        this.showProgress("Clearing all plugin data...", 0);

        // Call the enhanced backend method with fallback support
        const result =
          await window.electronAPI.clearAllPluginDataWithFallback();

        if (result.success) {
          // Handle plugin change notification
          if (result.pluginChanged) {
            this.activePlugin = result.newActivePlugin;

            // Show prominent notification about plugin change
            this.showPluginChangeNotification(
              result.originalPlugin,
              result.newActivePlugin,
              result.failedPlugins,
            );
          } else {
            this.showStatus("All plugin data cleared successfully", "success");
          }

          // Refresh data display with updated info
          this.pluginDataInfo = result.updatedDataInfo || [];
          this.pluginDataItems = {};
          this.expandedDataPlugins = {};

          // Update the active plugin dropdown in UI
          this.updateActivePluginDisplay();
        } else {
          throw new Error(result.error || "Failed to clear plugin data");
        }
      } catch (error) {
        window.error("Failed to clear all plugin data:", error);
        this.showStatus(
          `Failed to clear plugin data: ${error.message}`,
          "error",
        );
      } finally {
        this.isClearingAll = false;
        this.hideProgress();
      }
    },

    // New method to show plugin change notification
    showPluginChangeNotification(originalPlugin, newPlugin, failedPlugins) {
      const failedList =
        failedPlugins && failedPlugins.length > 0
          ? ` (Failed: ${failedPlugins.join(", ")})`
          : "";

      // Show a more prominent warning-style notification
      this.showStatus(
        `Plugin switched: ${originalPlugin} → ${newPlugin}${failedList}`,
        "warning",
        8000, // Show for 8 seconds
      );

      // Also show in console for debugging
      window.warn(`Plugin fallback occurred during data clearing:`, {
        original: originalPlugin,
        new: newPlugin,
        failed: failedPlugins,
      });
    },

    // New method to update UI elements after plugin change
    updateActivePluginDisplay() {
      // Update the plugin selection dropdown
      const pluginSelect = document.querySelector(
        'select[data-setting="transcriptionPlugin"]',
      );
      if (pluginSelect) {
        pluginSelect.value = this.activePlugin;
        // Trigger change event to update any dependent UI
        pluginSelect.dispatchEvent(new Event("change"));
      }

      // Note: Other UI elements are automatically updated via Vue's reactive data binding
    },

    // Enhanced status display with longer duration for warnings
    showStatus(message, type = "success", duration = 3000) {
      this.status = { visible: true, message, type };
      setTimeout(() => {
        this.status.visible = false;
      }, duration);
    },

    formatBytes(bytes) {
      return formatBytes(bytes);
    },

    // --- ACTIONS EDITOR METHODS ---
    addNewAction() {
      addAction(this.settings);
    },

    deleteAction(index) {
      if (confirm("Delete this action?")) {
        deleteActionUtil(this.settings, index);
      }
    },

    moveAction(index, direction) {
      if (moveItem(this.settings.actions.actions, index, direction)) {
        resyncOrder(this.settings.actions.actions);
      }
    },

    toggleActionCard(actionId) {
      this.expandedActions[actionId] = !this.expandedActions[actionId];
    },

    async resetActionsToDefaults() {
      if (confirm("Reset actions to defaults?")) {
        const actionsField = this.schema
          .find((s) => s.id === "actions")
          ?.fields.find((f) => f.key === "actions");
        if (actionsField) {
          this.settings.actions = deepClone(actionsField.defaultValue);
          this.showStatus("Actions have been reset to default.", "success");
        }
      }
    },

    addNewPattern(actionIndex) {
      addPattern(this.settings.actions.actions[actionIndex]);
    },

    deletePattern(actionIndex, patternIndex) {
      deletePatternUtil(
        this.settings.actions.actions[actionIndex],
        patternIndex,
      );
    },

    addNewHandler(actionIndex) {
      addHandler(this.settings.actions.actions[actionIndex]);
    },

    deleteHandler(actionIndex, handlerIndex) {
      deleteHandlerUtil(
        this.settings.actions.actions[actionIndex],
        handlerIndex,
      );
    },

    updateHandlerType(handler) {
      updateHandlerTypeUtil(handler, handler.type);
    },

    toggleConfigSection(itemId, sectionName) {
      const key = `${itemId}_${sectionName}`;
      if (!this.configSections[key]) {
        this.configSections[key] = true;
      } else {
        this.configSections[key] = !this.configSections[key];
      }
    },

    isConfigSectionExpanded(itemId, sectionName) {
      const key = `${itemId}_${sectionName}`;
      return this.configSections[key] !== false;
    },

    editPattern(actionIndex, patternIndex) {
      if (
        this.editingPattern &&
        this.editingPattern.actionIndex === actionIndex &&
        this.editingPattern.patternIndex === patternIndex
      ) {
        this.editingPattern = null;
      } else {
        this.editingPattern = { actionIndex, patternIndex };
      }
    },

    closePatternEdit() {
      this.editingPattern = null;
    },

    isPatternEditing(actionIndex, patternIndex) {
      return (
        this.editingPattern &&
        this.editingPattern.actionIndex === actionIndex &&
        this.editingPattern.patternIndex === patternIndex
      );
    },

    getPatternTypeBadge(type) {
      return getPatternTypeBadge(type);
    },

    toggleHandler(actionIndex, handlerIndex) {
      const key = `${actionIndex}_${handlerIndex}`;
      this.expandedHandlers[key] = !this.expandedHandlers[key];
    },

    isHandlerExpanded(actionIndex, handlerIndex) {
      const key = `${actionIndex}_${handlerIndex}`;
      return this.expandedHandlers[key] || false;
    },

    getHandlerIcon(type) {
      return getHandlerIcon(type);
    },

    getHandlerTypeName(type) {
      return getHandlerTypeName(type);
    },

    getHandlerSummary(handler) {
      return getHandlerSummary(handler);
    },

    // --- RULES EDITOR METHODS ---
    addNewRule() {
      addRule(this.settings);
    },

    deleteRule(index) {
      if (confirm("Delete this rule?")) {
        deleteRuleUtil(this.settings, index);
      }
    },

    moveRule(index, direction) {
      moveRuleUtil(this.settings.rules, index, direction);
    },

    toggleRuleCard(ruleId) {
      this.expandedRules[ruleId] = !this.expandedRules[ruleId];
    },

    async resetRulesToDefaults() {
      if (confirm("Reset rules to defaults?")) {
        const rulesField = this.schema
          .find((s) => s.id === "ai")
          ?.fields.find((f) => f.key === "rules");
        if (rulesField) {
          this.settings.rules = deepClone(rulesField.defaultValue);
          this.showStatus("Rules have been reset to default.", "success");
        }
      }
    },

    addNewExample(ruleIndex) {
      addExample(this.settings.rules[ruleIndex]);
    },

    deleteExample(ruleIndex, exampleIndex) {
      deleteExampleUtil(this.settings.rules[ruleIndex], exampleIndex);
    },

    updateRuleCondition(rule, condition, checked) {
      updateRuleCondition(rule, condition, checked);
    },

    getConditionIcon(condition) {
      return getConditionIcon(condition);
    },

    getConditionLabel(condition) {
      return getConditionLabel(condition);
    },

    // --- ABOUT SECTION METHODS ---
    async importAllSettings() {
      await this.importSettings();
    },

    async exportAllSettings() {
      await this.exportSettings();
    },
  },
  mounted() {
    this.init();
  },
};
