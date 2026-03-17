<template>
  <div class="content">
    <div class="step-header">
      <span class="step-icn">
        <i :class="iconClass"></i>
      </span>
      <h1>{{ title }}</h1>
    </div>
    <p class="micro">{{ description }}</p>
    <div class="row">
      <button class="btn" @click="$emit('check')" :disabled="isChecking">
        Check permission
      </button>
      <div v-if="isChecking" class="spinner" aria-hidden="true"></div>
      <span
        class="hint permission-status"
        :class="{
          'permission-status-ok': status === 'Enabled',
          'permission-status-fail': status !== 'Enabled' && status !== 'Not checked yet' && status !== 'Checking...',
        }"
      >
        <i v-if="status === 'Enabled'" class="ph-fill ph-check-circle"></i>
        {{ status }}
      </span>
    </div>
    <div class="card" v-if="status !== 'Enabled'">
      <div class="hint">
        <strong>Required:</strong> {{ requiredMessage }}
      </div>
      <div v-if="showHelp" class="row perm-help-actions">
        <button
          class="btn"
          @click="$emit('open-settings')"
        >
          Open System Settings
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  iconClass: String,
  title: String,
  description: String,
  requiredMessage: String,
  isChecking: Boolean,
  status: String,
  showHelp: Boolean
})

defineEmits(['check', 'open-settings'])
</script>
