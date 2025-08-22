# Incorrect actions handling, can't add new patterns:

      addNewPattern(actionIndex) {
        this.settings.actions[actionIndex].patterns.push({
          type: "contains",
          value: "",
        });
      },

      deletePattern(actionIndex, patternIndex) {
        this.settings.actions[actionIndex].patterns.splice(patternIndex, 1);
      },

actions[idx].patterns is undefined

# Can't add new action:

      addNewAction() {
        if (!this.settings.actions) this.settings.actions = [];
        this.settings.actions.push({
          id: "action_" + Date.now(),
          name: "New Action",
          patterns: [],
          handlers: [],
        });
      },

-> this.settings.actions is undefined

# getPluginDataItems is undefined:

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

-> Throws for clicking "View details" in the data management section

# Can't save settings:

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

-> Throws because this.settings can't be cloned.

# Other things:

- Validate and get models on switch to the AI transformatino tab so that the dropdown contains correct info. Don't overwrite the currently selected model until this loading is complete. Instead of displaying placeholder models like GPT3.5 or GPT4 display "Loading..."
- When switching to a model in plugin options, ensure that model is available, in the old settings UI this triggered a model download + progress display. Same with switching to a new plugin, the switching
- If there's no size for a dropdown don't display empty parentheses.
- The move up / down buttons don't work in actions
