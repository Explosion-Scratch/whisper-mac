<template>
  <div
    class="hotkey-input-wrapper"
    :class="{ focused: isFocused }"
    @click="$refs.inputRef.focus()"
  >
    <input
      ref="inputRef"
      type="text"
      class="hotkey-input"
      :value="displayValue"
      @keydown="handleKeydown"
      @focus="handleFocus"
      @blur="handleBlur"
      :placeholder="isFocused ? 'Press keys...' : placeholder"
      readonly
    />
    <button
      v-if="modelValue"
      type="button"
      class="hotkey-clear-btn"
      @click.stop="clearHotkey"
      title="Clear"
    >
      <i class="ph-duotone ph-x"></i>
    </button>
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
.hotkey-input-wrapper {
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border, #e6e6e6);
  border-radius: 6px;
  padding: 0 4px 0 0;
  transition: all 0.2s ease;
  cursor: pointer;
}

.hotkey-input-wrapper.focused {
  border-color: var(--accent, #007aff);
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.12);
}

.hotkey-input {
  width: 80px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", monospace;
  font-size: 12px;
  text-align: center;
  cursor: pointer;
  outline: none;
  color: var(--fg, #222222);
}

.hotkey-input::placeholder {
  color: var(--muted, #888888);
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 10px;
}

.hotkey-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: rgba(255, 59, 48, 0.12);
  color: #ff3b30;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.hotkey-clear-btn:hover {
  background: rgba(255, 59, 48, 0.22);
}

.hotkey-clear-btn i {
  font-size: 10px;
}

@media (prefers-color-scheme: dark) {
  .hotkey-input-wrapper {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .hotkey-input-wrapper.focused {
    border-color: var(--accent, #007aff);
    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
  }

  .hotkey-input {
    color: #ececec;
  }

  .hotkey-input::placeholder {
    color: #777777;
  }

  .hotkey-clear-btn {
    background: rgba(255, 59, 48, 0.18);
  }

  .hotkey-clear-btn:hover {
    background: rgba(255, 59, 48, 0.28);
  }
}
</style>
