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
          <div class="content">
            <div class="step-header">
              <!-- Use the app icon image for the welcome screen -->
              <img
                class="hero-logo"
                src="../assets/icon.png"
                alt="WhisperMac"
              />
              <h1>Welcome to WhisperMac</h1>
            </div>
            <p class="micro">
              Dictate anywhere on macOS. This quick setup will enable
              accessibility and microphone permissions, pick a Whisper model,
              and optionally enable AI polishing.
            </p>
            <div class="card">
              <div class="hint">
                You can change all settings later in Settings.
              </div>
            </div>
          </div>
        </section>

        <section class="slide" data-step="accessibility" v-if="idx === 1">
          <div class="content">
            <div class="step-header">
              <span class="step-icn"
                ><i class="ph-duotone ph-shield-check"></i
              ></span>
              <h1>Accessibility permission</h1>
            </div>
            <p class="micro">
              We need Accessibility to paste the transcribed text automatically.
            </p>
            <div class="row">
              <button
                id="checkAccessBtn"
                class="btn"
                @click="checkAccess"
                :disabled="isCheckingAccess"
              >
                Check permission
              </button>
              <div
                v-if="isCheckingAccess"
                class="spinner"
                aria-hidden="true"
              ></div>
              <span
                id="accessStatus"
                class="hint"
                :style="{
                  color: accessStatus === 'Enabled' ? '#28a745' : '#dc3545',
                }"
                >{{ accessStatus }}</span
              >
            </div>
            <div class="card" v-if="accessStatus !== 'Enabled'">
              <div class="hint">
                <strong>Required:</strong> Accessibility permissions must be
                enabled to automatically paste transcribed text. The app will
                check for permissions every few seconds.
              </div>
              <div
                v-if="showAccessibilityHelp"
                class="row"
                style="margin-top: 12px; gap: 8px"
              >
                <button
                  class="btn"
                  @click="openSystemPreferences('accessibility')"
                  style="font-size: 11px"
                >
                  Open System Settings
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="slide" data-step="microphone" v-if="idx === 2">
          <div class="content">
            <div class="step-header">
              <span class="step-icn"
                ><i class="ph-duotone ph-microphone"></i
              ></span>
              <h1>Microphone permission</h1>
            </div>
            <p class="micro">
              We need microphone access to capture your voice for transcription.
            </p>
            <div class="row">
              <button
                id="checkMicrophoneBtn"
                class="btn"
                @click="checkMicrophone"
                :disabled="isCheckingMicrophone"
              >
                Check permission
              </button>
              <div
                v-if="isCheckingMicrophone"
                class="spinner"
                aria-hidden="true"
              ></div>
              <span
                id="microphoneStatus"
                class="hint"
                :style="{
                  color: microphoneStatus === 'Enabled' ? '#28a745' : '#dc3545',
                }"
                >{{ microphoneStatus }}</span
              >
            </div>
            <div class="card" v-if="microphoneStatus !== 'Enabled'">
              <div class="hint">
                <strong>Required:</strong> Microphone permissions must be
                enabled to capture your voice for transcription. The app will
                check for permissions every few seconds.
              </div>
              <div
                v-if="showMicrophoneHelp"
                class="row"
                style="margin-top: 12px; gap: 8px"
              >
                <button
                  class="btn"
                  @click="openSystemPreferences('microphone')"
                  style="font-size: 11px"
                >
                  Open System Settings
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="slide" data-step="model" v-if="idx === 3">
          <div class="content">
            <div class="step-header">
              <span class="step-icn"
                ><i class="ph-duotone ph-download-simple"></i
              ></span>
              <h1>Choose transcription engine</h1>
            </div>
            <div class="card" style="width: 100%">
              <div class="field">
                <div class="label">Plugin</div>
                <select
                  id="pluginSelect"
                  class="select"
                  v-model="pluginSelect"
                  @change="onPluginChange"
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
                  @change="
                    updateSelectedOption(option.key, $event.target.value)
                  "
                >
                  <option
                    v-for="modelOpt in option.options"
                    :key="modelOpt.value"
                    :value="modelOpt.value"
                  >
                    {{ modelOpt.label
                    }}{{
                      modelOpt.size
                        ? `
                      (${modelOpt.size})`
                        : ""
                    }}
                  </option>
                </select>

                <!-- Regular select -->
                <select
                  v-else-if="option.type === 'select'"
                  class="select"
                  :value="selectedOptions[option.key] || option.default"
                  @change="
                    updateSelectedOption(option.key, $event.target.value)
                  "
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
                    @change="
                      updateSelectedOption(option.key, $event.target.checked)
                    "
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
                  @input="
                    updateSelectedOption(
                      option.key,
                      parseInt($event.target.value),
                    )
                  "
                />

                <!-- Text input -->
                <input
                  v-else
                  type="text"
                  class="input"
                  :value="selectedOptions[option.key] || option.default"
                  @input="updateSelectedOption(option.key, $event.target.value)"
                />

                <div
                  v-if="option.description"
                  class="hint"
                  style="margin-top: 6px"
                >
                  {{ option.description }}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="slide" data-step="ai" v-if="idx === 4">
          <div class="content">
            <div class="step-header">
              <span class="step-icn"
                ><i class="ph-duotone ph-sparkle"></i
              ></span>
              <h1>Enable AI polishing?</h1>
            </div>
            <div class="toggle">
              <input
                id="aiEnabled"
                type="checkbox"
                v-model="aiEnabled"
                @change="onAiEnabledChange"
              />
              <label for="aiEnabled"
                >Use AI to clean up and format dictation</label
              >
            </div>
            <div
              v-if="aiValidationError"
              class="error-message"
              style="color: #ef4444; font-size: 14px; margin-top: 8px"
            >
              {{ aiValidationError }}
            </div>
            <div id="aiConfig" class="card" v-show="aiEnabled">
              <div class="form-grid">
                <div class="field">
                  <div class="label">API Base URL</div>
                  <input
                    id="aiBaseUrl"
                    class="input"
                    placeholder="e.g. https://api.example.com/v1"
                    v-model="aiBaseUrl"
                  />
                </div>
                <div class="field">
                  <div class="label">Model</div>
                  <select id="aiModelSelect" class="select" v-model="aiModel">
                    <option v-for="m in aiModels" :key="m.id" :value="m.id">
                      {{ m.name || m.id }}
                    </option>
                  </select>
                </div>
              </div>
              <div
                class="form-row"
                style="
                  margin-top: 8px;
                  display: flex;
                  gap: 10px;
                  align-items: center;
                "
              >
                <div class="field" style="flex: 1">
                  <div class="label">API Key</div>
                  <input
                    id="aiApiKey"
                    class="input"
                    placeholder="Paste your API key (stored securely)"
                    v-model="aiApiKey"
                  />
                </div>
                <button
                  id="saveKeyBtn"
                  class="btn btn-primary"
                  @click="saveKey"
                  style="margin-top: 24px"
                >
                  <span
                    v-if="savingKey"
                    class="spinner"
                    aria-hidden="true"
                  ></span>
                  <span v-else>Save Key</span>
                </button>
              </div>
              <div class="hint" style="margin-top: 6px">{{ keyStatus }}</div>
            </div>
          </div>
        </section>

        <section class="slide" data-step="hotkey" v-if="idx === 5">
          <div class="content hotkey-content">
            <div class="step-header compact">
              <span class="step-icn small"
                ><i class="ph-duotone ph-keyboard"></i
              ></span>
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
                @click="hotkeyMode = 'toggle'"
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
                @click="hotkeyMode = 'push'"
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
                <span>{{
                  hotkeyMode === "toggle" ? "Hotkey" : "Key"
                }}</span>
              </div>
              <OnboardingHotkeyInput
                v-model="currentHotkey"
                :placeholder="
                  hotkeyMode === 'toggle' ? 'e.g. ⌃ D' : 'e.g. ⌥ /'
                "
              />
              <button
                v-if="!currentHotkey"
                class="suggestion-btn"
                @click="applySuggestedHotkey"
                :title="hotkeyMode === 'toggle' ? 'Use Control+D' : 'Use Alt+/'"
              >
                {{ hotkeyMode === "toggle" ? "⌃ D" : "⌥ /" }}
              </button>
            </div>
          </div>
        </section>

        <section class="slide" data-step="setup" v-if="idx === 6">
          <div class="content">
            <div class="step-header">
              <span class="step-icn"
                ><i class="ph-duotone ph-gear-six"></i
              ></span>
              <h1>Ready to set up</h1>
            </div>
            <p class="micro">
              This will download the selected model for transcription.
            </p>
            <div class="progress">
              <div
                id="progressBar"
                class="bar"
                :style="{
                  width: Math.max(0, Math.min(100, progressPercent)) + '%',
                }"
              ></div>
            </div>
            <div id="progressText" class="hint micro">{{ progressText }}</div>
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
                id="runSetupBtn"
                class="btn btn-primary"
                @click="runSetup"
                :disabled="setupStarted"
              >
                Setup
              </button>
            </div>
          </div>
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
