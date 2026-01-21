<template>
  <div class="plugin-option" v-if="shouldShow">
    <label v-if="option.type !== 'boolean'">{{ option.label }}</label>
    <div v-if="currentDescription" class="field-description">
      {{ currentDescription }}
    </div>

    <!-- Select / Model Select -->
    <select
      v-if="option.type === 'model-select' || option.type === 'select'"
      class="form-control"
      :value="value"
      @change="handleChange($event.target.value)"
    >
      <option v-for="opt in option.options" :key="opt.value" :value="opt.value">
        {{ opt.label }}{{ opt.size ? ` (${opt.size})` : "" }}
      </option>
    </select>

    <!-- Boolean Checkbox -->
    <div v-else-if="option.type === 'boolean'" class="checkbox-container">
      <input
        type="checkbox"
        class="checkbox"
        :id="fieldId"
        :checked="value"
        @change="handleChange($event.target.checked)"
      />
      <label :for="fieldId">{{ option.label }}</label>
    </div>

    <!-- Number Input -->
    <input
      v-else-if="option.type === 'number'"
      type="number"
      class="form-control"
      :value="value"
      @input="handleChange(parseFloat($event.target.value))"
      :min="option.min"
      :max="option.max"
      :step="option.step || 1"
    />

    <!-- Textarea -->
    <textarea
      v-else-if="option.type === 'textarea'"
      class="form-control textarea"
      :value="value"
      @input="handleChange($event.target.value)"
      rows="4"
      :placeholder="option.placeholder || ''"
    ></textarea>

    <!-- API Key (Password Field with Validation) -->
    <div v-else-if="option.type === 'api-key'" class="api-key-field">
      <div class="api-key-input-wrapper">
        <i class="ph-duotone ph-key"></i>
        <input
          :type="showApiKey ? 'text' : 'password'"
          class="form-control"
          :class="{
            'is-valid': apiKeyStatus === 'valid',
            'is-invalid': apiKeyStatus === 'invalid',
          }"
          :id="fieldId"
          v-model="apiKeyInputValue"
          @input="handleApiKeyInput"
          @blur="validateApiKeyOnBlur"
          placeholder="Enter API key to validate"
        />
        <button
          type="button"
          class="visibility-toggle"
          @click="toggleApiKeyVisibility"
          :title="showApiKey ? 'Hide API key' : 'Show API key'"
        >
          <i
            :class="
              showApiKey ? 'ph-duotone ph-eye-slash' : 'ph-duotone ph-eye'
            "
          ></i>
        </button>
      </div>
      <!-- API Key Status Indicator -->
      <div class="api-key-status" :class="apiKeyStatusClass">
        <template v-if="apiKeyStatus === 'validating'">
          <span class="spinner-small"></span>
          <span>Validating API key...</span>
        </template>
        <template v-else-if="apiKeyStatus === 'valid'">
          <i class="ph-duotone ph-check-circle"></i>
          <span>API key validated and saved</span>
        </template>
        <template v-else-if="apiKeyStatus === 'invalid'">
          <i class="ph-duotone ph-x-circle"></i>
          <span>{{ apiKeyError || "Invalid API key" }}</span>
        </template>
        <template v-else-if="apiKeyStatus === 'saved'">
          <i class="ph-duotone ph-check"></i>
          <span>API key configured</span>
        </template>
        <template v-else>
          <i class="ph-duotone ph-info"></i>
          <span>Enter API key to validate</span>
        </template>
      </div>
    </div>

    <!-- Text Input (default) -->
    <input
      v-else
      type="text"
      class="form-control"
      :value="value"
      @input="handleChange($event.target.value)"
    />
  </div>
</template>

<script>
/**
 * PluginOption Component
 * Renders a single plugin configuration option (select, checkbox, number, text, textarea, api-key)
 * Supports conditional visibility and dynamic descriptions based on other field values
 * API key fields include validation with status feedback
 * @component
 */
export default {
  name: "PluginOption",

  props: {
    /**
     * Plugin name for generating unique IDs
     */
    pluginName: {
      type: String,
      required: true,
    },

    /**
     * Option schema object { key, type, label, description, options, min, max, step, default, dependsOn, conditionalDescription }
     */
    option: {
      type: Object,
      required: true,
    },

    /**
     * Current value of the option
     */
    value: {
      type: [String, Number, Boolean],
      default: null,
    },

    /**
     * All current option values for the plugin (for conditional visibility)
     */
    allValues: {
      type: Object,
      default: () => ({}),
    },
  },

  emits: ["update:value", "apiKeyValidated"],

  data() {
    return {
      showApiKey: false,
      apiKeyInputValue: "",
      apiKeyStatus: "idle", // idle, validating, valid, invalid, saved
      apiKeyError: "",
      validationTimeout: null,
    };
  },

  computed: {
    fieldId() {
      return `plugin-${this.pluginName}-${this.option.key}`;
    },

    /**
     * Determine if this field should be shown based on dependsOn condition
     */
    shouldShow() {
      if (!this.option.dependsOn) {
        return true;
      }

      const { key, value: expectedValue, negate } = this.option.dependsOn;
      const actualValue = this.allValues[key];
      const matches = actualValue === expectedValue;

      return negate ? !matches : matches;
    },

    /**
     * Get the current description, considering conditional descriptions
     */
    currentDescription() {
      if (this.option.conditionalDescription) {
        const { condition, description } = this.option.conditionalDescription;
        const actualValue = this.allValues[condition.key];
        if (actualValue === condition.value) {
          return description;
        }
      }
      return this.option.description;
    },

    apiKeyStatusClass() {
      return {
        "status-validating": this.apiKeyStatus === "validating",
        "status-valid": this.apiKeyStatus === "valid",
        "status-invalid": this.apiKeyStatus === "invalid",
        "status-saved": this.apiKeyStatus === "saved",
        "status-idle": this.apiKeyStatus === "idle",
      };
    },
  },

  watch: {
    value: {
      immediate: true,
      handler(newValue) {
        // If there's an existing value, show saved status
        if (this.option.type === "api-key" && newValue) {
          this.apiKeyStatus = "saved";
        }
      },
    },
  },

  mounted() {
    // Check if API key is already configured
    if (this.option.type === "api-key" && this.value) {
      this.apiKeyStatus = "saved";
    }
  },

  methods: {
    handleChange(newValue) {
      this.$emit("update:value", {
        pluginName: this.pluginName,
        option: this.option,
        value: newValue,
      });
    },

    toggleApiKeyVisibility() {
      this.showApiKey = !this.showApiKey;
    },

    handleApiKeyInput() {
      // Clear any pending validation
      if (this.validationTimeout) {
        clearTimeout(this.validationTimeout);
      }

      // Reset status when user is typing
      if (this.apiKeyInputValue.trim()) {
        this.apiKeyStatus = "idle";
        this.apiKeyError = "";

        // Debounce validation - validate 1 second after user stops typing
        this.validationTimeout = setTimeout(() => {
          this.validateApiKey();
        }, 1000);
      } else {
        this.apiKeyStatus = this.value ? "saved" : "idle";
      }
    },

    validateApiKeyOnBlur() {
      // Clear pending timeout
      if (this.validationTimeout) {
        clearTimeout(this.validationTimeout);
      }

      // Validate immediately on blur if there's input
      if (this.apiKeyInputValue.trim()) {
        this.validateApiKey();
      }
    },

    async validateApiKey() {
      const apiKey = this.apiKeyInputValue.trim();
      if (!apiKey) {
        return;
      }

      this.apiKeyStatus = "validating";
      this.apiKeyError = "";

      try {
        const result = await window.electronAPI.validatePluginApiKey(
          this.pluginName,
          apiKey,
        );

        if (result.valid) {
          this.apiKeyStatus = "valid";
          // Emit the change to update parent state
          this.$emit("update:value", {
            pluginName: this.pluginName,
            option: this.option,
            value: apiKey,
          });
          this.$emit("apiKeyValidated", {
            pluginName: this.pluginName,
            valid: true,
          });
          // Clear the input after successful save
          setTimeout(() => {
            this.apiKeyInputValue = "";
            this.apiKeyStatus = "saved";
          }, 1500);
        } else {
          this.apiKeyStatus = "invalid";
          this.apiKeyError = result.error || "Invalid API key";
          this.$emit("apiKeyValidated", {
            pluginName: this.pluginName,
            valid: false,
            error: result.error,
          });
        }
      } catch (error) {
        console.error("API key validation error:", error);
        this.apiKeyStatus = "invalid";
        this.apiKeyError = error.message || "Validation failed";
        this.$emit("apiKeyValidated", {
          pluginName: this.pluginName,
          valid: false,
          error: error.message,
        });
      }
    },
  },

  beforeUnmount() {
    if (this.validationTimeout) {
      clearTimeout(this.validationTimeout);
    }
  },
};
</script>

<style scoped>
.plugin-option {
  margin-bottom: var(--spacing-md, 16px);
  padding: var(--spacing-sm, 8px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-md, 6px);
  transition: all var(--transition-fast, 0.15s ease);
}

.plugin-option:last-child {
  margin-bottom: 0;
}

.plugin-option:hover {
  border-color: var(--color-border-secondary, #d0d0d0);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.plugin-option label {
  display: flex;
  align-items: center;
  font-size: var(--font-size-md, 13px);
  font-weight: var(--font-weight-medium, 500);
  color: var(--color-text-primary, #333333);
  margin-bottom: var(--spacing-sm, 8px);
  line-height: 1.3;
}

.field-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  margin-bottom: var(--spacing-sm, 8px);
  line-height: 1.4;
}

.form-control {
  width: 100%;
  max-width: 400px;
  padding: 6px 10px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-md, 13px);
  background: rgba(255, 255, 255, 0.08);
  transition: all var(--transition-fast, 0.15s ease);
  font-family: inherit;
  color: inherit;
}

.form-control:focus {
  outline: none;
  border-color: var(--color-border-focus, #007aff);
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
}

.form-control.is-valid {
  border-color: var(--color-success, #34c759);
}

.form-control.is-valid:focus {
  box-shadow: 0 0 0 2px rgba(52, 199, 89, 0.2);
}

.form-control.is-invalid {
  border-color: var(--color-error, #ff3b30);
}

.form-control.is-invalid:focus {
  box-shadow: 0 0 0 2px rgba(255, 59, 48, 0.2);
}

/* Textarea specific styles */
.form-control.textarea {
  max-width: 100%;
  min-height: 80px;
  resize: vertical;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: var(--font-size-sm, 12px);
  line-height: 1.5;
}

/* Checkbox */
.checkbox-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px) 0;
}

.checkbox-container label {
  display: flex;
  align-items: center;
  cursor: pointer;
  margin: 0;
  font-weight: var(--font-weight-medium, 500);
}

.checkbox {
  width: 18px;
  height: 18px;
  min-width: 18px;
  border: 2px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  position: relative;
  transition: all var(--transition-fast, 0.15s ease);
  margin: 0;
}

.checkbox:checked {
  background: var(--color-primary, #007aff);
  border-color: var(--color-primary, #007aff);
}

.checkbox:checked::after {
  content: "✓";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-inverse, #ffffff);
  font-weight: var(--font-weight-bold, 700);
}

.checkbox:hover {
  border-color: var(--color-border-focus, #007aff);
}

/* API Key Field */
.api-key-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.api-key-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  max-width: 400px;
}

.api-key-input-wrapper .ph-duotone.ph-key {
  color: var(--color-text-secondary, #666666);
  font-size: 16px;
  flex-shrink: 0;
}

.api-key-input-wrapper .form-control {
  flex: 1;
  max-width: none;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
}

.visibility-toggle {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, #666666);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm, 4px);
  transition: all var(--transition-fast, 0.15s ease);
}

.visibility-toggle:hover {
  color: var(--color-text-primary, #333333);
  background: rgba(255, 255, 255, 0.1);
}

.visibility-toggle .ph-duotone {
  font-size: 16px;
}

/* API Key Status Indicator */
.api-key-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  font-size: var(--font-size-xs, 11px);
  padding: var(--spacing-xs, 4px) 0;
}

.api-key-status .ph-duotone {
  font-size: 14px;
}

.api-key-status.status-idle {
  color: var(--color-text-tertiary, #999999);
}

.api-key-status.status-validating {
  color: var(--color-primary, #007aff);
}

.api-key-status.status-valid {
  color: var(--color-success, #34c759);
}

.api-key-status.status-invalid {
  color: var(--color-error, #ff3b30);
}

.api-key-status.status-saved {
  color: var(--color-success, #34c759);
}

/* Small spinner for API key validation */
.spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-primary, #007aff);
  border-top-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
