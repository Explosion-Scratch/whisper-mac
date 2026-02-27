<template>
  <div class="content">
    <div class="step-header">
      <span class="step-icn"><i class="ph-duotone ph-sparkle"></i></span>
      <h1>Enable AI polishing?</h1>
    </div>
    <div class="toggle">
      <input
        id="aiEnabled"
        type="checkbox"
        :checked="aiEnabled"
        @change="$emit('update:aiEnabled', $event.target.checked); $emit('ai-enabled-change')"
      />
      <label for="aiEnabled">Use AI to clean up and format dictation</label>
    </div>
    <div
      v-if="aiValidationError"
      class="error-message"
      style="color: #ef4444; font-size: 14px; margin-top: 8px"
    >
      {{ aiValidationError }}
    </div>
    <div class="card" v-show="aiEnabled">
      <div class="form-grid">
        <div class="field">
          <div class="label">API Base URL</div>
          <input
            class="input"
            placeholder="e.g. https://api.example.com/v1"
            :value="aiBaseUrl"
            @input="$emit('update:aiBaseUrl', $event.target.value)"
          />
        </div>
        <div class="field">
          <AiModelSelector
            :modelValue="aiModel"
            @update:modelValue="$emit('update:aiModel', $event)"
            :models="aiModels"
            :loading="savingKey"
          />
        </div>
      </div>
      <div
        class="form-row"
        style="margin-top: 8px; display: flex; gap: 10px; align-items: center;"
      >
        <div class="field" style="flex: 1">
          <div class="label">API Key</div>
          <input
            class="input"
            placeholder="Paste your API key (stored securely)"
            :value="aiApiKey"
            @input="$emit('update:aiApiKey', $event.target.value)"
          />
        </div>
        <button
          class="btn btn-primary"
          @click="$emit('save-key')"
          style="margin-top: 24px"
        >
          <span v-if="savingKey" class="spinner" aria-hidden="true"></span>
          <span v-else>Save Key</span>
        </button>
      </div>
      <div class="hint" style="margin-top: 6px">{{ keyStatus }}</div>
    </div>
  </div>
</template>

<script setup>
import AiModelSelector from "../../AiModelSelector.vue"

defineProps({
  aiEnabled: Boolean,
  aiValidationError: String,
  aiBaseUrl: String,
  aiModel: String,
  aiModels: Array,
  savingKey: Boolean,
  aiApiKey: String,
  keyStatus: String
})

defineEmits([
  'update:aiEnabled',
  'update:aiBaseUrl',
  'update:aiModel',
  'update:aiApiKey',
  'ai-enabled-change',
  'save-key'
])
</script>
