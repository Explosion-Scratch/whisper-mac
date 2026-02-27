<template>
  <div class="content">
    <div class="step-header">
      <span class="step-icn"><i class="ph-duotone ph-download-simple"></i></span>
      <h1>Choose transcription engine</h1>
    </div>
    <div class="card" style="width: 100%">
      <div class="field">
        <div class="label">Plugin</div>
        <select
          class="select"
          :value="pluginSelect"
          @change="$emit('update:pluginSelect', $event.target.value); $emit('plugin-change')"
        >
          <option
            v-for="plugin in availablePlugins"
            :key="plugin.name"
            :value="plugin.name"
          >
            {{ plugin.displayName }}
          </option>
        </select>
      </div>

      <!-- Dynamic plugin options -->
      <div
        v-for="option in currentPluginOptions"
        :key="option.key"
        class="field"
        style="margin-top: 10px"
      >
        <div class="label">{{ option.label }}</div>

        <!-- Model select with enhanced display -->
        <select
          v-if="option.type === 'model-select'"
          class="select"
          :value="selectedOptions[option.key] || option.default"
          @change="$emit('update-option', option.key, $event.target.value)"
        >
          <option
            v-for="modelOpt in option.options"
            :key="modelOpt.value"
            :value="modelOpt.value"
          >
            {{ modelOpt.label }}{{ modelOpt.size ? ` (${modelOpt.size})` : "" }}
          </option>
        </select>

        <!-- Regular select -->
        <select
          v-else-if="option.type === 'select'"
          class="select"
          :value="selectedOptions[option.key] || option.default"
          @change="$emit('update-option', option.key, $event.target.value)"
        >
          <option
            v-for="selectOpt in option.options"
            :key="selectOpt.value"
            :value="selectOpt.value"
          >
            {{ selectOpt.label }}
          </option>
        </select>

        <!-- Boolean checkbox -->
        <label v-else-if="option.type === 'boolean'" class="toggle">
          <input
            type="checkbox"
            :checked="selectedOptions[option.key] || option.default"
            @change="$emit('update-option', option.key, $event.target.checked)"
          />
          {{ option.description }}
        </label>

        <!-- Number input -->
        <input
          v-else-if="option.type === 'number'"
          type="number"
          class="input"
          :value="selectedOptions[option.key] || option.default"
          :min="option.min"
          :max="option.max"
          @input="$emit('update-option', option.key, parseInt($event.target.value))"
        />

        <!-- Text input -->
        <input
          v-else
          type="text"
          class="input"
          :value="selectedOptions[option.key] || option.default"
          @input="$emit('update-option', option.key, $event.target.value)"
        />

        <div v-if="option.description" class="hint" style="margin-top: 6px">
          {{ option.description }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  pluginSelect: String,
  availablePlugins: Array,
  currentPluginOptions: Array,
  selectedOptions: Object
})

defineEmits(['update:pluginSelect', 'plugin-change', 'update-option'])
</script>
