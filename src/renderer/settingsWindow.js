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
        aiModelsState: { loading: false, loadedForBaseUrl: null, models: [] },
        status: { visible: false, message: "", type: "success" },
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
      async init() {
        try {
          this.schema = await window.electronAPI.getSettingsSchema();
          this.settings = await window.electronAPI.getSettings();
          this.originalSettings = JSON.parse(JSON.stringify(this.settings));

          this.pluginData = await window.electronAPI.getPluginOptions();
          const pluginManagerActive = await window.electronAPI.getActivePlugin();
          this.activePlugin = pluginManagerActive || this.settings.transcriptionPlugin || "yap";

          if (this.schema.length > 0) {
            this.showSection(this.schema[0].id);
          }
        } catch (error) {
          console.error("Failed to initialize settings window:", error);
          this.showStatus("Failed to load settings", "error");
        }
      },

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
          transcription: "ph-microphone",
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
        };
        return iconMap[field.key] || iconMap[field.type] || "ph-gear";
      },

      getSettingValue(key) {
        return key.split('.').reduce((o, i) => o ? o[i] : undefined, this.settings);
      },

      setSettingValue(key, value) {
        const keys = key.split(".");
        let temp = this.settings;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!temp[keys[i]]) this.$set(temp, keys[i], {});
          temp = temp[keys[i]];
        }
        this.$set(temp, keys[keys.length - 1], value);
      },

      async saveSettings() {
        this.isSaving = true;
        try {
          if (this.settings.ai && this.settings.ai.enabled && this.apiKeyInput) {
             const result = await window.electronAPI.validateApiKeyAndListModels(this.settings.ai.baseUrl, this.apiKeyInput);
             if(!result.success) {
                 this.showStatus(`API Key validation failed: ${result.error}`, 'error');
                 this.isSaving = false;
                 return;
             }
             await window.electronAPI.saveApiKeySecure(this.apiKeyInput);
             this.apiKeyInput = '';
          }
          this.settings.transcriptionPlugin = this.activePlugin;
          await window.electronAPI.saveSettings(this.settings);
          this.originalSettings = JSON.parse(JSON.stringify(this.settings));
          this.showStatus("Settings saved successfully", "success");
        } catch (error) {
          console.error("Failed to save settings:", error);
          this.showStatus("Failed to save settings", "error");
        } finally {
          this.isSaving = false;
        }
      },

      cancelChanges() {
        this.settings = JSON.parse(JSON.stringify(this.originalSettings));
        this.showStatus("Changes cancelled", "info");
      },

      async resetSection() {
        if (confirm(`Reset all settings in the "${this.currentSection.title}" section to defaults?`)) {
          await window.electronAPI.resetSettingsSection(this.currentSectionId);
          this.settings = await window.electronAPI.getSettings();
          this.showStatus("Section reset to defaults", "success");
        }
      },

      async resetAll() {
        if (confirm("Reset all settings to defaults? This cannot be undone.")) {
          await window.electronAPI.resetAllSettings();
          this.settings = await window.electronAPI.getSettings();
          this.showStatus("All settings reset to defaults", "success");
        }
      },

      async importSettings() {
          const result = await window.electronAPI.showOpenDialog({ filters: [{ name: "JSON Files", extensions: ["json"] }]});
          if (!result.canceled && result.filePaths.length > 0) {
              this.settings = await window.electronAPI.importSettings(result.filePaths[0]);
              this.showStatus("Settings imported successfully", "success");
          }
      },

      async exportSettings() {
          const result = await window.electronAPI.showSaveDialog({ defaultPath: "whispermac-settings.json" });
          if (!result.canceled) {
              await window.electronAPI.exportSettings(result.filePath, this.settings);
              this.showStatus("Settings exported successfully", "success");
          }
      },

      async browseDirectory(key) {
        const result = await window.electronAPI.showDirectoryDialog({});
        if (!result.canceled && result.filePaths.length > 0) {
            this.setSettingValue(key, result.filePaths[0]);
        }
      },
      
      debouncedValidateApiKey() {
        clearTimeout(this.apiKeyValidationTimeout);
        this.apiKeyValidationTimeout = setTimeout(async () => {
            if (this.apiKeyInput && this.settings.ai && this.settings.ai.baseUrl) {
                // This is where you might show a loading spinner next to the key
            }
        }, 1000);
      },

      async handlePluginChange() {
        // In a real scenario, you'd show progress indicators here
        this.showStatus(`Switching to ${this.activePlugin}...`, 'info');
        try {
            const modelOption = this.pluginData.options[this.activePlugin]?.find(o => o.type === 'model-select');
            const modelName = modelOption ? this.getSettingValue(`plugin.${this.activePlugin}.${modelOption.key}`) : undefined;
            
            await window.electronAPI.switchPlugin(this.activePlugin, modelName);
            this.showStatus(`Switched to ${this.activePlugin} successfully`, 'success');
        } catch(e) {
            this.showStatus(`Failed to switch plugin: ${e.message}`, 'error');
            // Revert activePlugin if switch fails
            this.activePlugin = this.settings.transcriptionPlugin;
        }
      },
      
      async loadPluginDataInfo() {
          this.pluginDataInfo = await window.electronAPI.getPluginDataInfo();
      },

      async clearPluginData(pluginName) {
        if (confirm(`Are you sure you want to clear all data for ${pluginName}? This cannot be undone.`)) {
            try {
                await window.electronAPI.deleteAllPluginData(pluginName);
                this.showStatus(`Data for ${pluginName} cleared.`, 'success');
                this.loadPluginDataInfo();
            } catch (e) {
                this.showStatus(`Failed to clear data: ${e.message}`, 'error');
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

      showStatus(message, type = "success") {
        this.status = { visible: true, message, type };
        setTimeout(() => {
          this.status.visible = false;
        }, 3000);
      },
    },
    mounted() {
      this.init();
    },
  });

  app.mount("#app");
});
