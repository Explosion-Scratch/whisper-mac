document.addEventListener("DOMContentLoaded", () => {
  const app = Vue.createApp({
    data() {
      return {
        schema: [],
        settings: {},
        originalSettings: {},
        currentSectionId: null,
        validationErrors: {},
        pluginData: { plugins: [], options: {} },
        activePlugin: null,
        pluginDataInfo: [],
        pluginDataItems: {},
        expandedActions: {},
        expandedDataPlugins: {},
        aiModelsState: { loading: false, loadedForBaseUrl: null, models: [] },
        status: { visible: false, message: "", type: "success" },
        progress: { visible: false, message: "", percent: 0 },
        isSaving: false,
        apiKeyInput: "",
        apiKeyValidationTimeout: null,
      };
    },
    computed: {
      currentSection() {
        return this.schema.find((s) => s.id === this.currentSectionId) || null;
      },
    },
    methods: {
      // --- INITIALIZATION ---
      async init() {
        try {
          this.schema = await window.electronAPI.getSettingsSchema();
          this.settings = await window.electronAPI.getSettings();
          this.originalSettings = JSON.parse(JSON.stringify(this.settings));

          this.pluginData = await window.electronAPI.getPluginOptions();
          const pluginManagerActive =
            await window.electronAPI.getActivePlugin();
          this.activePlugin =
            pluginManagerActive || this.settings.transcriptionPlugin || "yap";

          this.ensurePluginSettingsObjects();

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
        for (const plugin of this.pluginData.plugins) {
          if (!this.settings.plugin[plugin.name]) {
            this.settings.plugin[plugin.name] = {};
          }
          // Ensure all options from schema have a default value if not present
          const options = this.pluginData.options[plugin.name] || [];
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
        };
        return iconMap[field.key] || iconMap[field.type] || "ph-gear";
      },

      showStatus(message, type = "success") {
        this.status = { visible: true, message, type };
        setTimeout(() => {
          this.status.visible = false;
        }, 3000);
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
          // No need to validate/save API key here, it's done interactively
          this.settings.transcriptionPlugin = this.activePlugin;
          await window.electronAPI.saveSettings(this.settings);
          this.originalSettings = JSON.parse(JSON.stringify(this.settings));
          this.showStatus("Settings saved successfully", "success");
        } catch (error) {
          console.error("Failed to save settings:", error);
          this.showStatus(`Failed to save settings: ${error.message}`, "error");
        } finally {
          this.isSaving = false;
        }
      },

      cancelChanges() {
        this.settings = JSON.parse(JSON.stringify(this.originalSettings));
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
      async handlePluginChange() {
        const oldPlugin = this.settings.transcriptionPlugin;
        this.showProgress(`Switching to ${this.activePlugin}...`, 0);
        try {
          await window.electronAPI.switchPlugin(this.activePlugin);
          this.settings.transcriptionPlugin = this.activePlugin; // Update internal setting tracking
          this.showStatus(
            `Switched to ${this.activePlugin} successfully`,
            "success",
          );
        } catch (e) {
          this.showStatus(`Failed to switch plugin: ${e.message}`, "error");
          this.activePlugin = oldPlugin; // Revert on failure
        } finally {
          setTimeout(() => this.hideProgress(), 2000);
        }
      },

      async loadPluginDataInfo() {
        this.pluginDataInfo = await window.electronAPI.getPluginDataInfo();
      },

      async togglePluginDetails(pluginName) {
        this.expandedDataPlugins[pluginName] =
          !this.expandedDataPlugins[pluginName];
        if (
          this.expandedDataPlugins[pluginName] &&
          !this.pluginDataItems[pluginName]
        ) {
          this.pluginDataItems[pluginName] =
            await window.electronAPI.getPluginDataItems(pluginName);
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
              await window.electronAPI.getPluginDataItems(pluginName);
            this.loadPluginDataInfo();
          } catch (e) {
            this.showStatus(`Failed to delete item: ${e.message}`, "error");
          }
        }
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
        if (!this.settings.actions) this.settings.actions = [];
        this.settings.actions.push({
          id: "action_" + Date.now(),
          name: "New Action",
          patterns: [],
          handlers: [],
        });
      },

      deleteAction(index) {
        if (confirm("Delete this action?")) {
          this.settings.actions.splice(index, 1);
        }
      },

      moveAction(index, direction) {
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < this.settings.actions.length) {
          const temp = this.settings.actions[index];
          this.settings.actions[index] = this.settings.actions[newIndex];
          this.settings.actions[newIndex] = temp;
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
        this.settings.actions[actionIndex].patterns.push({
          type: "contains",
          value: "",
        });
      },

      deletePattern(actionIndex, patternIndex) {
        this.settings.actions[actionIndex].patterns.splice(patternIndex, 1);
      },

      addNewHandler(actionIndex) {
        this.settings.actions[actionIndex].handlers.push({
          type: "replace",
          value: "",
        });
      },

      deleteHandler(actionIndex, handlerIndex) {
        this.settings.actions[actionIndex].handlers.splice(handlerIndex, 1);
      },

      updateHandlerType(handler) {
        handler.value = ""; // Reset value when type changes
      },
    },
    mounted() {
      this.init();
    },
  });

  app.mount("#app");
});
