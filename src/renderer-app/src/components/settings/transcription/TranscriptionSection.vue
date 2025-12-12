<template>
  <div class="transcription-section" v-if="hasPlugins">
    <!-- Active Plugin Selector -->
    <div class="form-group">
      <label>
        <i class="ph-duotone ph-plugs-connected"></i>
        Active Plugin
      </label>
      <select
        class="form-control"
        :value="activePlugin"
        @change="handlePluginChange($event.target.value)"
      >
        <option v-for="plugin in plugins" :key="plugin.name" :value="plugin.name">
          {{ plugin.displayName }}
        </option>
      </select>
    </div>

    <!-- Plugin Cards -->
    <PluginCard
      v-for="plugin in plugins"
      :key="plugin.name"
      :plugin="plugin"
      :options="getPluginOptions(plugin.name)"
      :settings="getPluginSettings(plugin.name)"
      :isActive="activePlugin === plugin.name"
      @optionChange="handleOptionChange"
      @clearData="handleClearData"
    />
  </div>
</template>

<script>
import PluginCard from "./PluginCard.vue";

/**
 * TranscriptionSection Component
 * Main component for the transcription plugin configuration section
 * @component
 */
export default {
  name: "TranscriptionSection",

  components: {
    PluginCard,
  },

  props: {
    /**
     * Plugin data object { plugins: [], schemas: {} }
     */
    pluginData: {
      type: Object,
      required: true,
    },

    /**
     * Current active plugin name
     */
    activePlugin: {
      type: String,
      required: true,
    },

    /**
     * Settings object containing plugin settings
     */
    settings: {
      type: Object,
      required: true,
    },
  },

  emits: ["pluginChange", "optionChange", "modelChange", "clearData"],

  computed: {
    hasPlugins() {
      return this.pluginData?.plugins?.length > 0;
    },

    plugins() {
      return this.pluginData?.plugins || [];
    },
  },

  methods: {
    getPluginOptions(pluginName) {
      return this.pluginData?.schemas?.[pluginName] || [];
    },

    getPluginSettings(pluginName) {
      return this.settings?.plugin?.[pluginName] || {};
    },

    handlePluginChange(newPlugin) {
      this.$emit("pluginChange", newPlugin);
    },

    handleOptionChange(payload) {
      const { pluginName, option, value } = payload;

      if (option.type === "model-select") {
        this.$emit("modelChange", { pluginName, optionKey: option.key, value });
      } else {
        this.$emit("optionChange", { pluginName, optionKey: option.key, value });
      }
    },

    handleClearData(pluginName) {
      this.$emit("clearData", pluginName);
    },
  },
};
</script>

<style scoped>
.transcription-section {
  margin-top: var(--spacing-md, 16px);
}

/* Form group for active plugin selector */
.form-group {
  margin-bottom: var(--spacing-md, 16px);
  padding: var(--spacing-sm, 8px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-primary, #e0e0e0);
  border-radius: var(--radius-md, 6px);
  transition: all var(--transition-fast, 0.15s ease);
}

.form-group:hover {
  border-color: var(--color-border-secondary, #d0d0d0);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.05));
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
</style>
