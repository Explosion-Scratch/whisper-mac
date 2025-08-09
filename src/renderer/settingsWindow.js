class SettingsWindow {
  constructor() {
    this.schema = null;
    this.settings = {};
    this.originalSettings = {};
    this.currentSectionId = null;
    this.validationErrors = {};

    this.init();
  }

  async init() {
    try {
      // Get settings schema and current settings from main process
      this.schema = await window.electronAPI.getSettingsSchema();
      this.settings = await window.electronAPI.getSettings();
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));

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
      // Additional semantic mappings
      general: "ph-gear-six",
      appearance: "ph-palette",
      audio: "ph-speaker-high",
      ai: "ph-robot",
      advanced: "ph-wrench",
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
      serverPort: "ph-globe",
      defaultModel: "ph-brain",
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
      general: "ph-gear-six",
      appearance: "ph-palette",
      audio: "ph-speaker-high",
      ai: "ph-robot",
      advanced: "ph-wrench",
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
        </div>
      `;

      form.appendChild(sectionDiv);
    });

    // Bind field events after DOM is created
    this.bindFieldEvents();
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
        serverPort: "ph-globe",
        defaultModel: "ph-brain",
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
        element.addEventListener("input", () => {
          this.setSettingValue(key, element.value);
          this.validateField(key);
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

      // Specific validation for server port
      if (key === "serverPort") {
        if (value < 1024 || value > 65535) {
          error = "Port must be between 1024 and 65535";
        }
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
      await window.electronAPI.saveSettings(this.settings);
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
      this.showStatus("Settings saved successfully", "success");
    } catch (error) {
      console.error("Failed to save settings:", error);
      this.showStatus("Failed to save settings", "error");
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

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize settings window when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new SettingsWindow();
});
