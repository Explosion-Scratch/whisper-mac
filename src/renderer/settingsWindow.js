class SettingsWindow {
  constructor() {
    this.schema = null;
    this.settings = {};
    this.originalSettings = {};
    this.currentSectionId = null;
    this.validationErrors = {};
    this.pluginData = { plugins: [], options: {} };
    this.activePlugin = null;
    this.aiModelsState = { loading: false, loadedForBaseUrl: null };

    this.init();
  }

  async init() {
    try {
      // Get settings schema and current settings from main process
      this.schema = await window.electronAPI.getSettingsSchema();
      this.settings = await window.electronAPI.getSettings();
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));

      // Load plugin information using unified API
      this.pluginData = await window.electronAPI.getPluginOptions();
      this.activePlugin = await window.electronAPI.getActivePlugin();

      this.buildNavigation();
      this.buildSettingsForm();
      this.bindEvents();

      // Show first section by default
      if (this.schema.length > 0) {
        this.showSection(this.schema[0].id);
      }
    } catch (error) {
      console.error("Failed to initialize settings window:", error);
      this.showStatus("Failed to load settings", "error");
    }
  }

  buildNavigation() {
    const nav = document.getElementById("sectionNav");
    nav.innerHTML = "";

    // Enhanced icon mapping with better semantic icons
    const iconMap = {
      settings: "ph-gear-six",
      window: "ph-app-window",
      "document-text": "ph-text-aa",
      flash: "ph-lightning",
      cog: "ph-gear",
      slider: "ph-sliders-horizontal",
      // Additional semantic mappings
      general: "ph-gear-six",
      appearance: "ph-palette",
      audio: "ph-speaker-high",
      ai: "ph-robot",
      advanced: "ph-sliders-horizontal",
      server: "ph-globe",
      dictation: "ph-microphone",
      transformation: "ph-arrows-clockwise",
      storage: "ph-hard-drive",
      performance: "ph-gauge",
      security: "ph-shield-check",
      network: "ph-wifi",
      files: "ph-folder",
      text: "ph-text-aa",
      model: "ph-brain",
      api: "ph-link",
      prompt: "ph-chat-text",
      data: "ph-database",
      port: "ph-globe",
      position: "ph-app-window",
      size: "ph-resize",
      opacity: "ph-eye",
      trim: "ph-scissors",
      enabled: "ph-toggle-left",
      url: "ph-link",
      key: "ph-key",
      tokens: "ph-coins",
      temperature: "ph-thermometer",
      topP: "ph-target",
      message: "ph-envelope",
      directory: "ph-folder",
      // AI Enhancement specific
      "ai-enhancement": "ph-robot",
      "ai-enhancement-settings": "ph-robot",
      "ai-settings": "ph-robot",
      enhancement: "ph-robot",
      // Advanced specific
      "advanced-settings": "ph-wrench",
      "advanced-options": "ph-wrench",
      system: "ph-gear-six",
      preferences: "ph-gear-six",
      configuration: "ph-gear-six",
    };

    this.schema.forEach((section, index) => {
      const navItem = document.createElement("a");
      navItem.className = "nav-group-item";
      navItem.dataset.sectionId = section.id;
      const iconClass =
        iconMap[section.icon] || iconMap[section.id] || "ph-gear";
      navItem.innerHTML = `
        <i class="icon ph-duotone ${iconClass}"></i>
        ${section.title}
      `;

      navItem.addEventListener("click", () => {
        this.showSection(section.id);
      });
      nav.appendChild(navItem);
    });
  }

  buildSettingsForm() {
    const form = document.getElementById("settingsForm");
    form.innerHTML = "";

    // Enhanced icon mapping for fields - using the same mapping as navigation
    const iconMap = {
      // Field type icons
      text: "ph-text-aa",
      number: "ph-hash",
      boolean: "ph-toggle-left",
      select: "ph-list",
      textarea: "ph-text-align-left",
      slider: "ph-slider-horizontal",
      directory: "ph-folder",
      // Specific field icons with better semantic mapping
      dictationWindowPosition: "ph-app-window",
      dictationWindowWidth: "ph-resize-horizontal",
      dictationWindowHeight: "ph-resize-vertical",
      dictationWindowOpacity: "ph-eye",
      showDictationWindowAlways: "ph-eye",
      transformTrim: "ph-scissors",
      "ai.enabled": "ph-robot",
      "ai.baseUrl": "ph-link",
      "ai.model": "ph-brain",
      "ai.maxTokens": "ph-coins",
      "ai.temperature": "ph-thermometer",
      "ai.topP": "ph-target",
      "ai.writingStyle": "ph-pen-nib",
      "ai.prompt": "ph-chat-text",
      "ai.messagePrompt": "ph-envelope",
      dataDir: "ph-folder",
      // Additional semantic mappings
      port: "ph-globe",
      model: "ph-brain",
      url: "ph-link",
      key: "ph-key",
      tokens: "ph-coins",
      temperature: "ph-thermometer",
      topP: "ph-target",
      prompt: "ph-chat-text",
      message: "ph-envelope",
      enabled: "ph-toggle-left",
      position: "ph-app-window",
      width: "ph-resize-horizontal",
      height: "ph-resize-vertical",
      opacity: "ph-eye",
      trim: "ph-scissors",
      directory: "ph-folder",
      folder: "ph-folder",
      file: "ph-file",
      // Section icons - same as navigation
      settings: "ph-gear-six",
      window: "ph-app-window",
      "document-text": "ph-text-aa",
      flash: "ph-lightning",
      cog: "ph-gear",
      slider: "ph-sliders-horizontal",
      general: "ph-gear-six",
      appearance: "ph-palette",
      audio: "ph-speaker-high",
      ai: "ph-robot",
      advanced: "ph-sliders-horizontal",
      server: "ph-globe",
      dictation: "ph-microphone",
      transformation: "ph-arrows-clockwise",
      storage: "ph-hard-drive",
      performance: "ph-gauge",
      security: "ph-shield-check",
      network: "ph-wifi",
      files: "ph-folder",
      text: "ph-text-aa",
      model: "ph-brain",
      api: "ph-link",
      prompt: "ph-chat-text",
      data: "ph-database",
      port: "ph-globe",
      position: "ph-app-window",
      size: "ph-resize",
      opacity: "ph-eye",
      trim: "ph-scissors",
      enabled: "ph-toggle-left",
      url: "ph-link",
      key: "ph-key",
      tokens: "ph-coins",
      temperature: "ph-thermometer",
      topP: "ph-target",
      message: "ph-envelope",
      directory: "ph-folder",
      // AI Enhancement specific
      "ai-enhancement": "ph-robot",
      "ai-enhancement-settings": "ph-robot",
      "ai-settings": "ph-robot",
      enhancement: "ph-robot",
      // Advanced specific
      "advanced-settings": "ph-wrench",
      "advanced-options": "ph-wrench",
      system: "ph-gear-six",
      preferences: "ph-gear-six",
      configuration: "ph-gear-six",
    };

    this.schema.forEach((section, sectionIndex) => {
      const sectionDiv = document.createElement("div");
      sectionDiv.className = "settings-section hidden";
      sectionDiv.id = `section-${section.id}`;

      const iconClass =
        iconMap[section.icon] || iconMap[section.id] || "ph-gear";

      sectionDiv.innerHTML = `
        <div class="section-header">
          <i class="ph-duotone ${iconClass}"></i>
          <div>
            <h2 class="section-title">${section.title}</h2>
            ${
              section.description
                ? `<p class="section-description">${section.description}</p>`
                : ""
            }
          </div>
        </div>
        <div class="section-fields">
          ${section.fields
            .map((field, fieldIndex) => this.buildField(field, fieldIndex))
            .join("")}
          ${section.id === "transcription" ? this.buildPluginSection() : ""}
          ${section.id === "data" ? this.buildDataSection() : ""}
        </div>
      `;

      form.appendChild(sectionDiv);
    });

    // Bind field events after DOM is created
    this.bindFieldEvents();

    // Initialize actions editors
    this.initializeActionsEditors();
  }

  buildField(field, fieldIndex) {
    const value = this.getSettingValue(field.key);
    const fieldId = `field-${field.key.replace(/\./g, "-")}`;

    // Enhanced icon mapping for fields
    const getFieldIcon = (field) => {
      const iconMap = {
        // Field type icons
        text: "ph-text-aa",
        number: "ph-hash",
        boolean: "ph-toggle-left",
        select: "ph-list",
        textarea: "ph-text-align-left",
        slider: "ph-slider-horizontal",
        directory: "ph-folder",
        // Specific field icons
        dictationWindowPosition: "ph-app-window",
        dictationWindowWidth: "ph-resize-horizontal",
        dictationWindowHeight: "ph-resize-vertical",
        dictationWindowOpacity: "ph-eye",
        showDictationWindowAlways: "ph-eye",
        transformTrim: "ph-scissors",
        "ai.enabled": "ph-robot",
        "ai.baseUrl": "ph-link",
        "ai.model": "ph-brain",
        "ai.maxTokens": "ph-coins",
        "ai.temperature": "ph-thermometer",
        "ai.topP": "ph-target",
        "ai.writingStyle": "ph-pen-nib",
        "ai.prompt": "ph-chat-text",
        "ai.messagePrompt": "ph-envelope",
        dataDir: "ph-folder",
        // Additional semantic mappings
        port: "ph-globe",
        model: "ph-brain",
        url: "ph-link",
        key: "ph-key",
        tokens: "ph-coins",
        temperature: "ph-thermometer",
        topP: "ph-target",
        prompt: "ph-chat-text",
        message: "ph-envelope",
        enabled: "ph-toggle-left",
        position: "ph-app-window",
        width: "ph-resize-horizontal",
        height: "ph-resize-vertical",
        opacity: "ph-eye",
        trim: "ph-scissors",
        directory: "ph-folder",
        folder: "ph-folder",
        file: "ph-file",
      };

      // Try to match by key first, then by type
      return iconMap[field.key] || iconMap[field.type] || "ph-gear";
    };

    const iconClass = getFieldIcon(field);
    let fieldHtml = "";

    switch (field.type) {
      case "text":
        // Special-case inline API key input to enable validation before saving
        if (field.key === "ai.baseUrl") {
          // Add a sibling inline API key field to be read during save
          fieldHtml = `
            <input type="text" 
                   class="form-control" 
                   id="${fieldId}"
                   value="${this.escapeHtml(value || "")}"
                   placeholder="${field.placeholder || ""}"
                   data-key="${field.key}">
            <div class="form-group" style="margin-top:8px;">
              <label for="aiApiKeyInline">
                <i class="ph-duotone ph-key" style="margin-right: 6px; font-size: 14px;"></i>
                API Key (not stored in settings; saved securely after validation)
              </label>
              <input type="password" class="form-control" id="aiApiKeyInline" placeholder="Paste API Key to validate & save securely">
            </div>
          `;
          break;
        }
        fieldHtml = `
          <input type="text" 
                 class="form-control" 
                 id="${fieldId}"
                 value="${this.escapeHtml(value || "")}"
                 placeholder="${field.placeholder || ""}"
                 data-key="${field.key}">
        `;
        break;

      case "number":
        fieldHtml = `
          <input type="number" 
                 class="form-control" 
                 id="${fieldId}"
                 value="${value || field.defaultValue}"
                 min="${field.min || ""}"
                 max="${field.max || ""}"
                 step="${field.step || "1"}"
                 data-key="${field.key}">
        `;
        break;

      case "boolean":
        fieldHtml = `
          <div class="checkbox-container">
            <input type="checkbox" 
                   class="checkbox" 
                   id="${fieldId}"
                   ${value ? "checked" : ""}
                   data-key="${field.key}">
            <label for="${fieldId}">
              <i class="ph-duotone ${iconClass}" style="margin-right: 6px; font-size: 14px;"></i>
              ${field.label}
            </label>
          </div>
        `;
        break;

      case "select":
        const options = field.options
          .map(
            (opt) =>
              `<option value="${this.escapeHtml(opt.value)}" ${
                value === opt.value ? "selected" : ""
              }>${this.escapeHtml(opt.label)}</option>`
          )
          .join("");
        fieldHtml = `
          <select class="form-control" id="${fieldId}" data-key="${field.key}">
            ${options}
          </select>
        `;
        break;

      case "textarea":
        fieldHtml = `
          <textarea class="form-control" 
                    id="${fieldId}"
                    rows="6"
                    placeholder="${field.placeholder || ""}"
                    data-key="${field.key}">${this.escapeHtml(
          value || ""
        )}</textarea>
        `;
        break;

      case "slider":
        fieldHtml = `
          <div class="slider-container">
            <input type="range" 
                   class="slider" 
                   id="${fieldId}"
                   min="${field.min || 0}"
                   max="${field.max || 100}"
                   step="${field.step || 1}"
                   value="${value || field.defaultValue}"
                   data-key="${field.key}">
            <span class="slider-value" id="${fieldId}-value">${
          value || field.defaultValue
        }</span>
          </div>
        `;
        break;

      case "directory":
        fieldHtml = `
          <div class="directory-container">
            <input type="text" 
                   class="form-control directory-input" 
                   id="${fieldId}"
                   value="${this.escapeHtml(value || "")}"
                   placeholder="${field.placeholder || ""}"
                   data-key="${field.key}"
                   readonly>
            <button type="button" 
                    class="btn btn-default directory-browse-btn" 
                    data-key="${field.key}"
                    title="Browse for directory">
              <i class="ph-duotone ph-folder-open"></i>
              Browse
            </button>
          </div>
        `;
        break;

      case "actions-editor":
        fieldHtml = `
          <div class="actions-editor-container" id="${fieldId}">
            <div class="actions-editor-toolbar">
              <button type="button" class="btn btn-primary btn-sm add-action-btn">
                <i class="ph-duotone ph-plus"></i>
                Add Action
              </button>
              <button type="button" class="btn btn-default btn-sm reset-actions-btn">
                <i class="ph-duotone ph-arrow-clockwise"></i>
                Reset to Defaults
              </button>
            </div>
            <div class="actions-list" data-key="${field.key}">
              <!-- Actions will be rendered here -->
            </div>
          </div>
        `;
        break;
    }

    // For boolean fields, don't show the label again since it's in the checkbox container
    const showLabel = field.type !== "boolean";

    return `
      <div class="form-group" data-field="${field.key}">
        ${
          showLabel
            ? `<label for="${fieldId}">
                 <i class="ph-duotone ${iconClass}" style="margin-right: 6px; font-size: 14px;"></i>
                 ${field.label}
               </label>`
            : ""
        }
        ${
          field.description
            ? `<div class="field-description">${field.description}</div>`
            : ""
        }
        ${fieldHtml}
        <div class="validation-error" id="${fieldId}-error"></div>
      </div>
    `;
  }

  buildPluginSection() {
    if (!this.pluginData || !this.pluginData.plugins) {
      return "";
    }

    let html = `<div class="plugin-options-section">`;

    // Plugin selector
    html += `
      <div class="form-group">
        <label>
          <i class="ph-duotone ph-gear" style="margin-right: 6px; font-size: 14px;"></i>
          Active Plugin
        </label>
        <select class="form-control" data-plugin-selector>
          ${this.pluginData.plugins
            .map(
              (plugin) =>
                `<option value="${plugin.name}" ${
                  this.activePlugin === plugin.name ? "selected" : ""
                }>${plugin.displayName}</option>`
            )
            .join("")}
        </select>
      </div>
    `;

    // Plugin-specific options for each plugin
    for (const plugin of this.pluginData.plugins) {
      const isActive = this.activePlugin === plugin.name;
      const pluginOptions = this.pluginData.options[plugin.name] || [];

      html += `
        <div class="plugin-config-section" data-plugin="${plugin.name}" ${
        !isActive ? 'style="display: none;"' : ""
      }>
          <div class="plugin-header">
            <div class="plugin-info">
              <h4>${plugin.displayName}</h4>
              <p class="plugin-description">${plugin.description}</p>
            </div>
            ${
              !isActive
                ? `<button type="button" class="btn btn-danger plugin-delete-btn" data-plugin="${plugin.name}" title="Clear plugin data">
                     <i class="ph-duotone ph-trash"></i>
                   </button>`
                : ""
            }
          </div>
      `;

      // Plugin options
      for (const option of pluginOptions) {
        const fieldKey = `plugin.${plugin.name}.${option.key}`;
        const value = this.getSettingValue(fieldKey) || option.default;

        html += `<div class="form-group plugin-option">`;

        if (option.type === "model-select") {
          html += `
            <label>
              <i class="ph-duotone ph-brain" style="margin-right: 6px; font-size: 14px;"></i>
              ${option.label}
            </label>
            <select class="form-control" data-key="${fieldKey}">
              ${option.options
                .map(
                  (opt) =>
                    `<option value="${opt.value}" ${
                      value === opt.value ? "selected" : ""
                    }>${opt.label} ${opt.size ? `(${opt.size})` : ""}</option>`
                )
                .join("")}
            </select>
          `;
        } else if (option.type === "select") {
          html += `
            <label>
              <i class="ph-duotone ph-list" style="margin-right: 6px; font-size: 14px;"></i>
              ${option.label}
            </label>
            <select class="form-control" data-key="${fieldKey}">
              ${option.options
                .map(
                  (opt) =>
                    `<option value="${opt.value}" ${
                      value === opt.value ? "selected" : ""
                    }>${opt.label}</option>`
                )
                .join("")}
            </select>
          `;
        } else if (option.type === "boolean") {
          html += `
            <div class="checkbox-container">
              <input type="checkbox" class="checkbox" data-key="${fieldKey}" ${
            value ? "checked" : ""
          }>
              <label>
                <i class="ph-duotone ph-toggle-left" style="margin-right: 6px; font-size: 14px;"></i>
                ${option.label}
              </label>
            </div>
          `;
        } else if (option.type === "number") {
          html += `
            <label>
              <i class="ph-duotone ph-hash" style="margin-right: 6px; font-size: 14px;"></i>
              ${option.label}
            </label>
            <input type="number" class="form-control" data-key="${fieldKey}" 
                   value="${value}" min="${option.min || ""}" max="${
            option.max || ""
          }">
          `;
        } else {
          html += `
            <label>
              <i class="ph-duotone ph-text-aa" style="margin-right: 6px; font-size: 14px;"></i>
              ${option.label}
            </label>
            <input type="text" class="form-control" data-key="${fieldKey}" value="${value}">
          `;
        }

        if (option.description) {
          html += `<div class="field-description">${option.description}</div>`;
        }

        html += `<div class="validation-error"></div></div>`;
      }

      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  buildDataSection() {
    return `
      <div class="data-management-section">
        <div class="plugin-data-list" id="pluginDataList">
          <div class="loading-indicator">
            <i class="ph-duotone ph-circle-notch" style="animation: spin 1s linear infinite; margin-right: 8px;"></i>
            Loading plugin data information...
          </div>
        </div>
      </div>
    `;
  }

  bindFieldEvents() {
    // Handle all input changes with enhanced feedback
    document.querySelectorAll("[data-key]").forEach((element) => {
      const key = element.dataset.key;

      if (element.type === "range") {
        // Update slider value display
        const valueDisplay = document.getElementById(`${element.id}-value`);
        element.addEventListener("input", () => {
          valueDisplay.textContent = element.value;
          this.setSettingValue(key, parseFloat(element.value));
          this.validateField(key);
        });
      } else if (element.type === "checkbox") {
        element.addEventListener("change", () => {
          this.setSettingValue(key, element.checked);
          this.validateField(key);
        });
      } else if (element.type === "number") {
        element.addEventListener("input", () => {
          const value = element.value === "" ? null : parseFloat(element.value);
          this.setSettingValue(key, value);
          this.validateField(key);
        });
      } else {
        element.addEventListener("input", async () => {
          const oldValue = this.getSettingValue(key);
          this.setSettingValue(key, element.value);
          this.validateField(key);

          // Handle plugin-specific option changes using unified API
          if (key.startsWith("plugin.")) {
            await this.handlePluginOptionChange(key, element.value, oldValue);
          }

          // Handle AI base URL changes to reload models
          if (key === "ai.baseUrl") {
            this.aiModelsState.loadedForBaseUrl = null;
            this.maybeLoadAiModels(true);
          }
        });
      }

      // Simple focus effect
      element.addEventListener("focus", () => {
        const formGroup = element.closest(".form-group");
        if (formGroup) {
          formGroup.style.borderColor = "var(--color-border-focus)";
        }
      });

      element.addEventListener("blur", () => {
        const formGroup = element.closest(".form-group");
        if (formGroup) {
          formGroup.style.borderColor = "";
        }
      });
    });

    // Handle directory browse buttons
    document.querySelectorAll(".directory-browse-btn").forEach((button) => {
      const key = button.dataset.key;
      button.addEventListener("click", () => {
        this.browseDirectory(key);
      });
    });

    // Handle plugin delete buttons
    document.querySelectorAll(".plugin-delete-btn").forEach((button) => {
      const pluginName = button.dataset.plugin;
      button.addEventListener("click", () => {
        this.deleteInactivePlugin(pluginName);
      });
    });

    // Handle plugin selector changes
    document.querySelectorAll("[data-plugin-selector]").forEach((selector) => {
      selector.addEventListener("change", async (event) => {
        const newPlugin = event.target.value;
        const oldPlugin = this.activePlugin;

        if (newPlugin !== oldPlugin) {
          await this.handlePluginChange(newPlugin, oldPlugin);
        }
      });
    });

    // Handle API key input for model loading
    const apiKeyInput = document.getElementById("aiApiKeyInline");
    if (apiKeyInput) {
      let debounceTimer;
      apiKeyInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const apiKey = apiKeyInput.value.trim();
          const baseUrl = this.getSettingValue("ai.baseUrl");

          if (apiKey && baseUrl) {
            try {
              const result =
                await window.electronAPI.validateApiKeyAndListModels(
                  baseUrl,
                  apiKey
                );

              if (result?.success && result.models?.length > 0) {
                this.replaceModelFieldWithDropdown(result.models);
                // Save the API key securely
                try {
                  await window.electronAPI.saveApiKeySecure(apiKey);
                  apiKeyInput.value = ""; // Clear the input after saving
                  this.showStatus(
                    "API key validated and models loaded",
                    "success"
                  );
                } catch (error) {
                  console.error("Failed to save API key:", error);
                }
              } else {
                this.showStatus(
                  `Failed to load models: ${result?.error || "Unknown error"}`,
                  "error"
                );
              }
            } catch (error) {
              console.error("Failed to validate API key:", error);
              this.showStatus("Failed to validate API key", "error");
            }
          }
        }, 1000); // Debounce for 1 second
      });
    }
  }

  bindEvents() {
    // Save button
    document.getElementById("saveBtn").addEventListener("click", () => {
      this.saveSettings();
    });

    // Cancel button
    document.getElementById("cancelBtn").addEventListener("click", () => {
      this.cancelChanges();
    });

    // Reset section button
    document.getElementById("resetSectionBtn").addEventListener("click", () => {
      this.resetSection();
    });

    // Reset all button
    document.getElementById("resetAllBtn").addEventListener("click", () => {
      this.resetAll();
    });

    // Import button
    document.getElementById("importBtn").addEventListener("click", () => {
      this.importSettings();
    });

    // Export button
    document.getElementById("exportBtn").addEventListener("click", () => {
      this.exportSettings();
    });

    // Close window on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeWindow();
      }
    });
  }

  showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll(".settings-section").forEach((section) => {
      section.classList.add("hidden");
    });

    // Show selected section
    const section = document.getElementById(`section-${sectionId}`);
    if (section) {
      section.classList.remove("hidden");
    }

    // Update navigation
    document.querySelectorAll(".nav-group-item").forEach((item) => {
      item.classList.remove("active");
    });

    const navItem = document.querySelector(`[data-section-id="${sectionId}"]`);
    if (navItem) {
      navItem.classList.add("active");
    }

    this.currentSectionId = sectionId;

    // Load data for specific sections
    if (sectionId === "data") {
      this.loadPluginDataInfo();
    } else if (sectionId === "ai") {
      this.maybeLoadAiModels();
    }
  }

  getSettingValue(key) {
    const keys = key.split(".");
    let current = this.settings;

    for (const k of keys) {
      if (current && typeof current === "object" && k in current) {
        current = current[k];
      } else {
        return undefined;
      }
    }

    return current;
  }

  setSettingValue(key, value) {
    const keys = key.split(".");
    let current = this.settings;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== "object") {
        current[k] = {};
      }
      current = current[k];
    }

    current[keys[keys.length - 1]] = value;
  }

  validateField(key) {
    const field = this.findFieldByKey(key);
    if (!field) return;

    const value = this.getSettingValue(key);
    let error = null;

    // Client-side validation since validation functions are not serializable
    if (field.type === "number") {
      if (field.min !== undefined && value < field.min) {
        error = `Value must be at least ${field.min}`;
      } else if (field.max !== undefined && value > field.max) {
        error = `Value must be at most ${field.max}`;
      }
    } else if (field.type === "text" && field.placeholder) {
      // Basic required field validation
      if (
        field.placeholder.includes("required") &&
        (!value || value.trim() === "")
      ) {
        error = "This field is required";
      }
    } else if (field.type === "directory") {
      // Directory validation
      if (value && value.trim() !== "") {
        // Basic path validation - could be enhanced with actual file system check
        if (!value.includes("/") && !value.includes("\\")) {
          error = "Please select a valid directory path";
        }
      }
    }

    const fieldId = `field-${key.replace(/\./g, "-")}`;
    const errorElement = document.getElementById(`${fieldId}-error`);
    const fieldGroup = document.querySelector(`[data-field="${key}"]`);

    if (error) {
      this.validationErrors[key] = error;
      errorElement.textContent = error;
      fieldGroup.classList.add("has-error");
    } else {
      delete this.validationErrors[key];
      errorElement.textContent = "";
      fieldGroup.classList.remove("has-error");
    }
  }

  findFieldByKey(key) {
    for (const section of this.schema) {
      for (const field of section.fields) {
        if (field.key === key) {
          return field;
        }
      }
    }
    return null;
  }

  async saveSettings() {
    // Validate all fields
    const hasErrors = Object.keys(this.validationErrors).length > 0;
    if (hasErrors) {
      this.showStatus("Please fix validation errors before saving", "error");
      return;
    }

    try {
      // If AI is enabled and an API base URL and key are provided, validate first
      const aiEnabled = this.getSettingValue("ai.enabled");
      const baseUrl = this.getSettingValue("ai.baseUrl");
      const modelKey = "ai.model";

      const saveBtn = document.getElementById("saveBtn");
      const originalSaveHtml = saveBtn.innerHTML;
      const setSaving = (saving) => {
        if (saving) {
          saveBtn.disabled = true;
          saveBtn.innerHTML =
            '<span class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.6); border-top-color:#fff; border-radius:50%; display:inline-block; margin-right:8px; vertical-align:-2px; animation: spin 0.9s linear infinite"></span>Saving...';
        } else {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalSaveHtml;
        }
      };

      setSaving(true);

      // Attempt to fetch API key from a transient input in the form if present
      const apiKeyInput = document.querySelector("#aiApiKeyInline");
      const apiKey = apiKeyInput ? apiKeyInput.value : "";

      let modelsFromProvider = null;
      if (aiEnabled && baseUrl && apiKey) {
        const result = await window.electronAPI.validateApiKeyAndListModels(
          baseUrl,
          apiKey
        );
        if (!result?.success) {
          setSaving(false);
          this.showStatus(
            `API key validation failed: ${result?.error || "Unknown error"}`,
            "error"
          );
          return;
        }
        modelsFromProvider = result.models || [];
        // Save key securely now that it's validated
        try {
          await window.electronAPI.saveApiKeySecure(apiKey);
        } catch {}
        if (apiKeyInput) apiKeyInput.value = "";
        // Replace model field with a select built from models
        this.replaceModelFieldWithDropdown(modelsFromProvider);
      }

      await window.electronAPI.saveSettings(this.settings);
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
      this.showStatus("Settings saved successfully", "success");
      setSaving(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      this.showStatus("Failed to save settings", "error");
      const saveBtn = document.getElementById("saveBtn");
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  replaceModelFieldWithDropdown(models) {
    // Find the ai.model field in schema and convert its type/options for this session
    const section = this.schema.find((s) => s.id === "ai");
    if (!section) return;
    const field = section.fields.find((f) => f.key === "ai.model");
    if (!field) return;
    // Mark models as loaded for current baseUrl to prevent immediate re-validation loops
    try {
      const currentBaseUrl = this.getSettingValue("ai.baseUrl");
      if (currentBaseUrl) {
        this.aiModelsState.loadedForBaseUrl = currentBaseUrl;
      }
    } catch {}
    field.type = "select";
    field.options = models.map((m) => ({ value: m.id, label: m.name || m.id }));
    // If the current setting is not in the list, set the first model
    const current = this.getSettingValue("ai.model");
    const hasCurrent = field.options.some((o) => o.value === current);
    if (!hasCurrent && field.options.length > 0) {
      this.setSettingValue("ai.model", field.options[0].value);
    }
    // Rebuild just the AI section to reflect the dropdown
    this.rebuildForm();
    this.showSection("ai");
  }

  maybeLoadAiModels(force = false) {
    const baseUrl = this.getSettingValue("ai.baseUrl");
    if (!baseUrl) return;
    if (this.aiModelsState.loading) return;
    if (!force && this.aiModelsState.loadedForBaseUrl === baseUrl) return;
    this.loadAiModels();
  }

  async loadAiModels() {
    const baseUrl = this.getSettingValue("ai.baseUrl");
    if (!baseUrl) return;
    if (this.aiModelsState.loading) return;
    this.aiModelsState.loading = true;

    try {
      // Try to get the API key from secure storage
      const apiKey = await this.getSecureApiKey();
      if (!apiKey) return;

      // Show loading state
      const modelField = document.querySelector('[data-key="ai.model"]');
      if (modelField) {
        modelField.disabled = true;
        const originalValue = modelField.value;
        modelField.innerHTML = "<option>Loading models...</option>";
      }

      const result = await window.electronAPI.validateApiKeyAndListModels(
        baseUrl,
        apiKey
      );

      if (result?.success && result.models?.length > 0) {
        this.aiModelsState.loadedForBaseUrl = baseUrl;
        this.replaceModelFieldWithDropdown(result.models);
      } else {
        // Restore original state if loading failed
        if (modelField) {
          modelField.disabled = false;
          this.rebuildForm();
        }
      }
    } catch (error) {
      console.log("Failed to load AI models:", error);
      // Restore original state if loading failed
      const modelField = document.querySelector('[data-key="ai.model"]');
      if (modelField) {
        modelField.disabled = false;
        this.rebuildForm();
      }
    } finally {
      this.aiModelsState.loading = false;
    }
  }

  async getSecureApiKey() {
    try {
      return await window.electronAPI.getApiKeySecure();
    } catch (error) {
      return null;
    }
  }

  cancelChanges() {
    this.settings = JSON.parse(JSON.stringify(this.originalSettings));
    this.rebuildForm();
    this.showStatus("Changes cancelled", "success");
  }

  async resetSection() {
    if (!this.currentSectionId) return;

    if (
      confirm(
        `Reset all settings in the "${this.getCurrentSectionTitle()}" section to defaults?`
      )
    ) {
      try {
        await window.electronAPI.resetSettingsSection(this.currentSectionId);
        this.settings = await window.electronAPI.getSettings();
        this.rebuildForm();
        this.showStatus("Section reset to defaults", "success");
      } catch (error) {
        console.error("Failed to reset section:", error);
        this.showStatus("Failed to reset section", "error");
      }
    }
  }

  async resetAll() {
    if (confirm("Reset all settings to defaults? This cannot be undone.")) {
      try {
        await window.electronAPI.resetAllSettings();
        this.settings = await window.electronAPI.getSettings();
        this.rebuildForm();
        this.showStatus("All settings reset to defaults", "success");
      } catch (error) {
        console.error("Failed to reset all settings:", error);
        this.showStatus("Failed to reset settings", "error");
      }
    }
  }

  async importSettings() {
    try {
      const result = await window.electronAPI.showOpenDialog({
        filters: [{ name: "JSON Files", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const imported = await window.electronAPI.importSettings(
          result.filePaths[0]
        );
        this.settings = imported;
        this.rebuildForm();
        this.showStatus("Settings imported successfully", "success");
      }
    } catch (error) {
      console.error("Failed to import settings:", error);
      this.showStatus("Failed to import settings", "error");
    }
  }

  async exportSettings() {
    try {
      const result = await window.electronAPI.showSaveDialog({
        filters: [{ name: "JSON Files", extensions: ["json"] }],
        defaultPath: "whispermac-settings.json",
      });

      if (!result.canceled) {
        await window.electronAPI.exportSettings(result.filePath, this.settings);
        this.showStatus("Settings exported successfully", "success");
      }
    } catch (error) {
      console.error("Failed to export settings:", error);
      this.showStatus("Failed to export settings", "error");
    }
  }

  rebuildForm() {
    this.buildSettingsForm();
    if (this.currentSectionId) {
      this.showSection(this.currentSectionId);
    }
  }

  getCurrentSectionTitle() {
    const section = this.schema.find((s) => s.id === this.currentSectionId);
    return section ? section.title : "Unknown";
  }

  // Helper methods for plugin operations
  setupProgressListeners(eventType, defaultMessage) {
    const progressHandler = (progress) => {
      const message = progress.message || defaultMessage;
      const percent = progress.percent || 0;
      this.showModelSwitchProgress(message, percent);
    };

    const logHandler = (payload) => {
      console.log(`${eventType} log:`, payload.line);
    };

    // Map event types to actual API method names
    const apiMethodMap = {
      PluginOption: {
        progress: "onPluginOptionProgress",
        log: "onPluginOptionLog",
      },
      PluginSwitch: {
        progress: "onPluginSwitchProgress",
        log: "onPluginSwitchLog",
      },
    };

    const methods = apiMethodMap[eventType];
    if (methods) {
      window.electronAPI[methods.progress](progressHandler);
      window.electronAPI[methods.log](logHandler);
    }

    return { progressHandler, logHandler };
  }

  cleanupProgressListeners(eventType) {
    // Map event types to actual channel names
    const channelMap = {
      PluginOption: {
        progress: "settings:pluginOptionProgress",
        log: "settings:pluginOptionLog",
      },
      PluginSwitch: {
        progress: "settings:pluginSwitchProgress",
        log: "settings:pluginSwitchLog",
      },
    };

    const channels = channelMap[eventType];
    if (channels) {
      window.electronAPI.removeAllListeners(channels.progress);
      window.electronAPI.removeAllListeners(channels.log);
    }
  }

  disableField(key) {
    const field = document.querySelector(`[data-key="${key}"]`);
    if (field) field.disabled = true;
    return field;
  }

  enableField(key) {
    const field = document.querySelector(`[data-key="${key}"]`);
    if (field) field.disabled = false;
    return field;
  }

  revertFieldValue(key, oldValue) {
    const field = document.querySelector(`[data-key="${key}"]`);
    if (field) {
      if (field.type === "checkbox") {
        field.checked = oldValue;
      } else {
        field.value = oldValue;
      }
    }
  }

  async handlePluginOptionChange(key, newValue, oldValue) {
    try {
      // Parse the plugin key: plugin.{pluginName}.{optionKey}
      const parts = key.split(".");
      if (parts.length !== 3 || parts[0] !== "plugin") {
        console.warn("Invalid plugin option key:", key);
        return;
      }

      const pluginName = parts[1];
      const optionKey = parts[2];

      // Only update options for the active plugin
      if (pluginName !== this.activePlugin) {
        console.log(
          `Ignoring option change for inactive plugin: ${pluginName}`
        );
        return;
      }

      // Prepare the options update
      const options = { [optionKey]: newValue };

      // Disable the field during the update
      const field = this.disableField(key);

      // Set up progress listeners
      this.setupProgressListeners("PluginOption", `Updating ${optionKey}...`);

      try {
        // Show progress for significant changes (like model switches)
        if (optionKey === "model") {
          this.showModelSwitchProgress(`Switching to ${newValue}...`, 0);
        }

        // Update the plugin options using unified API
        await window.electronAPI.updateActivePluginOptions(options);

        if (optionKey === "model") {
          this.showStatus(`Switched to ${newValue}`, "success");
        } else {
          this.showStatus(`Updated ${optionKey}`, "success");
        }
      } catch (error) {
        console.error("Failed to update plugin option:", error);
        this.showStatus(
          `Failed to update ${optionKey}: ${error.message}`,
          "error"
        );

        // Revert the setting and field value
        this.setSettingValue(key, oldValue);
        this.revertFieldValue(key, oldValue);
      } finally {
        // Clean up listeners
        this.cleanupProgressListeners("PluginOption");

        // Re-enable the field
        this.enableField(key);

        // Hide progress after a delay for model changes
        if (optionKey === "model") {
          setTimeout(() => {
            this.hideModelSwitchProgress();
          }, 2000);
        }
      }
    } catch (error) {
      console.error("Error handling plugin option change:", error);
      this.showStatus("Error updating plugin option", "error");
    }
  }

  async handlePluginChange(newPlugin, oldPlugin) {
    try {
      // Show confirmation dialog
      const confirmSwitch = window.confirm(
        `Switch to ${newPlugin} transcription plugin?\n\n` +
          `This will download the required model if needed.`
      );

      if (!confirmSwitch) {
        // Revert the selection
        const selector = document.querySelector("[data-plugin-selector]");
        if (selector) {
          selector.value = oldPlugin;
        }
        return;
      }

      // Disable the field during switching
      const field = document.querySelector("[data-plugin-selector]");
      if (field) field.disabled = true;

      // Show progress
      this.showModelSwitchProgress(`Switching to ${newPlugin}...`, 0);

      // Set up progress listeners
      this.setupProgressListeners("PluginSwitch", `Setting up ${newPlugin}...`);

      try {
        // Perform the plugin switch using unified API
        const result = await window.electronAPI.switchPlugin(newPlugin);

        if (result.success) {
          this.activePlugin = newPlugin;
          this.showModelSwitchProgress(`${newPlugin} ready`, 100);
          this.showStatus(`Switched to ${newPlugin}`, "success");

          // Update UI to show/hide plugin sections
          document
            .querySelectorAll(".plugin-config-section")
            .forEach((section) => {
              const isCurrentPlugin = section.dataset.plugin === newPlugin;
              section.style.display = isCurrentPlugin ? "block" : "none";
            });
        } else {
          throw new Error(result.error || "Plugin switch failed");
        }
      } catch (switchError) {
        console.error("Plugin switch failed:", switchError);

        // Revert the setting
        const selector = document.querySelector("[data-plugin-selector]");
        if (selector) {
          selector.value = oldPlugin;
        }

        this.showStatus(`Failed to switch to ${newPlugin}`, "error");
        throw switchError;
      }
    } catch (error) {
      console.error("Error handling plugin change:", error);
      this.showStatus("Error switching plugin", "error");
    } finally {
      // Clean up listeners
      this.cleanupProgressListeners("PluginSwitch");

      // Re-enable the field
      const field = document.querySelector("[data-plugin-selector]");
      if (field) field.disabled = false;

      // Hide progress after a delay
      setTimeout(() => {
        this.hideModelSwitchProgress();
      }, 2000);
    }
  }

  showModelSwitchProgress(message, percent) {
    let progressContainer = document.querySelector(".model-switch-progress");
    if (!progressContainer) {
      // Create progress container
      progressContainer = document.createElement("div");
      progressContainer.className = "model-switch-progress";
      progressContainer.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: rgba(0, 122, 255, 0.95);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1001;
        min-width: 280px;
        font-size: 13px;
      `;
      document.body.appendChild(progressContainer);
    }

    progressContainer.innerHTML = `
      <div style="margin-bottom: 8px;">${message}</div>
      <div style="background: rgba(255, 255, 255, 0.2); height: 4px; border-radius: 2px; overflow: hidden;">
        <div style="background: white; height: 100%; width: ${percent}%; transition: width 0.3s ease;"></div>
      </div>
      <div style="margin-top: 4px; font-size: 11px; opacity: 0.9;">${percent.toFixed(
        1
      )}%</div>
    `;
  }

  hideModelSwitchProgress() {
    const progressContainer = document.querySelector(".model-switch-progress");
    if (progressContainer) {
      progressContainer.remove();
    }
  }

  showStatus(message, type = "success") {
    const statusElement = document.getElementById("statusMessage");
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    statusElement.classList.add("show");

    setTimeout(() => {
      statusElement.classList.remove("show");
    }, 3000);
  }

  closeWindow() {
    window.electronAPI.closeSettingsWindow();
  }

  async browseDirectory(key) {
    try {
      const result = await window.electronAPI.showDirectoryDialog({
        title: "Select Directory",
        buttonLabel: "Select",
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        this.setSettingValue(key, selectedPath);

        // Update the input field
        const fieldId = `field-${key.replace(/\./g, "-")}`;
        const input = document.getElementById(fieldId);
        if (input) {
          input.value = selectedPath;
        }

        this.validateField(key);
      }
    } catch (error) {
      console.error("Failed to browse directory:", error);
      this.showStatus("Failed to browse directory", "error");
    }
  }

  async deleteInactivePlugin(pluginName) {
    try {
      const pluginInfo = this.pluginData.plugins.find(
        (p) => p.name === pluginName
      );
      const confirmDelete = await window.confirm(
        `Clear all data for ${pluginInfo?.displayName || pluginName}?\n\n` +
          `This will delete downloaded models and cached data. This action cannot be undone.`
      );

      if (!confirmDelete) return;

      await window.electronAPI.deleteInactivePlugin(pluginName);
      this.showStatus(
        `Cleared data for ${pluginInfo?.displayName || pluginName}`,
        "success"
      );
    } catch (error) {
      console.error("Failed to delete plugin data:", error);
      this.showStatus("Failed to clear plugin data", "error");
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  initializeActionsEditors() {
    document
      .querySelectorAll(".actions-editor-container")
      .forEach((container) => {
        const key = container.querySelector(".actions-list").dataset.key;
        this.renderActionsEditor(container, key);
        this.bindActionsEditorEvents(container, key);
      });
  }

  renderActionsEditor(container, key) {
    const actionsList = container.querySelector(".actions-list");
    const actionsConfig = this.getSettingValue(key) || { actions: [] };

    actionsList.innerHTML = "";

    if (!actionsConfig.actions || actionsConfig.actions.length === 0) {
      actionsList.innerHTML = `
        <div class="empty-actions-state">
          <i class="ph-duotone ph-lightning"></i>
          <p>No actions configured</p>
          <p class="empty-subtitle">Add your first voice action to get started</p>
        </div>
      `;
      return;
    }

    actionsConfig.actions.forEach((action, index) => {
      const actionCard = this.createActionCard(action, index, key);
      actionsList.appendChild(actionCard);
    });
  }

  createActionCard(action, index, key) {
    const card = document.createElement("div");
    card.className = "action-card";
    card.dataset.actionIndex = index;

    const matchPatternsHtml = action.matchPatterns
      .map((pattern, patternIndex) =>
        this.createMatchPatternHtml(pattern, index, patternIndex, key)
      )
      .join("");

    const handlersHtml = action.handlers
      .map((handler, handlerIndex) =>
        this.createHandlerHtml(handler, index, handlerIndex, key)
      )
      .join("");

    card.innerHTML = `
      <div class="action-card-header">
        <div class="action-info">
          <div class="action-toggle">
            <input type="checkbox" class="action-enabled-checkbox" 
                   ${action.enabled ? "checked" : ""} 
                   data-action-index="${index}" data-key="${key}">
            <h4 class="action-name">${this.escapeHtml(action.name)}</h4>
          </div>
          <p class="action-description">${this.escapeHtml(
            action.description
          )}</p>
        </div>
        <div class="action-controls">
          <button type="button" class="btn btn-icon-only expand-action-btn" title="Toggle details">
            <i class="ph-duotone ph-caret-down"></i>
          </button>
          <button type="button" class="btn btn-icon-only btn-negative delete-action-btn" 
                  data-action-index="${index}" data-key="${key}" title="Delete action">
            <i class="ph-duotone ph-trash"></i>
          </button>
        </div>
      </div>
      
      <div class="action-card-body collapsed">
        <div class="action-form-group">
          <label>Action Name</label>
          <input type="text" class="form-control action-name-input" 
                 value="${this.escapeHtml(action.name)}" 
                 data-action-index="${index}" data-key="${key}">
        </div>
        
        <div class="action-form-group">
          <label>Description</label>
          <input type="text" class="form-control action-description-input" 
                 value="${this.escapeHtml(action.description)}" 
                 data-action-index="${index}" data-key="${key}">
        </div>

        <div class="patterns-section">
          <div class="section-header-small">
            <h5>Match Patterns</h5>
            <button type="button" class="btn btn-sm add-pattern-btn" 
                    data-action-index="${index}" data-key="${key}">
              <i class="ph-duotone ph-plus"></i>
              Add Pattern
            </button>
          </div>
          <div class="patterns-list">
            ${matchPatternsHtml}
          </div>
        </div>

        <div class="handlers-section">
          <div class="section-header-small">
            <h5>Action Handlers</h5>
            <button type="button" class="btn btn-sm add-handler-btn" 
                    data-action-index="${index}" data-key="${key}">
              <i class="ph-duotone ph-plus"></i>
              Add Handler
            </button>
          </div>
          <div class="handlers-list">
            ${handlersHtml}
          </div>
        </div>
      </div>
    `;

    return card;
  }

  createMatchPatternHtml(pattern, actionIndex, patternIndex, key) {
    return `
      <div class="pattern-item" data-pattern-index="${patternIndex}">
        <div class="pattern-controls">
          <select class="form-control pattern-type-select" 
                  data-action-index="${actionIndex}" 
                  data-pattern-index="${patternIndex}" 
                  data-key="${key}">
            <option value="startsWith" ${
              pattern.type === "startsWith" ? "selected" : ""
            }>Starts with</option>
            <option value="endsWith" ${
              pattern.type === "endsWith" ? "selected" : ""
            }>Ends with</option>
            <option value="exact" ${
              pattern.type === "exact" ? "selected" : ""
            }>Exact match</option>
            <option value="regex" ${
              pattern.type === "regex" ? "selected" : ""
            }>Regular expression</option>
          </select>
          <input type="text" class="form-control pattern-input" 
                 placeholder="Pattern text..." 
                 value="${this.escapeHtml(pattern.pattern)}"
                 data-action-index="${actionIndex}" 
                 data-pattern-index="${patternIndex}" 
                 data-key="${key}">
          <label class="case-sensitive-label">
            <input type="checkbox" class="pattern-case-sensitive" 
                   ${pattern.caseSensitive ? "checked" : ""}
                   data-action-index="${actionIndex}" 
                   data-pattern-index="${patternIndex}" 
                   data-key="${key}">
            Case sensitive
          </label>
          <button type="button" class="btn btn-icon-only btn-negative delete-pattern-btn" 
                  data-action-index="${actionIndex}" 
                  data-pattern-index="${patternIndex}" 
                  data-key="${key}">
            <i class="ph-duotone ph-x"></i>
          </button>
        </div>
      </div>
    `;
  }

  createHandlerHtml(handler, actionIndex, handlerIndex, key) {
    const handlerConfig = this.createHandlerConfigHtml(
      handler,
      actionIndex,
      handlerIndex,
      key
    );

    return `
      <div class="handler-item" data-handler-index="${handlerIndex}">
        <div class="handler-header">
          <select class="form-control handler-type-select" 
                  data-action-index="${actionIndex}" 
                  data-handler-index="${handlerIndex}" 
                  data-key="${key}">
            <option value="openUrl" ${
              handler.type === "openUrl" ? "selected" : ""
            }>Open URL</option>
            <option value="openApplication" ${
              handler.type === "openApplication" ? "selected" : ""
            }>Open Application</option>
            <option value="quitApplication" ${
              handler.type === "quitApplication" ? "selected" : ""
            }>Quit Application</option>
            <option value="executeShell" ${
              handler.type === "executeShell" ? "selected" : ""
            }>Execute Shell Command</option>
          </select>
          <input type="number" class="form-control handler-order-input" 
                 min="1" value="${handler.order}" 
                 title="Execution order (lower numbers run first)"
                 data-action-index="${actionIndex}" 
                 data-handler-index="${handlerIndex}" 
                 data-key="${key}">
          <button type="button" class="btn btn-icon-only btn-negative delete-handler-btn" 
                  data-action-index="${actionIndex}" 
                  data-handler-index="${handlerIndex}" 
                  data-key="${key}">
            <i class="ph-duotone ph-x"></i>
          </button>
        </div>
        <div class="handler-config">
          ${handlerConfig}
        </div>
      </div>
    `;
  }

  createHandlerConfigHtml(handler, actionIndex, handlerIndex, key) {
    switch (handler.type) {
      case "openUrl":
        return `
          <div class="config-field">
            <label>URL Template</label>
            <input type="text" class="form-control" 
                   placeholder="Use {argument}, {match}, etc." 
                   value="${this.escapeHtml(handler.config.urlTemplate || "")}"
                   data-config-field="urlTemplate"
                   data-action-index="${actionIndex}" 
                   data-handler-index="${handlerIndex}" 
                   data-key="${key}">
            <small class="field-help">Use {argument} for the matched text after the trigger</small>
          </div>
          <div class="config-field">
            <label>
              <input type="checkbox" 
                     ${handler.config.openInBackground ? "checked" : ""}
                     data-config-field="openInBackground"
                     data-action-index="${actionIndex}" 
                     data-handler-index="${handlerIndex}" 
                     data-key="${key}">
              Open in background
            </label>
          </div>
        `;

      case "openApplication":
        return `
          <div class="config-field">
            <label>Application Name</label>
            <input type="text" class="form-control" 
                   placeholder="Leave empty to use matched text" 
                   value="${this.escapeHtml(
                     handler.config.applicationName || ""
                   )}"
                   data-config-field="applicationName"
                   data-action-index="${actionIndex}" 
                   data-handler-index="${handlerIndex}" 
                   data-key="${key}">
          </div>
          <div class="config-field">
            <label>
              <input type="checkbox" 
                     ${handler.config.waitForExit ? "checked" : ""}
                     data-config-field="waitForExit"
                     data-action-index="${actionIndex}" 
                     data-handler-index="${handlerIndex}" 
                     data-key="${key}">
              Wait for application to exit
            </label>
          </div>
        `;

      case "quitApplication":
        return `
          <div class="config-field">
            <label>Application Name</label>
            <input type="text" class="form-control" 
                   placeholder="Leave empty to quit WhisperMac" 
                   value="${this.escapeHtml(
                     handler.config.applicationName || ""
                   )}"
                   data-config-field="applicationName"
                   data-action-index="${actionIndex}" 
                   data-handler-index="${handlerIndex}" 
                   data-key="${key}">
          </div>
          <div class="config-field">
            <label>
              <input type="checkbox" 
                     ${handler.config.forceQuit ? "checked" : ""}
                     data-config-field="forceQuit"
                     data-action-index="${actionIndex}" 
                     data-handler-index="${handlerIndex}" 
                     data-key="${key}">
              Force quit
            </label>
          </div>
        `;

      case "executeShell":
        return `
          <div class="config-field">
            <label>Command</label>
            <textarea class="form-control" rows="3" 
                      placeholder="Shell command to execute"
                      data-config-field="command"
                      data-action-index="${actionIndex}" 
                      data-handler-index="${handlerIndex}" 
                      data-key="${key}">${this.escapeHtml(
          handler.config.command || ""
        )}</textarea>
            <small class="field-help">Use {argument}, {match} for dynamic values</small>
          </div>
          <div class="config-field">
            <label>Working Directory</label>
            <input type="text" class="form-control" 
                   placeholder="Optional working directory" 
                   value="${this.escapeHtml(
                     handler.config.workingDirectory || ""
                   )}"
                   data-config-field="workingDirectory"
                   data-action-index="${actionIndex}" 
                   data-handler-index="${handlerIndex}" 
                   data-key="${key}">
          </div>
          <div class="config-field">
            <label>Timeout (ms)</label>
            <input type="number" class="form-control" 
                   placeholder="10000" 
                   value="${handler.config.timeout || ""}"
                   data-config-field="timeout"
                   data-action-index="${actionIndex}" 
                   data-handler-index="${handlerIndex}" 
                   data-key="${key}">
          </div>
          <div class="config-field">
            <label>
              <input type="checkbox" 
                     ${handler.config.runInBackground ? "checked" : ""}
                     data-config-field="runInBackground"
                     data-action-index="${actionIndex}" 
                     data-handler-index="${handlerIndex}" 
                     data-key="${key}">
              Run in background
            </label>
          </div>
        `;

      default:
        return '<div class="config-field">Unknown handler type</div>';
    }
  }

  bindActionsEditorEvents(container, key) {
    // Add action button
    container
      .querySelector(".add-action-btn")
      ?.addEventListener("click", () => {
        this.addNewAction(key);
      });

    // Reset actions button
    container
      .querySelector(".reset-actions-btn")
      ?.addEventListener("click", () => {
        this.resetActionsToDefaults(key);
      });

    // Action card events
    container.addEventListener("click", (e) => {
      if (e.target.closest(".expand-action-btn")) {
        this.toggleActionCard(e.target.closest(".action-card"));
      } else if (e.target.closest(".delete-action-btn")) {
        const actionIndex = parseInt(
          e.target.closest(".delete-action-btn").dataset.actionIndex
        );
        this.deleteAction(key, actionIndex);
      } else if (e.target.closest(".add-pattern-btn")) {
        const actionIndex = parseInt(
          e.target.closest(".add-pattern-btn").dataset.actionIndex
        );
        this.addNewPattern(key, actionIndex);
      } else if (e.target.closest(".delete-pattern-btn")) {
        const btn = e.target.closest(".delete-pattern-btn");
        const actionIndex = parseInt(btn.dataset.actionIndex);
        const patternIndex = parseInt(btn.dataset.patternIndex);
        this.deletePattern(key, actionIndex, patternIndex);
      } else if (e.target.closest(".add-handler-btn")) {
        const actionIndex = parseInt(
          e.target.closest(".add-handler-btn").dataset.actionIndex
        );
        this.addNewHandler(key, actionIndex);
      } else if (e.target.closest(".delete-handler-btn")) {
        const btn = e.target.closest(".delete-handler-btn");
        const actionIndex = parseInt(btn.dataset.actionIndex);
        const handlerIndex = parseInt(btn.dataset.handlerIndex);
        this.deleteHandler(key, actionIndex, handlerIndex);
      }
    });

    // Form input events
    container.addEventListener("input", (e) => {
      this.handleActionsEditorInput(e, key);
    });

    container.addEventListener("change", (e) => {
      this.handleActionsEditorInput(e, key);
    });
  }

  handleActionsEditorInput(e, key) {
    const target = e.target;

    if (target.classList.contains("action-enabled-checkbox")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      this.updateActionField(key, actionIndex, "enabled", target.checked);
    } else if (target.classList.contains("action-name-input")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      this.updateActionField(key, actionIndex, "name", target.value);
    } else if (target.classList.contains("action-description-input")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      this.updateActionField(key, actionIndex, "description", target.value);
    } else if (target.classList.contains("pattern-type-select")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      const patternIndex = parseInt(target.dataset.patternIndex);
      this.updatePatternField(
        key,
        actionIndex,
        patternIndex,
        "type",
        target.value
      );
    } else if (target.classList.contains("pattern-input")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      const patternIndex = parseInt(target.dataset.patternIndex);
      this.updatePatternField(
        key,
        actionIndex,
        patternIndex,
        "pattern",
        target.value
      );
    } else if (target.classList.contains("pattern-case-sensitive")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      const patternIndex = parseInt(target.dataset.patternIndex);
      this.updatePatternField(
        key,
        actionIndex,
        patternIndex,
        "caseSensitive",
        target.checked
      );
    } else if (target.classList.contains("handler-type-select")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      const handlerIndex = parseInt(target.dataset.handlerIndex);
      this.updateHandlerType(key, actionIndex, handlerIndex, target.value);
    } else if (target.classList.contains("handler-order-input")) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      const handlerIndex = parseInt(target.dataset.handlerIndex);
      this.updateHandlerField(
        key,
        actionIndex,
        handlerIndex,
        "order",
        parseInt(target.value) || 1
      );
    } else if (target.dataset.configField) {
      const actionIndex = parseInt(target.dataset.actionIndex);
      const handlerIndex = parseInt(target.dataset.handlerIndex);
      const field = target.dataset.configField;
      const value = target.type === "checkbox" ? target.checked : target.value;
      this.updateHandlerConfig(key, actionIndex, handlerIndex, field, value);
    }
  }

  addNewAction(key) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    const newAction = {
      id: `action-${Date.now()}`,
      name: "New Action",
      description: "Description for new action",
      enabled: true,
      matchPatterns: [
        {
          id: `pattern-${Date.now()}`,
          type: "startsWith",
          pattern: "trigger ",
          caseSensitive: false,
        },
      ],
      handlers: [
        {
          id: `handler-${Date.now()}`,
          type: "openUrl",
          config: {
            urlTemplate: "{argument}",
            openInBackground: false,
          },
          order: 1,
        },
      ],
    };

    actionsConfig.actions.push(newAction);
    this.setSettingValue(key, actionsConfig);

    const container = document
      .querySelector(`[data-key="${key}"]`)
      .closest(".actions-editor-container");
    this.renderActionsEditor(container, key);
  }

  deleteAction(key, actionIndex) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    if (confirm("Are you sure you want to delete this action?")) {
      actionsConfig.actions.splice(actionIndex, 1);
      this.setSettingValue(key, actionsConfig);

      const container = document
        .querySelector(`[data-key="${key}"]`)
        .closest(".actions-editor-container");
      this.renderActionsEditor(container, key);
    }
  }

  addNewPattern(key, actionIndex) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    const newPattern = {
      id: `pattern-${Date.now()}`,
      type: "startsWith",
      pattern: "",
      caseSensitive: false,
    };

    actionsConfig.actions[actionIndex].matchPatterns.push(newPattern);
    this.setSettingValue(key, actionsConfig);

    const container = document
      .querySelector(`[data-key="${key}"]`)
      .closest(".actions-editor-container");
    this.renderActionsEditor(container, key);
  }

  deletePattern(key, actionIndex, patternIndex) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    if (actionsConfig.actions[actionIndex].matchPatterns.length <= 1) {
      alert("Each action must have at least one match pattern.");
      return;
    }

    actionsConfig.actions[actionIndex].matchPatterns.splice(patternIndex, 1);
    this.setSettingValue(key, actionsConfig);

    const container = document
      .querySelector(`[data-key="${key}"]`)
      .closest(".actions-editor-container");
    this.renderActionsEditor(container, key);
  }

  addNewHandler(key, actionIndex) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    const newHandler = {
      id: `handler-${Date.now()}`,
      type: "openUrl",
      config: {
        urlTemplate: "{argument}",
        openInBackground: false,
      },
      order: actionsConfig.actions[actionIndex].handlers.length + 1,
    };

    actionsConfig.actions[actionIndex].handlers.push(newHandler);
    this.setSettingValue(key, actionsConfig);

    const container = document
      .querySelector(`[data-key="${key}"]`)
      .closest(".actions-editor-container");
    this.renderActionsEditor(container, key);
  }

  deleteHandler(key, actionIndex, handlerIndex) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    if (actionsConfig.actions[actionIndex].handlers.length <= 1) {
      alert("Each action must have at least one handler.");
      return;
    }

    actionsConfig.actions[actionIndex].handlers.splice(handlerIndex, 1);
    this.setSettingValue(key, actionsConfig);

    const container = document
      .querySelector(`[data-key="${key}"]`)
      .closest(".actions-editor-container");
    this.renderActionsEditor(container, key);
  }

  updateActionField(key, actionIndex, field, value) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    actionsConfig.actions[actionIndex][field] = value;
    this.setSettingValue(key, actionsConfig);
  }

  updatePatternField(key, actionIndex, patternIndex, field, value) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    actionsConfig.actions[actionIndex].matchPatterns[patternIndex][field] =
      value;
    this.setSettingValue(key, actionsConfig);
  }

  updateHandlerField(key, actionIndex, handlerIndex, field, value) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    actionsConfig.actions[actionIndex].handlers[handlerIndex][field] = value;
    this.setSettingValue(key, actionsConfig);
  }

  updateHandlerType(key, actionIndex, handlerIndex, newType) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    const handler = actionsConfig.actions[actionIndex].handlers[handlerIndex];

    handler.type = newType;

    // Reset config to defaults for new type
    switch (newType) {
      case "openUrl":
        handler.config = { urlTemplate: "{argument}", openInBackground: false };
        break;
      case "openApplication":
        handler.config = { applicationName: "{argument}", waitForExit: false };
        break;
      case "quitApplication":
        handler.config = { applicationName: "{argument}", forceQuit: false };
        break;
      case "executeShell":
        handler.config = {
          command: "",
          runInBackground: false,
          timeout: 10000,
        };
        break;
    }

    this.setSettingValue(key, actionsConfig);

    const container = document
      .querySelector(`[data-key="${key}"]`)
      .closest(".actions-editor-container");
    this.renderActionsEditor(container, key);
  }

  updateHandlerConfig(key, actionIndex, handlerIndex, field, value) {
    const actionsConfig = this.getSettingValue(key) || { actions: [] };
    actionsConfig.actions[actionIndex].handlers[handlerIndex].config[field] =
      value;
    this.setSettingValue(key, actionsConfig);
  }

  toggleActionCard(card) {
    const body = card.querySelector(".action-card-body");
    const icon = card.querySelector(".expand-action-btn i");

    if (body.classList.contains("collapsed")) {
      body.classList.remove("collapsed");
      icon.className = "ph-duotone ph-caret-up";
    } else {
      body.classList.add("collapsed");
      icon.className = "ph-duotone ph-caret-down";
    }
  }

  resetActionsToDefaults(key) {
    if (
      confirm(
        "Reset all actions to defaults? This will remove any custom actions you have created."
      )
    ) {
      // We need to get the default from the schema
      const field = this.schema
        .find((s) => s.id === "actions")
        ?.fields.find((f) => f.key === key);
      if (field) {
        this.setSettingValue(key, field.defaultValue);
        const container = document
          .querySelector(`[data-key="${key}"]`)
          .closest(".actions-editor-container");
        this.renderActionsEditor(container, key);
      }
    }
  }

  async loadPluginDataInfo() {
    const dataList = document.getElementById("pluginDataList");
    if (!dataList) return;

    try {
      const pluginData = await window.electronAPI.getPluginDataInfo();
      this.renderPluginDataList(pluginData);
    } catch (error) {
      console.error("Failed to load plugin data info:", error);
      dataList.innerHTML = `
        <div class="error-message">
          <i class="ph-duotone ph-warning"></i>
          Failed to load plugin data information
        </div>
      `;
    }
  }

  renderPluginDataList(pluginData) {
    const dataList = document.getElementById("pluginDataList");
    if (!dataList) return;

    if (pluginData.length === 0) {
      dataList.innerHTML = `
        <div class="no-data-message">
          <i class="ph-duotone ph-database"></i>
          No plugins found
        </div>
      `;
      return;
    }

    const formatBytes = (bytes) => {
      if (bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const html = pluginData
      .map(
        (plugin) => `
      <div class="plugin-data-item ${plugin.isActive ? "active" : ""}">
        <div class="plugin-data-info">
          <div class="plugin-name">
            <i class="ph-duotone ph-gear"></i>
            ${this.escapeHtml(plugin.displayName)}
            ${plugin.isActive ? '<span class="active-badge">Active</span>' : ""}
          </div>
          <div class="plugin-data-details">
            <span class="data-size">
              <i class="ph-duotone ph-hard-drive"></i>
              ${formatBytes(plugin.dataSize)}
            </span>
            <span class="data-path">
              <i class="ph-duotone ph-folder"></i>
              ${this.escapeHtml(plugin.dataPath)}
            </span>
          </div>
        </div>
        <div class="plugin-data-actions">
          ${
            !plugin.isActive
              ? `
            <button class="btn btn-negative btn-sm clear-data-btn" data-plugin="${plugin.name}" title="Clear plugin data">
              <i class="ph-duotone ph-trash"></i>
              Clear Data
            </button>
          `
              : `
            <span class="active-plugin-note">Active plugin - data cannot be cleared</span>
          `
          }
        </div>
      </div>
    `
      )
      .join("");

    dataList.innerHTML = html;

    // Bind clear data buttons
    document.querySelectorAll(".clear-data-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const pluginName = button.dataset.plugin;
        await this.clearPluginData(pluginName);
      });
    });
  }

  async clearPluginData(pluginName) {
    try {
      const pluginInfo = this.pluginData.plugins.find(
        (p) => p.name === pluginName
      );
      const confirmDelete = await window.confirm(
        `Clear all data for ${pluginInfo?.displayName || pluginName}?\n\n` +
          `This will delete downloaded models and cached data. This action cannot be undone.`
      );

      if (!confirmDelete) return;

      await window.electronAPI.deleteInactivePlugin(pluginName);
      this.showStatus(
        `Cleared data for ${pluginInfo?.displayName || pluginName}`,
        "success"
      );

      // Reload the data list
      this.loadPluginDataInfo();
    } catch (error) {
      console.error("Failed to clear plugin data:", error);
      this.showStatus("Failed to clear plugin data", "error");
    }
  }
}

// Initialize settings window when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new SettingsWindow();
});
