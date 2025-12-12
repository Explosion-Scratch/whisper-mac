<template>
  <div class="api-key-field">
    <label :for="inputId">
      <i class="ph-duotone ph-key"></i>
      {{ label }}
      <span v-if="loading" class="spinner"></span>
    </label>
    <input
      type="password"
      class="form-control"
      :id="inputId"
      :value="modelValue"
      @input="handleInput"
      @keyup="$emit('validate')"
      :placeholder="placeholder"
    />
  </div>
</template>

<script>
/**
 * ApiKeyField Component
 * Handles secure API key input with validation indicator
 * @component
 */
export default {
  name: "ApiKeyField",

  props: {
    /**
     * The current API key value
     */
    modelValue: {
      type: String,
      default: "",
    },

    /**
     * Label for the input
     */
    label: {
      type: String,
      default: "API Key (saved securely)",
    },

    /**
     * Placeholder text
     */
    placeholder: {
      type: String,
      default: "Paste API Key to validate & load models",
    },

    /**
     * Whether validation is in progress
     */
    loading: {
      type: Boolean,
      default: false,
    },

    /**
     * Unique ID for the input (for label association)
     */
    inputId: {
      type: String,
      default: "apiKeyInput",
    },
  },

  emits: ["update:modelValue", "validate"],

  methods: {
    handleInput(event) {
      this.$emit("update:modelValue", event.target.value);
    },
  },
};
</script>

<style scoped>
.api-key-field {
  margin-top: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-md, 6px);
}

.api-key-field label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--font-weight-medium, 500);
  font-size: var(--font-size-md, 13px);
  color: var(--color-text-primary, rgba(255, 255, 255, 0.9));
  margin-bottom: var(--spacing-sm, 8px);
}

.api-key-field label .ph-duotone {
  font-size: 14px;
  color: var(--color-text-secondary, #666666);
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.spinner {
  margin-left: 8px;
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-text-secondary, rgba(255, 255, 255, 0.6));
  border-top-color: var(--color-primary, #007aff);
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.9s linear infinite;
}
</style>
