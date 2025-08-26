document.addEventListener("DOMContentLoaded", () => {
  const app = Vue.createApp({
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
        aiModelsState: { loading: false, loadedForBaseUrl: null, models: [] },
        status: { visible: false, message: "", type: "success" },
        progress: { visible: false, message: "", percent: 0 },
        isSaving: false,
        isClearingAll: false,
        apiKeyInput: "",
        apiKeyValidationTimeout: null,
        pendingPluginSwitch: false, // Track when plugin switch is pending due to failed immediate activation
        appVersion: "1.0.0", // Will be populated from package.json
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
        return this.pluginDataInfo.filter((plugin) => plugin.dataSize > 0)
          .length;
      },
      enabledRulesCount() {
        return (this.settings.rules || []).filter((rule) => rule.enabled)
          .length;
      },
      totalRulesCount() {
        return (this.settings.rules || []).length;
      },
    },
    methods: {
      // --- INITIALIZATION ---
      async init() {
        try {
          this.schema = await window.electronAPI.getSettingsSchema();
          this.settings = await window.electronAPI.getSettings();
          this.originalSettings = JSON.parse(JSON.stringify(this.settings));
          console.log("this.settings", this.settings);
          try {
            this.pluginData = await window.electronAPI.getPluginSchemas();
            console.log("this.pluginData", this.pluginData);
          } catch (error) {
            console.error("Failed to load plugin schemas:", error);
            this.pluginData = { plugins: [], schemas: {} };
          }

          const pluginManagerActive =
            await window.electronAPI.getActivePlugin();
          this.activePlugin =
            pluginManagerActive || this.settings.transcriptionPlugin || "yap";
          console.log("this.activePlugin", this.activePlugin);
          this.ensurePluginSettingsObjects();

          // Load app version
          try {
            this.appVersion = await window.electronAPI.getAppVersion();
          } catch (error) {
            console.error("Failed to load app version:", error);
            this.appVersion = "1.0.0";
          }

          if (this.schema.length > 0) {
            this.showSection(this.schema[0].id);
          }

          this.setupIpcListeners();
        } catch (error) {
          console.error("Failed to initialize settings window:", error);
          this.showStatus("Failed to load settings", "error");
        }
      },

      setupIpcListeners() {
        window.electronAPI.onPluginSwitchProgress((progress) => {
          this.showProgress(
            progress.message || "Processing...",
            progress.percent || progress.progress || 0,
          );
        });
        // Note: Add other listeners like onPluginOptionProgress if needed
      },

      ensurePluginSettingsObjects() {
        if (!this.settings.plugin) this.settings.plugin = {};
        if (
          !this.pluginData ||
          !this.pluginData.plugins ||
          !this.pluginData.schemas
        ) {
          console.warn(
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
          console.error("Failed to auto-load AI models:", e);
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

      // --- DATA HANDLING ---
      getSettingValue(key) {
        return key
          .split(".")
          .reduce((o, i) => (o ? o[i] : undefined), this.settings);
      },

      setSettingValue(key, value) {
        const keys = key.split(".");
        let temp = this.settings;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!temp[keys[i]]) temp[keys[i]] = {};
          temp = temp[keys[i]];
        }
        temp[keys[keys.length - 1]] = value;
      },

      async saveSettings() {
        this.isSaving = true;
        try {
          // Check if plugin has changed and needs to be switched
          const currentActivePlugin = this.settings.transcriptionPlugin;
          const newActivePlugin = this.activePlugin;
          const pluginChanged = currentActivePlugin !== newActivePlugin;

          // Only attempt plugin switching in saveSettings if we're in fallback mode
          // (i.e., immediate switch failed and user is now saving configuration)
          if (pluginChanged && this.pendingPluginSwitch) {
            // Test plugin activation before saving
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

            // Perform the plugin switch
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
              this.activePlugin = currentActivePlugin; // Revert on failure
              return;
            } finally {
              this.hideProgress();
            }
            // Clear the pending switch flag after successful switch
            this.pendingPluginSwitch = false;
          } else if (pluginChanged) {
            // Plugin changed but no pending switch - this means immediate activation worked
            // Just update the settings tracking
            this.settings.transcriptionPlugin = this.activePlugin;
          }

          // Update the settings object with the active plugin
          this.settings.transcriptionPlugin = this.activePlugin;

          // Convert the reactive proxy to a plain object before sending
          const settingsToSave = JSON.parse(JSON.stringify(this.settings));

          await window.electronAPI.saveSettings(settingsToSave);

          // Update originalSettings from the plain object to ensure consistency
          this.originalSettings = settingsToSave;

          if (!pluginChanged) {
            this.showStatus("Settings saved successfully", "success");
          }
        } catch (error) {
          console.error("Failed to save settings:", error);
          this.showStatus(`Failed to save settings: ${error.message}`, "error");
        } finally {
          this.isSaving = false;
        }
      },

      cancelChanges() {
        this.settings = JSON.parse(JSON.stringify(this.originalSettings));
        this.activePlugin = this.originalSettings.transcriptionPlugin || "yap";
        this.pendingPluginSwitch = false; // Clear any pending plugin switch
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
          this.ensurePluginSettingsObjects(); // Re-ensure objects exist after reset
          this.showStatus("Section reset to defaults", "success");
        }
      },

      async resetAll() {
        if (confirm("Reset all settings to defaults? This cannot be undone.")) {
          await window.electronAPI.resetAllSettings();
          this.settings = await window.electronAPI.getSettings();
          this.ensurePluginSettingsObjects();
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
          await window.electronAPI.exportSettings(
            result.filePath,
            this.settings,
          );
          this.showStatus("Settings exported successfully", "success");
        }
      },

      async browseDirectory(key) {
        const result = await window.electronAPI.showDirectoryDialog({});
        if (!result.canceled && result.filePaths.length > 0) {
          this.setSettingValue(key, result.filePaths[0]);
        }
      },

      // --- AI PROVIDER METHODS ---
      debouncedValidateApiKey() {
        clearTimeout(this.apiKeyValidationTimeout);
        this.apiKeyValidationTimeout = setTimeout(
          this.validateApiKeyAndModels,
          1000,
        );
      },

      async validateApiKeyAndModels() {
        if (!this.apiKeyInput || !this.settings.ai || !this.settings.ai.baseUrl)
          return;

        this.aiModelsState.loading = true;
        try {
          const result = await window.electronAPI.validateApiKeyAndListModels(
            this.settings.ai.baseUrl,
            this.apiKeyInput,
          );
          if (result.success && result.models.length > 0) {
            this.aiModelsState.models = result.models;
            // If current model not in new list, select first one
            if (!result.models.some((m) => m.id === this.settings.ai.model)) {
              this.settings.ai.model = result.models[0].id;
            }
            await window.electronAPI.saveApiKeySecure(this.apiKeyInput);
            this.apiKeyInput = ""; // Clear after successful save
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
          console.log(
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
            console.error("Error testing plugin activation:", testError);
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
          console.error("Failed to refresh data management:", error);
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
              this.showStatus(
                "All plugin data cleared successfully",
                "success",
              );
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
          console.error("Failed to clear all plugin data:", error);
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
        console.warn(`Plugin fallback occurred during data clearing:`, {
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
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
      },

      // --- ACTIONS EDITOR METHODS ---
      addNewAction() {
        if (!this.settings.actions) {
          this.settings.actions = { actions: [] };
        } else if (!Array.isArray(this.settings.actions.actions)) {
          this.settings.actions.actions = [];
        }

        this.settings.actions.actions.push({
          id: "action_" + Date.now(),
          name: "New Action",
          description: "A new voice-activated action.",
          enabled: true,
          order: (this.settings.actions.actions.length || 0) + 1,
          closesTranscription: false,
          skipsTransformation: false,
          matchPatterns: [
            {
              id: "pattern_" + Date.now(),
              type: "startsWith",
              pattern: "trigger word ",
              caseSensitive: false,
            },
          ],
          handlers: [
            {
              id: "handler_" + Date.now(),
              type: "openUrl",
              config: {
                urlTemplate: "https://www.google.com/search?q={argument}",
              },
              order: 1,
            },
          ],
        });
      },

      deleteAction(index) {
        if (confirm("Delete this action?")) {
          this.settings.actions.actions.splice(index, 1);
        }
      },

      moveAction(index, direction) {
        const actions = this.settings.actions.actions;
        const newIndex = index + direction;

        if (newIndex >= 0 && newIndex < actions.length) {
          // Use array destructuring to swap elements reactively
          [actions[index], actions[newIndex]] = [
            actions[newIndex],
            actions[index],
          ];

          // Re-sync the order property
          actions.forEach((action, idx) => {
            action.order = idx + 1;
          });
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
            this.settings.actions = JSON.parse(
              JSON.stringify(actionsField.defaultValue),
            );
            this.showStatus("Actions have been reset to default.", "success");
          }
        }
      },

      addNewPattern(actionIndex) {
        if (!this.settings.actions.actions[actionIndex].matchPatterns) {
          this.settings.actions.actions[actionIndex].matchPatterns = [];
        }
        this.settings.actions.actions[actionIndex].matchPatterns.push({
          id: "pattern_" + Date.now(),
          type: "startsWith",
          pattern: "",
          caseSensitive: false,
        });
      },

      deletePattern(actionIndex, patternIndex) {
        this.settings.actions.actions[actionIndex].matchPatterns.splice(
          patternIndex,
          1,
        );
      },

      addNewHandler(actionIndex) {
        if (!this.settings.actions.actions[actionIndex].handlers) {
          this.settings.actions.actions[actionIndex].handlers = [];
        }
        this.settings.actions.actions[actionIndex].handlers.push({
          id: "handler_" + Date.now(),
          type: "replace",
          config: {},
          order:
            (this.settings.actions.actions[actionIndex].handlers.length || 0) +
            1,
        });
      },

      deleteHandler(actionIndex, handlerIndex) {
        this.settings.actions.actions[actionIndex].handlers.splice(
          handlerIndex,
          1,
        );
      },

      updateHandlerType(handler) {
        // Reset config based on new type
        handler.config = {};
      },

      // --- RULES EDITOR METHODS ---
      addNewRule() {
        if (!this.settings.rules) {
          this.settings.rules = [];
        }

        this.settings.rules.push({
          id: "rule_" + Date.now(),
          name: "New Rule",
          enabled: true,
          examples: [
            {
              from: "",
              to: "",
            },
          ],
        });
      },

      deleteRule(index) {
        if (confirm("Delete this rule?")) {
          this.settings.rules.splice(index, 1);
        }
      },

      moveRule(index, direction) {
        const rules = this.settings.rules;
        const newIndex = index + direction;

        if (newIndex >= 0 && newIndex < rules.length) {
          // Use array destructuring to swap elements reactively
          [rules[index], rules[newIndex]] = [rules[newIndex], rules[index]];
        }
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
            this.settings.rules = JSON.parse(
              JSON.stringify(rulesField.defaultValue),
            );
            this.showStatus("Rules have been reset to default.", "success");
          }
        }
      },

      addNewExample(ruleIndex) {
        if (!this.settings.rules[ruleIndex].examples) {
          this.settings.rules[ruleIndex].examples = [];
        }
        this.settings.rules[ruleIndex].examples.push({
          from: "",
          to: "",
        });
      },

      deleteExample(ruleIndex, exampleIndex) {
        this.settings.rules[ruleIndex].examples.splice(exampleIndex, 1);
      },

      updateRuleCondition(rule, condition, checked) {
        if (!rule.if) {
          rule.if = [];
        }

        if (checked && !rule.if.includes(condition)) {
          rule.if.push(condition);
        } else if (!checked && rule.if.includes(condition)) {
          rule.if = rule.if.filter((c) => c !== condition);
        }
      },

      getConditionIcon(condition) {
        const iconMap = {
          selection: "ph-selection",
          context: "ph-file-text",
          writing_style: "ph-pen-nib",
        };
        return iconMap[condition] || "ph-gear";
      },

      getConditionLabel(condition) {
        const labelMap = {
          selection: "Selection",
          context: "Document",
          writing_style: "Writing style",
        };
        return labelMap[condition] || condition;
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
  });

  app.mount("#app");
});
