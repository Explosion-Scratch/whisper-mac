<template>
  <div
    class="ai-field"
    :class="{
      'ai-field--base-url': type === 'baseUrl',
      'ai-field--model': type === 'model',
      'is-disabled': disabled,
    }"
  >
    <template v-if="type === 'baseUrl'">
      <input
        type="text"
        class="form-control"
        :value="modelValue"
        @input="handleBaseUrlInput"
        :placeholder="field.placeholder"
        :disabled="disabled"
      />
      <ApiKeyField
        :modelValue="apiKeyInput"
        :loading="aiModelsState.loading"
        :disabled="disabled"
        @update:modelValue="$emit('update:apiKeyInput', $event)"
        @validate="$emit('validateApiKey')"
      />
    </template>

    <template v-else-if="type === 'model'">
      <select v-if="aiModelsState.loading" class="form-control" disabled>
        <option>Loading models...</option>
      </select>
      <select
        v-else-if="aiModelsState.models.length > 0"
        class="form-control"
        :value="modelValue"
        @change="$emit('update:modelValue', $event.target.value)"
        :disabled="disabled"
      >
        <option
          v-for="model in aiModelsState.models"
          :key="model.id"
          :value="model.id"
        >
          {{ model.name || model.id }}
        </option>
      </select>
      <input
        v-else
        type="text"
        class="form-control"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
        placeholder="Enter model name or validate API key"
        :disabled="disabled"
      />
    </template>
  </div>
</template>

<script>
import ApiKeyField from "./ApiKeyField.vue";

/**
 * AiField Component
 * Handles AI-specific fields like baseUrl and model selection
 * @component
 */
export default {
  name: "AiField",

  components: {
    ApiKeyField,
  },

  props: {
    /**
     * Field type - 'baseUrl' or 'model'
     */
    type: {
      type: String,
      required: true,
      validator: (value) => ["baseUrl", "model"].includes(value),
    },

    /**
     * The field schema object
     */
    field: {
      type: Object,
      required: true,
    },

    /**
     * The value of the field
     */
    modelValue: {
      type: String,
      default: "",
    },

    /**
     * API key input value (used with baseUrl type)
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

    /**
     * Whether the field is disabled
     */
    disabled: {
      type: Boolean,
      default: false,
    },
  },

  emits: [
    "update:modelValue",
    "update:apiKeyInput",
    "validateApiKey",
    "baseUrlChanged",
  ],

  methods: {
    handleBaseUrlInput(event) {
      this.$emit("update:modelValue", event.target.value);
      this.$emit("baseUrlChanged");
    },
  },
};
</script>

<style scoped>
.ai-field {
  width: 100%;
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

.form-control:disabled {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-tertiary, #999999);
  cursor: not-allowed;
  opacity: 0.6;
}

.ai-field.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}
</style>
