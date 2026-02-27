<template>
  <div class="content hotkey-content">
    <div class="step-header compact">
      <span class="step-icn small"><i class="ph-duotone ph-keyboard"></i></span>
      <h1>Set your hotkey</h1>
    </div>
    <p class="micro">
      Choose how you want to trigger dictation.
    </p>

    <!-- Mode Selection Cards - Compact -->
    <div class="hotkey-mode-cards compact">
      <div
        class="hotkey-mode-card compact"
        :class="{ active: hotkeyMode === 'toggle' }"
        @click="$emit('update:hotkeyMode', 'toggle')"
      >
        <div class="mode-icon small">
          <i class="ph-duotone ph-play-pause"></i>
        </div>
        <div class="mode-content">
          <h3>Start / Stop</h3>
          <p>Press once to start, again to stop</p>
        </div>
        <div class="mode-check" v-if="hotkeyMode === 'toggle'">
          <i class="ph-fill ph-check-circle"></i>
        </div>
      </div>

      <div
        class="hotkey-mode-card compact"
        :class="{ active: hotkeyMode === 'push' }"
        @click="$emit('update:hotkeyMode', 'push')"
      >
        <div class="mode-icon small">
          <i class="ph-duotone ph-hand-pointing"></i>
        </div>
        <div class="mode-content">
          <h3>Push to Talk</h3>
          <p>Hold to record, release to stop</p>
        </div>
        <div class="mode-check" v-if="hotkeyMode === 'push'">
          <i class="ph-fill ph-check-circle"></i>
        </div>
      </div>
    </div>

    <!-- Hotkey Input - Inline -->
    <div class="hotkey-config-section compact">
      <div class="hotkey-label">
        <i class="ph-duotone ph-command"></i>
        <span>{{ hotkeyMode === "toggle" ? "Hotkey" : "Key" }}</span>
      </div>
      <OnboardingHotkeyInput
        :modelValue="currentHotkey"
        @update:modelValue="$emit('update:currentHotkey', $event)"
        :placeholder="hotkeyMode === 'toggle' ? 'e.g. ⌃ D' : 'e.g. ⌥ /'"
      />
      <button
        v-if="!currentHotkey"
        class="suggestion-btn"
        @click="$emit('apply-suggested')"
        :title="hotkeyMode === 'toggle' ? 'Use Control+D' : 'Use Alt+/'"
      >
        {{ hotkeyMode === "toggle" ? "⌃ D" : "⌥ /" }}
      </button>
    </div>
  </div>
</template>

<script setup>
import OnboardingHotkeyInput from "../OnboardingHotkeyInput.vue"

defineProps({
  hotkeyMode: String,
  currentHotkey: String
})

defineEmits(['update:hotkeyMode', 'update:currentHotkey', 'apply-suggested'])
</script>
