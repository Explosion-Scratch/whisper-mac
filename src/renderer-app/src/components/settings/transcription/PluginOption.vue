<template>
  <div class="plugin-option">
    <label v-if="option.type !== 'boolean'">{{ option.label }}</label>
    <div v-if="option.description" class="field-description">
      {{ option.description }}
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
 * Renders a single plugin configuration option (select, checkbox, number, text)
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
     * Option schema object { key, type, label, description, options, min, max, step, default }
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
  },

  emits: ["update:value"],

  computed: {
    fieldId() {
      return `plugin-${this.pluginName}-${this.option.key}`;
    },
  },

  methods: {
    handleChange(newValue) {
      this.$emit("update:value", {
        pluginName: this.pluginName,
        option: this.option,
        value: newValue,
      });
    },
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
</style>
