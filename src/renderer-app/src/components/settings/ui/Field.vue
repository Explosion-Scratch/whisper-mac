<template>
  <div class="form-group" :class="{ 'has-error': hasError }">
    <template v-if="!isHiddenLabel">
      <label>
        <i class="ph-duotone" :class="fieldIcon"></i>
        {{ field.label }}
      </label>
    </template>

    <div v-if="field.description" class="field-description">
      {{ field.description }}
    </div>

    <!-- Text Input -->
    <input
      v-if="field.type === 'text' && !isAiField"
      type="text"
      class="form-control"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      :placeholder="field.placeholder"
    />

    <!-- AI Fields (baseUrl, model) -->
    <AiField
      v-if="isAiField"
      :type="aiFieldType"
      :field="field"
      :modelValue="modelValue"
      :apiKeyInput="apiKeyInput"
      :aiModelsState="aiModelsState"
      @update:modelValue="$emit('update:modelValue', $event)"
      @update:apiKeyInput="$emit('update:apiKeyInput', $event)"
      @validateApiKey="$emit('validateApiKey')"
      @baseUrlChanged="$emit('baseUrlChanged')"
    />

    <!-- Number Input -->
    <input
      v-if="field.type === 'number'"
      type="number"
      class="form-control"
      :value="modelValue"
      @input="$emit('update:modelValue', parseFloat($event.target.value))"
      :min="field.min"
      :max="field.max"
      :step="field.step"
    />

    <!-- Boolean Checkbox -->
    <div v-if="field.type === 'boolean'" class="checkbox-container">
      <input
        type="checkbox"
        class="checkbox"
        :id="fieldId"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      <label :for="fieldId">
        <i class="ph-duotone" :class="fieldIcon"></i>
        {{ field.label }}
      </label>
    </div>

    <!-- Select Dropdown -->
    <select
      v-if="field.type === 'select' && !isAiField"
      class="form-control"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option v-for="option in field.options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>

    <!-- Textarea -->
    <textarea
      v-if="field.type === 'textarea'"
      class="form-control"
      rows="6"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      :placeholder="field.placeholder"
    ></textarea>

    <!-- Slider -->
    <div v-if="field.type === 'slider'" class="slider-container">
      <input
        type="range"
        class="slider"
        :value="modelValue"
        @input="$emit('update:modelValue', parseFloat($event.target.value))"
        :min="field.min"
        :max="field.max"
        :step="field.step"
      />
      <span class="slider-value">{{ modelValue }}</span>
    </div>

    <!-- Directory Picker -->
    <div v-if="field.type === 'directory'" class="directory-container">
      <input type="text" class="form-control directory-input" :value="modelValue" readonly />
      <button type="button" @click="$emit('browseDirectory')" class="btn btn-default directory-browse-btn">
        <i class="ph-duotone ph-folder-open"></i> Browse
      </button>
    </div>

    <!-- Hotkey Input -->
    <HotkeyField
      v-if="field.type === 'hotkey'"
      :modelValue="modelValue"
      :placeholder="field.placeholder"
      @update:modelValue="$emit('update:modelValue', $event)"
      @clear="$emit('clearHotkey')"
    />

    <!-- Validation Error -->
    <div class="validation-error" v-if="hasError">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script>
import AiField from "./fields/AiField.vue";
import HotkeyField from "./fields/HotkeyField.vue";

/**
 * Field Component
 * Generic settings field component that handles various input types
 * @component
 */
export default {
  name: "SettingsField",

  components: {
    AiField,
    HotkeyField,
  },

  props: {
    /**
     * The field schema object containing all field properties
     * { key, type, label, description, placeholder, options, min, max, step, icon }
     */
    field: {
      type: Object,
      required: true,
    },

    /**
     * The value of the field
     */
    modelValue: {
      type: [String, Number, Boolean, Array, Object],
      default: null,
    },

    /**
     * Validation errors object - keyed by field.key
     */
    validationErrors: {
      type: Object,
      default: () => ({}),
    },

    /**
     * API key input value (for AI fields)
     */
    apiKeyInput: {
      type: String,
      default: "",
    },

    /**
     * AI models state object { loading, loadedForBaseUrl, models }
     */
    aiModelsState: {
      type: Object,
      default: () => ({ loading: false, loadedForBaseUrl: null, models: [] }),
    },
  },

  emits: [
    "update:modelValue",
    "update:apiKeyInput",
    "validateApiKey",
    "baseUrlChanged",
    "browseDirectory",
    "clearHotkey",
  ],

  computed: {
    fieldId() {
      return `field-${this.field.key}`;
    },

    hasError() {
      return !!this.validationErrors[this.field.key];
    },

    errorMessage() {
      return this.validationErrors[this.field.key] || "";
    },

    isHiddenLabel() {
      return this.field.type === "boolean";
    },

    isAiField() {
      return this.field.key === "ai.baseUrl" || this.field.key === "ai.model";
    },

    aiFieldType() {
      if (this.field.key === "ai.baseUrl") return "baseUrl";
      if (this.field.key === "ai.model") return "model";
      return null;
    },

    fieldIcon() {
      if (this.field.icon) return this.field.icon;

      const iconMap = {
        text: "ph-text-t",
        number: "ph-hash",
        boolean: "ph-toggle-left",
        select: "ph-list",
        textarea: "ph-article",
        slider: "ph-sliders",
        directory: "ph-folder",
        hotkey: "ph-keyboard",
      };

      return iconMap[this.field.type] || "ph-gear";
    },
  },
};
</script>

<style scoped>
/* Form Group Container */
.form-group {
  margin-bottom: var(--spacing-md, 16px);
  padding: var(--spacing-sm, 8px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-md, 6px);
  transition: all var(--transition-fast, 0.15s ease);
  position: relative;
}

.form-group:hover {
  border-color: var(--color-border-secondary, #d0d0d0);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.form-group.has-error {
  border-color: var(--color-error, #ff3b30);
  background: rgba(255, 59, 48, 0.02);
}

.form-group label {
  display: flex;
  align-items: center;
  font-size: var(--font-size-md, 13px);
  font-weight: var(--font-weight-medium, 500);
  color: var(--color-text-primary, #333333);
  margin-bottom: var(--spacing-sm, 8px);
  line-height: 1.3;
}

.form-group label .ph-duotone {
  margin-right: var(--spacing-sm, 8px);
  font-size: var(--font-size-lg, 14px);
  color: var(--color-text-secondary, #666666);
  flex-shrink: 0;
}

.field-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  margin-bottom: var(--spacing-sm, 8px);
  line-height: 1.4;
}

/* Form Controls */
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

.form-control:disabled {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-tertiary, #999999);
  cursor: not-allowed;
}

.form-group.has-error .form-control {
  border-color: var(--color-error, #ff3b30);
}

.form-group.has-error .form-control:focus {
  box-shadow: 0 0 0 2px rgba(255, 59, 48, 0.2);
}

/* Textarea */
textarea.form-control {
  min-height: 80px;
  resize: vertical;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", monospace;
  line-height: 1.5;
}

/* Directory Input */
.directory-container {
  display: flex;
  gap: var(--spacing-sm, 8px);
  max-width: 400px;
}

.directory-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  cursor: not-allowed;
}

.directory-browse-btn {
  flex-shrink: 0;
  min-width: 80px;
}

/* Slider */
.slider-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-md, 16px);
  max-width: 400px;
}

.slider {
  flex: 1;
  appearance: none;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--color-border-primary, #e0e0e0);
  outline: none;
  transition: all var(--transition-fast, 0.15s ease);
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary, #007aff);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s ease);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.slider::-webkit-slider-thumb:hover {
  background: var(--color-primary-hover, #0056cc);
  transform: scale(1.1);
}

.slider-value {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
  min-width: 60px;
  text-align: right;
  font-family: "SF Mono", Monaco, monospace;
  font-weight: var(--font-weight-medium, 500);
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

/* Validation Error */
.validation-error {
  color: var(--color-error, #ff3b30);
  font-size: var(--font-size-sm, 12px);
  margin-top: var(--spacing-xs, 4px);
}

/* Button base styles for directory & hotkey buttons */
.btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-sm, 4px);
  background: rgba(255, 255, 255, 0.08);
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s ease);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs, 4px);
  min-height: 28px;
  text-decoration: none;
  color: var(--color-text-primary, #333333);
}

.btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--color-border-secondary, #d0d0d0);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.btn:active {
  transform: translateY(0);
  box-shadow: none;
}

.btn .ph-duotone {
  margin-right: var(--spacing-xs, 4px);
  font-size: var(--font-size-sm, 12px);
}
</style>
