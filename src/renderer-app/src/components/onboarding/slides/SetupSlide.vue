<template>
  <div class="content">
    <div class="step-header">
      <span class="step-icn"><i class="ph-duotone ph-gear-six"></i></span>
      <h1>Ready to set up</h1>
    </div>
    <p class="micro">
      This will download the selected model for transcription.
    </p>
    <div class="progress">
      <div
        class="bar"
        :style="{ width: Math.max(0, Math.min(100, progressPercent)) + '%' }"
      ></div>
    </div>
    <div class="hint micro">{{ progressText }}</div>
    <div v-if="completionError" class="error-banner">
      <strong>Selected plugin can't be activated</strong>
      <div>{{ completionError }}</div>
    </div>
    <div class="logs" v-show="logs.length">
      <div class="logs-line" v-for="(line, i) in logs" :key="i">
        {{ line }}
      </div>
    </div>
    <div class="row">
      <button
        class="btn btn-primary"
        @click="$emit('run-setup')"
        :disabled="setupStarted"
      >
        Setup
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  progressPercent: Number,
  progressText: String,
  completionError: String,
  logs: Array,
  setupStarted: Boolean
})

defineEmits(['run-setup'])
</script>
