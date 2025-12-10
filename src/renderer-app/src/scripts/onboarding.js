import { ref, computed, onMounted, nextTick } from "vue";

export default {
  setup() {
    const idx = ref(0);
const accessStatus = ref("Not checked yet");
const isCheckingAccess = ref(false);
const showAccessibilityHelp = ref(false);
const microphoneStatus = ref("Not checked yet");
const isCheckingMicrophone = ref(false);
const showMicrophoneHelp = ref(false);
const aiEnabled = ref(false);
const aiBaseUrl = ref("");
const aiModel = ref("");
const aiModels = ref([]);
const aiApiKey = ref("");
const keyStatus = ref("");
const savingKey = ref(false);
const aiValidationError = ref("");
const pluginSelect = ref("yap");
const pluginOptions = ref({});
const pluginStates = ref({});
const selectedOptions = ref({});
const progressText = ref("Idle");
const progressPercent = ref(0);
const logs = ref([]);
const setupStarted = ref(false);
const setupDone = ref(false);
const completionError = ref("");

const nextLabel = computed(() =>
  idx.value === 5
    ? completionError.value
      ? "Plugin unavailable – back to plugins"
      : "Finish"
    : "Next",
);

const canProceed = computed(() => {
  // On accessibility step (idx === 1), check if permissions are enabled
  if (idx.value === 1) {
    return accessStatus.value === "Enabled";
  }
  // On microphone step (idx === 2), check if permissions are enabled
  if (idx.value === 2) {
    return microphoneStatus.value === "Enabled";
  }
  // On AI step (idx === 4), check if AI is properly configured when enabled
  if (idx.value === 4) {
    if (aiEnabled.value && aiValidationError.value) {
      return false;
    }
  }
  // On setup step (idx === 5), check if setup is done
  if (idx.value === 5) {
    return completionError.value ? true : setupDone.value;
  }
  // All other steps can proceed
  return true;
});

const availablePlugins = ref([]);
const currentPluginOptions = ref([]);

const getSelectedPluginDisplayName = () => {
  const active = availablePlugins.value.find(
    (plugin) => plugin.name === pluginSelect.value,
  );
  return active?.displayName || pluginSelect.value;
};

const resetSetupState = (options = { preserveLogs: false }) => {
  setupStarted.value = false;
  setupDone.value = false;
  progressText.value = "Idle";
  progressPercent.value = 0;
  if (!options.preserveLogs) {
    logs.value = [];
  }
  completionError.value = "";
};

const init = async () => {
  const initState = await window.onboardingAPI.getInitialState();
  aiBaseUrl.value = initState.ai.baseUrl || "";
  aiModel.value = initState.ai.model || "";
  aiEnabled.value = !!initState.ai.enabled;
  pluginSelect.value = initState.plugin || pluginSelect.value;

  // Load plugin information
  try {
    const pluginData = await window.onboardingAPI.getPluginSchemas();
    if (!pluginData || !pluginData.plugins || !pluginData.schemas) {
      console.error("Invalid plugin data structure received:", pluginData);
      throw new Error("Failed to load plugin schemas");
    }

    availablePlugins.value = pluginData.plugins || [];
    pluginOptions.value = pluginData.schemas || {};

    // Set default options for each plugin
    for (const [pluginName, options] of Object.entries(pluginOptions.value)) {
      selectedOptions.value[pluginName] = {};
      for (const option of options) {
        selectedOptions.value[pluginName][option.key] = option.default;
      }
    }

    // Load current plugin options
    updateCurrentPluginOptions();
  } catch (error) {
    console.error("Failed to load plugin schemas:", error);
    // Set fallback values
    availablePlugins.value = [];
    pluginOptions.value = {};
  }
};

const updateCurrentPluginOptions = () => {
  if (!pluginOptions.value || !pluginOptions.value[pluginSelect.value]) {
    console.warn(`No options found for plugin: ${pluginSelect.value}`);
    currentPluginOptions.value = [];
    return;
  }
  currentPluginOptions.value = pluginOptions.value[pluginSelect.value] || [];
};

const onPluginChange = () => {
  try {
    updateCurrentPluginOptions();
    resetSetupState();
  } catch (error) {
    console.error("Error updating plugin options:", error);
    currentPluginOptions.value = [];
  }
};

const updateSelectedOption = (key, value) => {
  try {
    if (!selectedOptions.value[pluginSelect.value]) {
      selectedOptions.value[pluginSelect.value] = {};
    }
    selectedOptions.value[pluginSelect.value][key] = value;
  } catch (error) {
    console.error("Error updating selected option:", error);
  }
};

const prev = () => {
  if (setupStarted.value) return;
  if (idx.value > 0) idx.value -= 1;
  if (idx.value < 5) {
    completionError.value = "";
  }
};

const next = async () => {
  // Check accessibility permissions before allowing progression from step 1
  if (idx.value === 1) {
    // Reset cache to ensure we get fresh results
    console.log("Renderer:onboarding next() accessibility check start");
    await window.onboardingAPI.resetAccessibilityCache();
    const t0 = Date.now();
    const hasAccess = await window.onboardingAPI.checkAccessibility();
    console.log(
      "Renderer:onboarding next() accessibility check result",
      JSON.stringify({ hasAccess, durationMs: Date.now() - t0 }),
    );
    if (!hasAccess) {
      accessStatus.value = "Please enable accessibility permissions first";
      return;
    }
  }

  // Check microphone permissions before allowing progression from step 2
  if (idx.value === 2) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Immediately stop all tracks to release the microphone
      stream.getTracks().forEach((track) => {
        track.stop();
      });
    } catch (error) {
      microphoneStatus.value = "Please enable microphone permissions first";
      return;
    }
  }

  if (idx.value === 5 && !setupDone.value) return;
  if (idx.value === 5 && completionError.value) {
    resetSetupState();
    idx.value = 3;
    return;
  }
  if (idx.value === 3) {
    const currentOptions = selectedOptions.value[pluginSelect.value] || {};
    // Convert Vue reactive object to plain object to avoid cloning errors
    const plainOptions = JSON.parse(JSON.stringify(currentOptions));
    try {
      await window.onboardingAPI.setPlugin(pluginSelect.value, plainOptions);
    } catch (error) {
      console.error("Failed to set plugin options:", error);
      // Continue with the flow even if plugin options setting fails
    }
  }
  if (idx.value === 4) {
    // If AI is enabled, validate configuration before proceeding
    if (aiEnabled.value) {
      const result = await window.electronAPI.validateAiConfiguration(
        aiBaseUrl.value,
        aiModel.value,
        aiApiKey.value,
      );

      if (!result.isValid) {
        aiValidationError.value = result.error || "AI configuration is invalid";
        return;
      }
    }

    await window.onboardingAPI.setAiEnabled(aiEnabled.value);
    if (aiEnabled.value) {
      await window.onboardingAPI.setAiProvider(aiBaseUrl.value, aiModel.value);
    }
  }
  if (idx.value < 5) {
    idx.value += 1;
  } else {
    try {
      const result = await window.onboardingAPI.complete();
      if (!result?.success) {
        const pluginLabel = getSelectedPluginDisplayName();
        const detail = result?.error
          ? `${pluginLabel}: ${result.error}`
          : `${pluginLabel} can't be activated right now.`;
        completionError.value = detail;
        return;
      }
    } catch (error) {
      const pluginLabel = getSelectedPluginDisplayName();
      const message =
        error?.message ||
        error?.toString?.() ||
        "The selected plugin could not be activated.";
      completionError.value = `${pluginLabel}: ${message}`;
      return;
    }
  }
};

const checkAccess = async () => {
  isCheckingAccess.value = true;
  accessStatus.value = "Checking...";
  // Reset cache to ensure we get fresh results
  console.log("Renderer:onboarding checkAccess() start");
  await window.onboardingAPI.resetAccessibilityCache();
  const t0 = Date.now();
  const ok = await window.onboardingAPI.checkAccessibility();
  console.log(
    "Renderer:onboarding checkAccess() result",
    JSON.stringify({ ok, durationMs: Date.now() - t0 }),
  );
  if (ok) {
    accessStatus.value = "Enabled";
    showAccessibilityHelp.value = false;
  } else {
    accessStatus.value = "Please grant accessibility permissions";
    // Show options to open system preferences or settings
    showAccessibilityHelp.value = true;
  }
  isCheckingAccess.value = false;
};

const checkMicrophone = async () => {
  isCheckingMicrophone.value = true;
  microphoneStatus.value = "Checking...";
  try {
    // Test microphone access directly in the renderer process
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Immediately stop all tracks to release the microphone
    stream.getTracks().forEach((track) => {
      track.stop();
    });

    microphoneStatus.value = "Enabled";
    showMicrophoneHelp.value = false;
  } catch (error) {
    console.error("Microphone permission denied:", error);
    microphoneStatus.value = "Please grant microphone permissions";
    // Show options to open system preferences or settings
    showMicrophoneHelp.value = true;
    // Also try the main process check to show system dialog
    await window.onboardingAPI.checkMicrophone();
  }
  isCheckingMicrophone.value = false;
};

const saveKey = async () => {
  try {
    savingKey.value = true;
    keyStatus.value = "Validating...";
    // Validate key by calling provider /models via settings bridge
    const result = await window.electronAPI.validateApiKeyAndListModels(
      aiBaseUrl.value,
      aiApiKey.value,
    );
    if (!result?.success) {
      keyStatus.value = `Validation failed: ${
        result?.error || "Unknown error"
      }`;
      savingKey.value = false;
      return;
    }
    aiModels.value = result.models || [];
    if (aiModels.value.length && !aiModel.value) {
      aiModel.value = aiModels.value[0].id;
    }
    await window.onboardingAPI.saveApiKey(aiApiKey.value);
    keyStatus.value = "Saved to Keychain";
    aiApiKey.value = "";

    // Clear validation error since key is now valid
    aiValidationError.value = "";
  } catch (e) {
    keyStatus.value = "Failed to save key";
  } finally {
    savingKey.value = false;
  }
};

const validateAiConfig = async () => {
  if (aiEnabled.value) {
    aiValidationError.value = "";

    try {
      const result = await window.electronAPI.validateAiConfiguration(
        aiBaseUrl.value,
        aiModel.value,
        aiApiKey.value,
      );

      if (!result.isValid) {
        aiValidationError.value = result.error || "AI configuration is invalid";
        aiEnabled.value = false; // Revert the toggle
        return;
      }

      // If validation succeeds and we have models, update the model list
      if (result.models && result.models.length > 0) {
        aiModels.value = result.models;
        // If current model is not in the list, select the first one
        if (!result.models.some((m) => m.id === aiModel.value)) {
          aiModel.value = result.models[0].id;
        }
      }
    } catch (error) {
      aiValidationError.value = `Validation failed: ${
        error.message || String(error)
      }`;
      aiEnabled.value = false; // Revert the toggle
    }
  } else {
    // Clear validation error when disabling AI
    aiValidationError.value = "";
  }
};

const onAiEnabledChange = async () => {
  await validateAiConfig();
};

const runSetup = async () => {
  progressText.value = "Starting...";
  setupStarted.value = true;
  setupDone.value = false;
  completionError.value = "";
  await window.onboardingAPI.runSetup();
};

const openSystemPreferences = async (type) => {
  try {
    await window.onboardingAPI.openSystemPreferences(type);
  } catch (error) {
    console.error(`Failed to open ${type} preferences:`, error);
  }
};

const openSettings = async (section) => {
  try {
    await window.onboardingAPI.openSettings(section);
  } catch (error) {
    console.error(`Failed to open settings for ${section}:`, error);
  }
};

onMounted(() => {
  init();

  // Add watchers for AI configuration changes
  const aiBaseUrlInput = document.getElementById("aiBaseUrl");
  const aiModelSelect = document.getElementById("aiModelSelect");

  if (aiBaseUrlInput) {
    aiBaseUrlInput.addEventListener("input", () => {
      if (aiEnabled.value) {
        validateAiConfig();
      }
    });
  }

  if (aiModelSelect) {
    aiModelSelect.addEventListener("change", () => {
      if (aiEnabled.value) {
        validateAiConfig();
      }
    });
  }

  window.onboardingAPI.onProgress((p) => {
    progressText.value = p.message || p.status || "";
    if (p.percent != null) {
      const pct = Math.max(0, Math.min(100, p.percent));
      progressPercent.value = pct;
    }
    if (p.status === "complete") {
      setupDone.value = true;
      setupStarted.value = false;
    }
    if (p.status === "error") {
      setupStarted.value = false;
      setupDone.value = false;
      const pluginLabel = getSelectedPluginDisplayName();
      completionError.value = p.message
        ? `${pluginLabel}: ${p.message}`
        : `${pluginLabel}: Setup failed`;
    }
  });
  window.onboardingAPI.onLog((payload) => {
    if (!payload || !payload.line) return;
    logs.value.push(payload.line);
    nextTick(() => {
      const el = document.querySelector(".logs");
      if (el) el.scrollTop = el.scrollHeight;
    });
  });
});

    return {
      idx,
      accessStatus,
      isCheckingAccess,
      showAccessibilityHelp,
      microphoneStatus,
      isCheckingMicrophone,
      showMicrophoneHelp,
      aiEnabled,
      aiBaseUrl,
      aiModel,
      aiModels,
      aiApiKey,
      keyStatus,
      savingKey,
      aiValidationError,
      pluginSelect,
      availablePlugins,
      pluginOptions,
      currentPluginOptions,
      selectedOptions,
      progressText,
      progressPercent,
      logs,
      setupStarted,
      setupDone,
      completionError,
      nextLabel,
      canProceed,
      prev,
      next,
      onPluginChange,
      updateSelectedOption,
      checkAccess,
      checkMicrophone,
      onAiEnabledChange,
      validateAiConfig,
      openSystemPreferences,
      openSettings,
      saveKey,
      runSetup,
      resetSetupState,
    };
  },
};
