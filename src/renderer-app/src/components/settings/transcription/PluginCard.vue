<template>
  <div class="plugin-card" :class="{ active: isActive }">
    <div class="plugin-header">
      <div class="plugin-info">
        <h4>{{ plugin.displayName }}</h4>
        <p class="plugin-description">{{ plugin.description }}</p>
      </div>
      <button
        v-if="!isActive"
        type="button"
        @click="$emit('clearData', plugin.name)"
        class="btn btn-negative btn-sm"
        title="Clear plugin data"
      >
        <i class="ph-duotone ph-trash"></i> Clear Data
      </button>
    </div>

    <div v-if="isActive" class="plugin-options">
      <PluginOption
        v-for="option in options"
        :key="option.key"
        :pluginName="plugin.name"
        :option="option"
        :value="getOptionValue(option.key)"
        @update:value="handleOptionChange"
      />
    </div>
  </div>
</template>

<script>
import PluginOption from "./PluginOption.vue";

/**
 * PluginCard Component
 * Renders a plugin configuration card with header and options
 * @component
 */
export default {
  name: "PluginCard",

  components: {
    PluginOption,
  },

  props: {
    /**
     * Plugin info object { name, displayName, description }
     */
    plugin: {
      type: Object,
      required: true,
    },

    /**
     * Plugin options schema array
     */
    options: {
      type: Array,
      default: () => [],
    },

    /**
     * Current settings values for this plugin
     */
    settings: {
      type: Object,
      default: () => ({}),
    },

    /**
     * Whether this plugin is currently active
     */
    isActive: {
      type: Boolean,
      default: false,
    },
  },

  emits: ["optionChange", "clearData"],

  methods: {
    getOptionValue(key) {
      return this.settings?.[key];
    },

    handleOptionChange(payload) {
      this.$emit("optionChange", payload);
    },
  },
};
</script>

<style scoped>
.plugin-card {
  margin-top: var(--spacing-md, 16px);
  padding: var(--spacing-md, 16px);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-lg, 8px);
  background: var(--color-bg-secondary, rgba(255, 255, 255, 0.03));
  transition: var(--transition-fast, 0.15s ease);
}

.plugin-card:hover {
  border-color: var(--color-border-secondary, #d0d0d0);
}

.plugin-card.active {
  border-color: var(--color-primary, #007aff);
  background: rgba(0, 122, 255, 0.03);
}

.plugin-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-md, 16px);
}

.plugin-info h4 {
  margin: 0 0 var(--spacing-xs, 4px) 0;
  font-size: var(--font-size-lg, 14px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #333333);
}

.plugin-description {
  margin: 0;
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary, #666666);
}

.plugin-options {
  margin-top: var(--spacing-sm, 8px);
}

/* Button styles */
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

.btn-negative {
  background: var(--color-error, #ff3b30);
  color: var(--color-text-inverse, #ffffff);
  border-color: var(--color-error, #ff3b30);
}

.btn-negative:hover {
  background: #d70015;
  border-color: #d70015;
}

.btn-sm {
  padding: 4px 8px;
  font-size: var(--font-size-xs, 11px);
  min-height: 24px;
}

.btn .ph-duotone {
  font-size: var(--font-size-sm, 12px);
}
</style>
