<template>
  <div class="ai-model-selector">
    <select v-if="loading" class="form-control" disabled>
      <option>Loading models...</option>
    </select>
    <select
      v-else-if="models && models.length > 0"
      class="form-control"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
      :disabled="disabled"
    >
      <option v-for="m in models" :key="m.id" :value="m.id">
        {{ m.name || m.id }}
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
  </div>
</template>

<script>
export default {
  name: "AiModelSelector",
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    models: {
      type: Array,
      default: () => [],
    },
    loading: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue"],
};
</script>

<style scoped>
.ai-model-selector {
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

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .form-control {
    background: rgba(255, 255, 255, 0.06);
    color: #ececec;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .form-control::placeholder {
    color: #666666;
  }

  .form-control:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .form-control:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #007aff;
    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.25);
  }

  .form-control:disabled {
    background: rgba(255, 255, 255, 0.02);
    color: #666666;
  }

  select.form-control option {
    background: #1c1c1e;
    color: #ececec;
  }
}
</style>
