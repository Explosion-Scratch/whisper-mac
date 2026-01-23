import { ref, computed, onMounted, nextTick } from "vue";

import {
  resetAccessibilityCache,
  checkAccessibilityOnboarding,
  checkMicrophoneOnboarding,
  openSystemPreferences,
} from "../utils/permissions";

import { deepClone } from "../utils/settings-store";

import {
  getPluginSchemas,
  getPluginDisplayName,
  initializePluginOptions,
  setPluginOnboarding,
} from "../utils/plugins";

import {
  validateApiKeyAndListModels,
  validateAiConfiguration,
  saveApiKeySecure,
  setAiEnabled,
  setAiProvider,
} from "../utils/ai-provider";

import OnboardingHotkeyInput from "../components/onboarding/OnboardingHotkeyInput.vue";
import ImportProgressModal from "../components/settings/ImportProgressModal.vue";

export default {
  components: {
    OnboardingHotkeyInput,
    ImportProgressModal,
  },

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

    // Hotkey configuration state
    const hotkeyMode = ref("toggle"); // 'toggle' or 'push'
    const currentHotkey = ref("");

    // Import settings state
    const importProgress = ref({
      visible: false,
      stage: "",
      message: "",
      percent: 0,
      currentStep: 0,
      totalSteps: 0,
      modelProgress: null,
    });

    // Total steps: 0=intro, 1=accessibility, 2=microphone, 3=model, 4=ai, 5=hotkey, 6=setup
    const TOTAL_STEPS = 7;
    const SETUP_STEP = 6;
    const HOTKEY_STEP = 5;

    const nextLabel = computed(() =>
      idx.value === SETUP_STEP
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
      // On hotkey step (idx === 5), always allow proceeding (hotkey is optional)
      if (idx.value === HOTKEY_STEP) {
        return true;
      }
      // On setup step (idx === 6), check if setup is done
      if (idx.value === SETUP_STEP) {
        return completionError.value ? true : setupDone.value;
      }
      // All other steps can proceed
      return true;
    });

    const availablePlugins = ref([]);
    const currentPluginOptions = ref([]);

    const getSelectedPluginDisplayName = () => {
      return getPluginDisplayName(availablePlugins.value, pluginSelect.value);
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

      // Initialize hotkey from settings if available
      if (initState.hotkeys) {
        if (initState.hotkeys.startStopDictation) {
          currentHotkey.value = initState.hotkeys.startStopDictation;
          hotkeyMode.value = "toggle";
        } else if (initState.hotkeys.pushToTalk) {
          currentHotkey.value = initState.hotkeys.pushToTalk;
          hotkeyMode.value = "push";
        }
      }

      try {
        const pluginData = await getPluginSchemas();
        if (!pluginData?.plugins || !pluginData?.schemas) {
          console.error("Invalid plugin data structure received:", pluginData);
          throw new Error("Failed to load plugin schemas");
        }

        availablePlugins.value = pluginData.plugins || [];
        pluginOptions.value = pluginData.schemas || {};
        selectedOptions.value = initializePluginOptions(pluginOptions.value);
        updateCurrentPluginOptions();
      } catch (error) {
        console.error("Failed to load plugin schemas:", error);
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
      currentPluginOptions.value =
        pluginOptions.value[pluginSelect.value] || [];
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
      if (idx.value < SETUP_STEP) {
        completionError.value = "";
      }
    };

    const handleAccessibilityStep = async () => {
      console.log("Renderer:onboarding next() accessibility check start");
      await resetAccessibilityCache();
      const t0 = Date.now();
      const hasAccess = await checkAccessibilityOnboarding();
      console.log(
        "Renderer:onboarding next() accessibility check result",
        JSON.stringify({ hasAccess, durationMs: Date.now() - t0 }),
      );
      if (!hasAccess) {
        accessStatus.value = "Please enable accessibility permissions first";
        return false;
      }
      return true;
    };

    const handleMicrophoneStep = async () => {
      // Use the native IPC-based check for consistency with the rest of the app
      // This ensures we check the actual native microphone permission status
      const hasAccess = await checkMicrophoneOnboarding();
      if (!hasAccess) {
        microphoneStatus.value = "Please enable microphone permissions first";
        return false;
      }
      return true;
    };

    const handlePluginStep = async () => {
      const currentOptions = selectedOptions.value[pluginSelect.value] || {};
      const plainOptions = deepClone(currentOptions);
      try {
        await setPluginOnboarding(pluginSelect.value, plainOptions);
      } catch (error) {
        console.error("Failed to set plugin options:", error);
      }
    };

    const handleAiStep = async () => {
      if (aiEnabled.value) {
        const result = await validateAiConfiguration(
          aiBaseUrl.value,
          aiModel.value,
          aiApiKey.value,
        );
        if (!result.isValid) {
          aiValidationError.value =
            result.error || "AI configuration is invalid";
          return false;
        }
      }
      await setAiEnabled(aiEnabled.value);
      if (aiEnabled.value) {
        await setAiProvider(aiBaseUrl.value, aiModel.value);
      }
      return true;
    };

    const handleHotkeyStep = async () => {
      // Save the hotkey configuration
      if (currentHotkey.value) {
        try {
          if (hotkeyMode.value === "toggle") {
            await window.onboardingAPI.updateHotkey(
              "hotkeys.startStopDictation",
              currentHotkey.value,
            );
            // Clear push to talk if using toggle mode
            await window.onboardingAPI.updateHotkey("hotkeys.pushToTalk", "");
          } else {
            await window.onboardingAPI.updateHotkey(
              "hotkeys.pushToTalk",
              currentHotkey.value,
            );
            // Keep default toggle hotkey
          }
          console.log(
            `[Onboarding] Hotkey saved: ${hotkeyMode.value} = ${currentHotkey.value}`,
          );
        } catch (error) {
          console.error("Failed to save hotkey:", error);
          // Don't block progression, hotkey can be configured later
        }
      }
      return true;
    };

    const handleComplete = async () => {
      try {
        const result = await window.onboardingAPI.complete();
        if (!result?.success) {
          const pluginLabel = getSelectedPluginDisplayName();
          completionError.value = result?.error
            ? `${pluginLabel}: ${result.error}`
            : `${pluginLabel} can't be activated right now.`;
          return false;
        }
        return true;
      } catch (error) {
        const pluginLabel = getSelectedPluginDisplayName();
        const message =
          error?.message ||
          error?.toString?.() ||
          "The selected plugin could not be activated.";
        completionError.value = `${pluginLabel}: ${message}`;
        return false;
      }
    };

    const next = async () => {
      if (idx.value === 1 && !(await handleAccessibilityStep())) return;
      if (idx.value === 2 && !(await handleMicrophoneStep())) return;
      if (idx.value === SETUP_STEP && !setupDone.value) return;
      if (idx.value === SETUP_STEP && completionError.value) {
        resetSetupState();
        idx.value = 3;
        return;
      }
      if (idx.value === 3) await handlePluginStep();
      if (idx.value === 4 && !(await handleAiStep())) return;
      if (idx.value === HOTKEY_STEP) await handleHotkeyStep();
      if (idx.value < SETUP_STEP) {
        idx.value += 1;
      } else {
        await handleComplete();
      }
    };

    const checkAccess = async () => {
      isCheckingAccess.value = true;
      accessStatus.value = "Checking...";
      const ok = await handleAccessibilityStep();
      if (ok) {
        accessStatus.value = "Enabled";
        showAccessibilityHelp.value = false;
      } else {
        accessStatus.value = "Please grant accessibility permissions";
        showAccessibilityHelp.value = true;
      }
      isCheckingAccess.value = false;
    };

    const checkMicrophone = async () => {
      isCheckingMicrophone.value = true;
      microphoneStatus.value = "Checking...";
      // Reset cache before checking to get fresh status
      if (window.onboardingAPI?.resetMicrophoneCache) {
        await window.onboardingAPI.resetMicrophoneCache();
      }
      const ok = await handleMicrophoneStep();
      if (ok) {
        microphoneStatus.value = "Enabled";
        showMicrophoneHelp.value = false;
      } else {
        microphoneStatus.value = "Please grant microphone permissions";
        showMicrophoneHelp.value = true;
      }
      isCheckingMicrophone.value = false;
    };

    const saveKey = async () => {
      try {
        savingKey.value = true;
        keyStatus.value = "Validating...";
        const result = await validateApiKeyAndListModels(
          aiBaseUrl.value,
          aiApiKey.value,
        );
        if (!result?.success) {
          keyStatus.value = `Validation failed: ${result?.error || "Unknown error"}`;
          savingKey.value = false;
          return;
        }
        aiModels.value = result.models || [];
        if (aiModels.value.length && !aiModel.value) {
          aiModel.value = aiModels.value[0].id;
        }
        await saveApiKeySecure(aiApiKey.value);
        keyStatus.value = "Saved to Keychain";
        aiApiKey.value = "";
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
          const result = await validateAiConfiguration(
            aiBaseUrl.value,
            aiModel.value,
            aiApiKey.value,
          );
          if (!result.isValid) {
            aiValidationError.value =
              result.error || "AI configuration is invalid";
            aiEnabled.value = false;
            return;
          }
          if (result.models?.length > 0) {
            aiModels.value = result.models;
            if (!result.models.some((m) => m.id === aiModel.value)) {
              aiModel.value = result.models[0].id;
            }
          }
        } catch (error) {
          aiValidationError.value = `Validation failed: ${error.message || String(error)}`;
          aiEnabled.value = false;
        }
      } else {
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

    const openSystemPreferencesDialog = async (type) => {
      await openSystemPreferences(type);
    };

    const openSettings = async (section) => {
      try {
        await window.onboardingAPI.openSettings(section);
      } catch (error) {
        console.error(`Failed to open settings for ${section}:`, error);
      }
    };

    // Apply suggested hotkey based on mode
    const applySuggestedHotkey = () => {
      if (hotkeyMode.value === "toggle") {
        currentHotkey.value = "Control+D";
      } else {
        currentHotkey.value = "Alt+Right";
      }
    };

    // Import settings functionality
    const importSettings = async () => {
      try {
        const result = await window.onboardingAPI.showOpenDialog({
          filters: [{ name: "JSON Files", extensions: ["json"] }],
          properties: ["openFile"],
          title: "Import Settings",
        });

        if (result.canceled || !result.filePaths?.length) {
          return;
        }

        const filePath = result.filePaths[0];

        // Analyze the import file first
        const analysis = await window.onboardingAPI.analyzeImport(filePath);
        if (!analysis.valid) {
          console.error("Invalid settings file:", analysis.message);
          return;
        }

        // Show import progress modal
        importProgress.value = {
          visible: true,
          stage: "validating",
          message: "Preparing import...",
          percent: 0,
          currentStep: 0,
          totalSteps: 4,
          modelProgress: null,
        };

        // Perform the import with progress
        const importResult =
          await window.onboardingAPI.importSettingsWithProgress(filePath);

        if (importResult.success) {
          importProgress.value.stage = "complete";
          importProgress.value.message = "Settings imported successfully!";
          importProgress.value.percent = 100;

          // Reinitialize with imported settings
          setTimeout(async () => {
            importProgress.value.visible = false;
            await init();
          }, 1500);
        } else {
          importProgress.value.stage = "error";
          importProgress.value.message = `Import failed: ${importResult.message}`;
        }
      } catch (error) {
        console.error("Failed to import settings:", error);
        importProgress.value.stage = "error";
        importProgress.value.message = `Import failed: ${error.message}`;
      }
    };

    const cancelImport = async () => {
      try {
        await window.onboardingAPI.cancelImport();
      } catch (e) {
        console.error("Failed to cancel import:", e);
      }
      importProgress.value.visible = false;
    };

    const onImportDone = async () => {
      const wasSuccessful = importProgress.value.stage === "complete";
      importProgress.value.visible = false;
      if (wasSuccessful) {
        // Complete onboarding since settings were successfully imported
        await handleComplete();
      }
    };

    const setupIpcListeners = () => {
      window.onboardingAPI.onProgress((p) => {
        progressText.value = p.message || p.status || "";
        if (p.percent != null) {
          progressPercent.value = Math.max(0, Math.min(100, p.percent));
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
        if (!payload?.line) return;
        logs.value.push(payload.line);
        nextTick(() => {
          const el = document.querySelector(".logs");
          if (el) el.scrollTop = el.scrollHeight;
        });
      });

      // Listen for import progress updates
      if (window.onboardingAPI.onImportProgress) {
        window.onboardingAPI.onImportProgress((progress) => {
          if (progress.stage) {
            importProgress.value.stage = progress.stage;
          }
          if (progress.message) {
            importProgress.value.message = progress.message;
          }
          if (progress.percent !== undefined) {
            importProgress.value.percent = progress.percent;
          }
          if (progress.currentStep !== undefined) {
            importProgress.value.currentStep = progress.currentStep;
          }
          if (progress.totalSteps !== undefined) {
            importProgress.value.totalSteps = progress.totalSteps;
          }
          if (progress.modelProgress !== undefined) {
            importProgress.value.modelProgress = progress.modelProgress;
          }
        });
      }
    };

    onMounted(() => {
      init();
      setupIpcListeners();
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
      // Hotkey state
      hotkeyMode,
      currentHotkey,
      applySuggestedHotkey,
      // Import state
      importProgress,
      importSettings,
      cancelImport,
      onImportDone,
      // Methods
      prev,
      next,
      onPluginChange,
      updateSelectedOption,
      checkAccess,
      checkMicrophone,
      onAiEnabledChange,
      validateAiConfig,
      openSystemPreferences: openSystemPreferencesDialog,
      openSettings,
      saveKey,
      runSetup,
      resetSetupState,
    };
  },
};
