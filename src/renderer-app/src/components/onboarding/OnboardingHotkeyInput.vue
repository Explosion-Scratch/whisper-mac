<template>
  <div class="hotkey-input-container">
    <div class="hotkey-input-wrapper" :class="{ focused: isFocused }">
      <input
        ref="inputRef"
        type="text"
        class="hotkey-input"
        :value="displayValue"
        @keydown="handleKeydown"
        @focus="handleFocus"
        @blur="handleBlur"
        :placeholder="placeholder"
        readonly
      />
      <button
        v-if="modelValue"
        type="button"
        class="hotkey-clear-btn"
        @click="clearHotkey"
        title="Clear hotkey"
      >
        <i class="ph-duotone ph-x"></i>
      </button>
    </div>
    <div class="hotkey-hint" v-if="isFocused">
      Press your desired key combination
    </div>
  </div>
</template>

<script>
import { useHotkeyCapture, formatHotkeyDisplay } from "../../composables/useHotkeyCapture.js";
import { ref, computed, watch } from "vue";

export default {
  name: "OnboardingHotkeyInput",

  props: {
    modelValue: {
      type: String,
      default: "",
    },
    placeholder: {
      type: String,
      default: "Click to set hotkey",
    },
  },

  emits: ["update:modelValue"],

  setup(props, { emit }) {
    const inputRef = ref(null);

    const {
      isFocused,
      isCapturing,
      currentHotkey,
      handleFocus: baseFocus,
      handleBlur: baseBlur,
      handleKeydown: baseKeydown,
      setHotkey,
    } = useHotkeyCapture({
      onCapture: (hotkey) => {
        emit("update:modelValue", hotkey);
      },
    });

    // Sync with external v-model
    watch(
      () => props.modelValue,
      (newVal) => {
        setHotkey(newVal);
      },
      { immediate: true }
    );

    const displayValue = computed(() => {
      return formatHotkeyDisplay(props.modelValue);
    });

    function handleFocus(event) {
      baseFocus();
    }

    function handleBlur(event) {
      baseBlur();
    }

    function handleKeydown(event) {
      baseKeydown(event);
    }

    function clearHotkey() {
      emit("update:modelValue", "");
      setHotkey("");
    }

    return {
      inputRef,
      isFocused,
      isCapturing,
      displayValue,
      handleFocus,
      handleBlur,
      handleKeydown,
      clearHotkey,
    };
  },
};
</script>

<style scoped>
.hotkey-input-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 280px;
}

.hotkey-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid var(--border, #e6e6e6);
  border-radius: 10px;
  padding: 4px;
  transition: all 0.2s ease;
}

.hotkey-input-wrapper.focused {
  border-color: var(--accent, #007aff);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
}

.hotkey-input {
  flex: 1;
  padding: 12px 16px;
  border: none;
  background: transparent;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", monospace;
  font-size: 14px;
  text-align: center;
  cursor: pointer;
  outline: none;
  color: var(--fg, #222222);
}

.hotkey-input::placeholder {
  color: var(--muted, #666666);
  font-family: inherit;
  font-style: normal;
}

.hotkey-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
  cursor: pointer;
  transition: all 0.15s ease;
}

.hotkey-clear-btn:hover {
  background: rgba(255, 59, 48, 0.2);
}

.hotkey-clear-btn i {
  font-size: 16px;
}

.hotkey-hint {
  font-size: 11px;
  color: var(--accent, #007aff);
  text-align: center;
  animation: pulse-hint 1.5s ease-in-out infinite;
}

@keyframes pulse-hint {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

@media (prefers-color-scheme: dark) {
  .hotkey-input-wrapper {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .hotkey-input-wrapper.focused {
    border-color: var(--accent, #007aff);
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.25);
  }

  .hotkey-input {
    color: #ececec;
  }

  .hotkey-input::placeholder {
    color: #888888;
  }

  .hotkey-clear-btn {
    background: rgba(255, 59, 48, 0.15);
  }

  .hotkey-clear-btn:hover {
    background: rgba(255, 59, 48, 0.25);
  }
}
</style>
