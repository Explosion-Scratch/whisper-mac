<template>
  <div class="window settings-root" v-cloak>
    <header class="toolbar toolbar-header">
      <h1 class="title">Settings</h1>
      <div class="toolbar-actions">
        <button
          @click="resetAll"
          class="btn btn-default btn-icn-only action-btn"
          title="Reset all settings to defaults"
        >
          <i class="ph ph-arrow-clockwise"></i>
        </button>
        <button
          @click="importSettings"
          class="btn btn-default btn-icn-only action-btn"
          title="Import settings from file"
        >
          <i class="ph ph-upload-simple"></i>
        </button>
        <button
          @click="exportSettings"
          class="btn btn-default btn-icn-only action-btn"
          title="Export settings to file"
        >
          <i class="ph ph-download-simple"></i>
        </button>
      </div>
    </header>

    <div class="window-content" v-if="schema.length > 0">
      <nav class="sidebar">
        <div class="nav-group">
          <a
            v-for="section in schema"
            :key="section.id"
            class="nav-group-item"
            :class="{ active: currentSectionId === section.id }"
            @click="showSection(section.id)"
          >
            <i class="icn ph" :class="getIcon(section.icon || section.id)"></i>
            {{ section.title }}
          </a>
          <a
            class="nav-group-item"
            :class="{ active: currentSectionId === 'about' }"
            @click="showSection('about')"
          >
            <i class="icn ph ph-info"></i>
            About
          </a>
        </div>
      </nav>

      <main class="settings-content" v-if="currentSection && settings">
        <form @submit.prevent="saveSettings">
          <div
            v-if="
              currentSectionId !== 'permissions' &&
              currentSectionId !== 'history'
            "
            class="settings-section"
          >
            <div class="section-header">
              <i
                class="ph-duotone"
                :class="getIcon(currentSection.icon || currentSection.id)"
              ></i>
              <div>
                <h2 class="section-title">{{ currentSection.title }}</h2>
                <p
                  v-if="currentSection.description"
                  class="section-description"
                >
                  {{ currentSection.description }}
                </p>
              </div>
            </div>

            <!-- AI Transformation Override Warning -->
            <div
              v-if="currentSectionId === 'ai' && aiTransformationOverridden"
              class="override-warning"
            >
              <i class="ph-duotone ph-info"></i>
              <div class="override-warning-content">
                <strong>Settings overridden by {{ overridingPluginName }}</strong>
                <p>
                  The active transcription plugin is configured to handle both
                  transcription and transformation in a single AI call. The
                  model, API URL, and generation settings below are managed by
                  the plugin. Prompts and writing style are still used.
                </p>
              </div>
            </div>

            <!-- REGULAR FIELDS RENDERER -->
            <template
              v-if="
                currentSectionId !== 'permissions' &&
                currentSectionId !== 'history'
              "
              v-for="field in currentSection.fields"
              :key="field.key"
            >
              <!-- Use SettingsField for standard field types -->
              <SettingsField
                v-if="isStandardFieldType(field.type)"
                :field="field"
                :modelValue="getSettingValue(field.key)"
                :validationErrors="validationErrors"
                :apiKeyInput="apiKeyInput"
                :aiModelsState="aiModelsState"
                :disabled="isFieldOverriddenByPlugin(field.key)"
                @update:modelValue="handleFieldUpdate(field.key, $event)"
                @update:apiKeyInput="apiKeyInput = $event"
                @validateApiKey="debouncedValidateApiKey"
                @baseUrlChanged="aiModelsState.loadedForBaseUrl = null"
                @browseDirectory="browseDirectory(field.key)"
                @clearHotkey="clearHotkey(field.key)"
                @hotkeyChanged="handleHotkeyChanged(field.key, $event)"
                @previewSound="previewSound"
              />

              <!-- Actions Editor -->
              <ActionsEditor
                v-if="field.type === 'actions-editor' && settings.actions"
                :settings="settings"
                :schema="schema"
                @status="showStatus"
              />

              <!-- Rules Editor -->
              <RulesEditor
                v-if="field.type === 'rules-editor'"
                :settings="settings"
                :schema="schema"
                @status="showStatus"
              />

              <div class="validation-error" v-if="validationErrors[field.key]">
                {{ validationErrors[field.key] }}
              </div>
            </template>

            <!-- TRANSCRIPTION SECTION -->
            <TranscriptionSection
              v-if="
                currentSection.id === 'transcription' &&
                pluginData.plugins.length
              "
              :pluginData="pluginData"
              :activePlugin="activePlugin"
              :settings="settings"
              @pluginChange="handleTranscriptionPluginChange"
              @optionChange="handleTranscriptionOptionChange"
              @modelChange="handleTranscriptionModelChange"
              @clearData="clearPluginData"
              @apiKeyValidated="handlePluginApiKeyValidated"
            />

            <!-- DATA MANAGEMENT SECTION -->
            <DataManagement
              v-if="currentSection.id === 'data'"
              :pluginDataInfo="pluginDataInfo"
              :pluginDataItems="pluginDataItems"
              :isClearingAll="isClearingAll"
              @clearAll="clearAllPluginData"
              @clearPlugin="clearPluginData"
              @deleteItem="deletePluginDataItem"
              @refresh="refreshDataManagement"
              @toggleDetails="togglePluginDetails"
            />
          </div>

          <div
            v-if="
              currentSectionId !== 'permissions' &&
              currentSectionId !== 'history'
            "
            class="form-actions"
          >
            <button type="submit" class="btn btn-primary" :disabled="isSaving">
              <span v-if="isSaving" class="spinner"></span>
              <i v-if="!isSaving" class="ph-duotone ph-floppy-disk"></i>
              Save Settings
            </button>
            <button
              @click="cancelChanges"
              type="button"
              class="btn btn-default"
            >
              <i class="ph-duotone ph-x-circle"></i>
              Cancel
            </button>
            <button
              @click="resetSection"
              type="button"
              class="btn btn-negative"
            >
              <i class="ph-duotone ph-arrow-counter-clockwise"></i>
              Reset Section
            </button>
          </div>
        </form>

        <!-- Permissions Content -->
        <div v-if="currentSectionId === 'permissions'" class="settings-section">
          <PermissionsSection @status="handlePermissionStatus" />
        </div>

        <!-- History Content -->
        <div v-if="currentSectionId === 'history'" class="settings-section">
          <HistorySection @status="handlePermissionStatus" />
        </div>
      </main>

      <!-- About Section -->
      <main
        class="settings-content about-content"
        v-if="currentSectionId === 'about'"
      >
        <div class="about-container">
          <div class="about-header">
            <img
              src="../assets/icon.png"
              alt="WhisperMac Icon"
              class="about-app-icon"
            />
            <h1 class="about-app-name">
              {{ packageInfo?.name || "WhisperMac" }}
            </h1>
            <a
              v-if="packageInfo?.repository?.url"
              href="#"
              @click.prevent="openExternalLink(getReleasesUrl())"
              class="about-app-version"
              >Version {{ appVersion }}</a
            >
            <span v-else class="about-app-version">Version {{ appVersion }}</span>
            <p class="about-app-description">
              {{
                packageInfo?.description ||
                "AI-powered dictation for Mac using multiple transcription engines"
              }}
            </p>
            <a
              v-if="packageInfo?.author"
              href="#"
              @click="openAuthorLink"
              class="about-app-author"
              >By {{ packageInfo.author }}</a
            >
            <span v-else class="about-app-author">By Explosion-Scratch</span>
          </div>

          <div class="about-actions">
            <button
              type="button"
              @click="importAllSettings"
              class="btn btn-primary about-action-btn"
            >
              <i class="ph-duotone ph-download-simple"></i>
              Import Settings
            </button>
            <button
              type="button"
              @click="exportAllSettings"
              class="btn btn-primary about-action-btn"
            >
              <i class="ph-duotone ph-upload-simple"></i>
              Export Settings
            </button>
          </div>

          <div class="about-footer">
            <p class="about-footer-text">
              Import or export all your WhisperMac settings to backup or
              transfer between installations.
            </p>
            <div v-if="packageInfo" class="about-footer-details">
              <p v-if="packageInfo.license" class="about-footer-text">
                License: {{ packageInfo.license }}
              </p>
              <p v-if="packageInfo.homepage" class="about-footer-text">
                <a
                  href="#"
                  @click.prevent="openExternalLink(packageInfo.homepage)"
                  class="about-footer-link"
                  >Homepage</a
                >
                <span v-if="packageInfo.bugs?.url"> • </span>
                <a
                  v-if="packageInfo.bugs?.url"
                  href="#"
                  @click.prevent="openExternalLink(packageInfo.bugs.url)"
                  class="about-footer-link"
                  >Report Issues</a
                >
                <span v-if="packageInfo.repository?.url"> • </span>
                <a
                  v-if="packageInfo.repository?.url"
                  href="#"
                  @click.prevent="openExternalLink(getRepoUrl())"
                  class="about-footer-link"
                  >Repository</a
                >
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>

    <div
      class="status-message"
      :class="[status.type, { show: status.visible }]"
    >
      {{ status.message }}
    </div>

    <div class="progress-overlay" :class="{ show: progress.visible }">
      <div>{{ progress.message }}</div>
      <div class="progress-bar-container">
        <div
          class="progress-bar-fill"
          :style="{ width: progress.percent + '%' }"
        ></div>
      </div>
    </div>

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
import settingsComponent from "../scripts/settingsWindow.js";
export default settingsComponent;
</script>

<style>
@import "../styles/settings.less";
</style>
