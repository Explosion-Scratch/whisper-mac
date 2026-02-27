<template>
  <div class="onboarding-root">
    <header>
      <div class="title">Welcome</div>
      <button
        v-if="idx === 0"
        class="import-btn"
        @click="importSettings"
        title="Import settings from file"
      >
        <i class="ph-duotone ph-upload-simple"></i>
      </button>
    </header>
    <main>
      <div id="slides" class="slides">
        <section class="slide" data-step="intro" v-if="idx === 0">
          <IntroSlide />
        </section>

        <section class="slide" data-step="accessibility" v-if="idx === 1">
          <PermissionSlide
            iconClass="ph-duotone ph-shield-check"
            title="Accessibility permission"
            description="We need Accessibility to paste the transcribed text automatically."
            requiredMessage="Accessibility permissions must be enabled to automatically paste transcribed text. The app will check for permissions every few seconds."
            :isChecking="isCheckingAccess"
            :status="accessStatus"
            :showHelp="showAccessibilityHelp"
            @check="checkAccess"
            @open-settings="openSystemPreferences('accessibility')"
          />
        </section>

        <section class="slide" data-step="microphone" v-if="idx === 2">
          <PermissionSlide
            iconClass="ph-duotone ph-microphone"
            title="Microphone permission"
            description="We need microphone access to capture your voice for transcription."
            requiredMessage="Microphone permissions must be enabled to capture your voice for transcription. The app will check for permissions every few seconds."
            :isChecking="isCheckingMicrophone"
            :status="microphoneStatus"
            :showHelp="showMicrophoneHelp"
            @check="checkMicrophone"
            @open-settings="openSystemPreferences('microphone')"
          />
        </section>

        <section class="slide" data-step="model" v-if="idx === 3">
          <ModelSlide
            v-model:pluginSelect="pluginSelect"
            :availablePlugins="availablePlugins"
            :currentPluginOptions="currentPluginOptions"
            :selectedOptions="selectedOptions"
            @plugin-change="onPluginChange"
            @update-option="updateSelectedOption"
          />
        </section>

        <section class="slide" data-step="ai" v-if="idx === 4">
          <AiSlide
            v-model:aiEnabled="aiEnabled"
            v-model:aiBaseUrl="aiBaseUrl"
            v-model:aiModel="aiModel"
            v-model:aiApiKey="aiApiKey"
            :aiValidationError="aiValidationError"
            :aiModels="aiModels"
            :savingKey="savingKey"
            :keyStatus="keyStatus"
            @ai-enabled-change="onAiEnabledChange"
            @save-key="saveKey"
          />
        </section>

        <section class="slide" data-step="hotkey" v-if="idx === 5">
          <HotkeySlide
            v-model:hotkeyMode="hotkeyMode"
            v-model:currentHotkey="currentHotkey"
            @apply-suggested="applySuggestedHotkey"
          />
        </section>

        <section class="slide" data-step="setup" v-if="idx === 6">
          <SetupSlide
            :progressPercent="progressPercent"
            :progressText="progressText"
            :completionError="completionError"
            :logs="logs"
            :setupStarted="setupStarted"
            @run-setup="runSetup"
          />
        </section>
      </div>
      <div class="controls">
        <button
          id="prevBtn"
          class="btn"
          @click="prev"
          :disabled="idx === 0 || setupStarted"
        >
          Back
        </button>
        <div class="row">
          <button
            id="nextBtn"
            class="btn btn-primary"
            @click="next"
            :disabled="!canProceed"
          >
            {{ nextLabel }}
          </button>
        </div>
      </div>
    </main>

    <!-- Import Progress Modal -->
    <ImportProgressModal
      :visible="importProgress.visible"
      :stage="importProgress.stage"
      :message="importProgress.message"
      :percent="importProgress.percent"
      :currentStep="importProgress.currentStep"
      :totalSteps="importProgress.totalSteps"
      :modelProgress="importProgress.modelProgress"
      @cancel="cancelImport"
      @done="onImportDone"
    />
  </div>
</template>

<script>
import onboardingComponent from "../scripts/onboarding.js";
export default onboardingComponent;
</script>

<style lang="less">
@import "../styles/onboarding.less";
</style>
