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
          <i class="ph ph-download-simple"></i>
        </button>
        <button
          @click="exportSettings"
          class="btn btn-default btn-icn-only action-btn"
          title="Export settings to file"
        >
          <i class="ph ph-upload-simple"></i>
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
            v-if="currentSectionId !== 'permissions'"
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
                <strong
                  >Settings overridden by {{ overridingPluginName }}</strong
                >
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
              v-if="currentSectionId !== 'permissions'"
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
              />

              <!-- Actions Editor -->
              <div v-if="field.type === 'actions-editor' && settings.actions">
                <div class="actions-editor-container">
                  <div class="actions-editor-toolbar">
                    <button
                      @click="addNewAction"
                      type="button"
                      class="btn btn-primary btn-sm"
                    >
                      <i class="ph-duotone ph-plus"></i> Add Action
                    </button>
                    <button
                      @click="resetActionsToDefaults"
                      type="button"
                      class="btn btn-default btn-sm"
                    >
                      <i class="ph-duotone ph-arrow-clockwise"></i> Reset to
                      Defaults
                    </button>
                  </div>
                  <div class="actions-list">
                    <div
                      v-if="!settings.actions?.actions?.length"
                      class="empty-actions-state"
                    >
                      <i class="ph-duotone ph-lightning"></i>
                      <p>No actions configured</p>
                      <p class="empty-subtitle">
                        Add your first voice action to get started
                      </p>
                    </div>
                    <div
                      v-for="(action, index) in settings.actions?.actions || []"
                      :key="action.id"
                      class="action-card"
                    >
                      <div
                        class="action-card-header"
                        @click.self="toggleActionCard(action.id)"
                      >
                        <div
                          class="action-info"
                          @click="toggleActionCard(action.id)"
                        >
                          <div class="action-toggle">
                            <input
                              type="checkbox"
                              class="action-enabled-checkbox checkbox"
                              v-model="action.enabled"
                              @click.stop
                            />
                            <h4 class="action-name">{{ action.name }}</h4>
                            <div class="action-badges">
                              <span
                                class="action-badge"
                                :title="`${(action.matchPatterns || []).length} pattern(s)`"
                              >
                                <i class="ph ph-hash"></i
                                >{{ (action.matchPatterns || []).length }}
                              </span>
                              <span
                                class="action-badge"
                                :title="`${(action.handlers || []).length} handler(s)`"
                              >
                                <i class="ph ph-lightning"></i
                                >{{ (action.handlers || []).length }}
                              </span>
                            </div>
                          </div>
                          <p class="action-description">
                            {{ action.description }}
                          </p>
                        </div>
                        <div class="action-controls">
                          <button
                            type="button"
                            class="btn btn-icn-only btn-compact"
                            @click="moveAction(index, -1)"
                            :disabled="index === 0"
                            title="Move up"
                          >
                            <i class="ph ph-caret-up"></i>
                          </button>
                          <button
                            type="button"
                            class="btn btn-icn-only btn-compact"
                            @click="moveAction(index, 1)"
                            :disabled="
                              index ===
                              (settings.actions?.actions?.length || 0) - 1
                            "
                            title="Move down"
                          >
                            <i class="ph ph-caret-down"></i>
                          </button>
                          <button
                            type="button"
                            class="btn btn-icn-only btn-compact btn-negative"
                            @click="deleteAction(index)"
                            title="Delete action"
                          >
                            <i class="ph ph-trash"></i>
                          </button>
                        </div>
                      </div>
                      <div
                        class="action-card-body"
                        :class="{ collapsed: !expandedActions[action.id] }"
                      >
                        <div class="action-form-group">
                          <label>Action Name</label>
                          <input
                            type="text"
                            class="form-control"
                            v-model="action.name"
                          />
                        </div>
                        <div class="action-form-group">
                          <label>Description</label>
                          <input
                            type="text"
                            class="form-control"
                            v-model="action.description"
                          />
                        </div>
                        <div class="config-section">
                          <div
                            class="config-section-header"
                            @click="toggleConfigSection(action.id, 'options')"
                          >
                            <i class="ph ph-gear-six"></i>
                            <span>Action Options</span>
                            <i
                              class="ph ph-caret-down collapse-icon"
                              :class="{
                                collapsed: !isConfigSectionExpanded(
                                  action.id,
                                  'options',
                                ),
                              }"
                            ></i>
                          </div>
                          <div
                            class="config-section-body"
                            v-show="
                              isConfigSectionExpanded(action.id, 'options')
                            "
                          >
                            <div class="action-form-row">
                              <div class="action-form-col">
                                <label class="checkbox-label"
                                  ><input
                                    type="checkbox"
                                    v-model="action.closesTranscription"
                                  />
                                  Closes Transcription</label
                                >
                              </div>
                              <div class="action-form-col">
                                <label class="checkbox-label"
                                  ><input
                                    type="checkbox"
                                    v-model="action.skipsTransformation"
                                  />
                                  Skips Transformation</label
                                >
                              </div>
                            </div>
                            <div
                              class="action-form-row"
                              style="margin-top: 8px"
                            >
                              <div class="action-form-col">
                                <label class="checkbox-label">
                                  <input
                                    type="checkbox"
                                    v-model="action.applyToAllSegments"
                                  />
                                  Apply to All Segments
                                </label>
                                <span class="field-help"
                                  >Run on all segments after transcription</span
                                >
                              </div>
                              <div
                                class="action-form-col"
                                v-if="action.applyToAllSegments"
                              >
                                <label>Timing Mode</label>
                                <select
                                  class="form-control"
                                  v-model="action.timingMode"
                                >
                                  <option value="before_ai">
                                    Before AI (Default)
                                  </option>
                                  <option value="after_ai">After AI</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="section-header-small">
                          <h5>Match Patterns</h5>
                          <button
                            type="button"
                            class="btn btn-sm"
                            @click="addNewPattern(index)"
                          >
                            <i class="ph ph-plus"></i> Add
                          </button>
                        </div>
                        <div class="patterns-pills-container">
                          <template
                            v-for="(pattern, pIndex) in action.matchPatterns ||
                            []"
                            :key="`pattern-${index}-${pIndex}`"
                          >
                            <div
                              v-if="pattern"
                              class="pattern-pill"
                              :class="{
                                editing: isPatternEditing(index, pIndex),
                                'case-sensitive':
                                  pattern && pattern.caseSensitive,
                              }"
                              @click="editPattern(index, pIndex)"
                            >
                              <span
                                class="pill-badge"
                                :class="
                                  pattern.type ? `badge-${pattern.type}` : ''
                                "
                              >
                                {{
                                  getPatternTypeBadge(
                                    pattern.type || "startsWith",
                                  )
                                }}
                              </span>
                              <span class="pill-text">{{
                                pattern.pattern || "empty"
                              }}</span>
                              <button
                                type="button"
                                class="pill-delete"
                                @click.stop="deletePattern(index, pIndex)"
                                title="Delete pattern"
                              >
                                <i class="ph ph-x"></i>
                              </button>
                            </div>
                          </template>
                          <div
                            v-if="
                              editingPattern &&
                              editingPattern.actionIndex === index &&
                              editingPattern.patternIndex !== undefined &&
                              settings.actions?.actions?.[index]
                                ?.matchPatterns?.[editingPattern.patternIndex]
                            "
                            class="inline-edit-form pattern-edit-form"
                          >
                            <select
                              class="form-control form-control-sm"
                              v-model="
                                settings.actions.actions[index].matchPatterns[
                                  editingPattern.patternIndex
                                ].type
                              "
                            >
                              <option value="startsWith">Starts with</option>
                              <option value="endsWith">Ends with</option>
                              <option value="exact">Exact</option>
                              <option value="regex">Regex</option>
                            </select>
                            <input
                              type="text"
                              class="form-control form-control-sm"
                              placeholder="Pattern text..."
                              v-model="
                                settings.actions.actions[index].matchPatterns[
                                  editingPattern.patternIndex
                                ].pattern
                              "
                              @keydown.enter="closePatternEdit"
                              @keydown.esc="closePatternEdit"
                            />
                            <label class="checkbox-label-inline">
                              <input
                                type="checkbox"
                                v-model="
                                  settings.actions.actions[index].matchPatterns[
                                    editingPattern.patternIndex
                                  ].caseSensitive
                                "
                              />
                              Aa
                            </label>
                            <button
                              type="button"
                              class="btn btn-sm btn-primary"
                              @click="closePatternEdit"
                            >
                              <i class="ph ph-check"></i>
                            </button>
                          </div>
                        </div>
                        <div class="section-header-small">
                          <h5>Action Handlers</h5>
                          <button
                            type="button"
                            class="btn btn-sm"
                            @click="addNewHandler(index)"
                          >
                            <i class="ph ph-plus"></i> Add
                          </button>
                        </div>
                        <div class="handlers-pills-container">
                          <template
                            v-for="(handler, hIndex) in action.handlers || []"
                            :key="`handler-${index}-${hIndex}`"
                          >
                            <div v-if="handler" class="handler-pill-wrapper">
                              <div
                                class="handler-pill"
                                :class="{
                                  expanded: isHandlerExpanded(index, hIndex),
                                }"
                                @click="toggleHandler(index, hIndex)"
                              >
                                <span
                                  class="handler-icon"
                                  :class="
                                    handler.type ? `icon-${handler.type}` : ''
                                  "
                                >
                                  <i
                                    :class="getHandlerIcon(handler.type || '')"
                                  ></i>
                                </span>
                                <span class="handler-type">{{
                                  getHandlerTypeName(handler.type || "")
                                }}</span>
                                <span class="handler-arrow">→</span>
                                <span class="handler-summary">{{
                                  getHandlerSummary(handler)
                                }}</span>
                                <button
                                  type="button"
                                  class="pill-delete"
                                  @click.stop="deleteHandler(index, hIndex)"
                                  title="Delete handler"
                                >
                                  <i class="ph ph-x"></i>
                                </button>
                              </div>
                              <div
                                class="handler-config-panel"
                                v-show="
                                  isHandlerExpanded(index, hIndex) &&
                                  handler.type
                                "
                              >
                                <div class="handler-type-selector">
                                  <label>Handler Type</label>
                                  <select
                                    class="form-control"
                                    v-model="handler.type"
                                    @change="updateHandlerType(handler)"
                                  >
                                    <option value="openUrl">Open URL</option>
                                    <option value="openApplication">
                                      Open Application
                                    </option>
                                    <option value="quitApplication">
                                      Quit Application
                                    </option>
                                    <option value="executeShell">
                                      Execute Shell
                                    </option>
                                    <option value="segmentAction">
                                      Segment Action
                                    </option>
                                    <option value="transformText">
                                      Transform Text
                                    </option>
                                    <option value="cleanUrl">
                                      Clean Spoken URL
                                    </option>
                                  </select>
                                </div>
                                <template
                                  v-if="
                                    handler.type === 'openUrl' && handler.config
                                  "
                                >
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'basic')
                                      "
                                    >
                                      <i class="ph ph-gear"></i>
                                      <span>Basic</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'basic',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'basic',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>URL Template</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="{argument}"
                                          v-model="handler.config.urlTemplate"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <i class="ph ph-sliders"></i>
                                      <span>Options</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'options',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label class="checkbox-label">
                                          <input
                                            type="checkbox"
                                            v-model="
                                              handler.config.openInBackground
                                            "
                                          />
                                          Open in background
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                                <template
                                  v-if="
                                    handler.type === 'openApplication' &&
                                    handler.config
                                  "
                                >
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'basic')
                                      "
                                    >
                                      <i class="ph ph-gear"></i>
                                      <span>Basic</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'basic',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'basic',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Application Name</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="{argument}"
                                          v-model="
                                            handler.config.applicationName
                                          "
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <i class="ph ph-sliders"></i>
                                      <span>Options</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'options',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label class="checkbox-label">
                                          <input
                                            type="checkbox"
                                            v-model="handler.config.waitForExit"
                                          />
                                          Wait for exit
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                                <template
                                  v-if="
                                    handler.type === 'quitApplication' &&
                                    handler.config
                                  "
                                >
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'basic')
                                      "
                                    >
                                      <i class="ph ph-gear"></i>
                                      <span>Basic</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'basic',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'basic',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Application Name</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="{argument}"
                                          v-model="
                                            handler.config.applicationName
                                          "
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <i class="ph ph-sliders"></i>
                                      <span>Options</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'options',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label class="checkbox-label">
                                          <input
                                            type="checkbox"
                                            v-model="handler.config.forceQuit"
                                          />
                                          Force quit
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                                <template
                                  v-if="
                                    handler.type === 'executeShell' &&
                                    handler.config
                                  "
                                >
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'basic')
                                      "
                                    >
                                      <i class="ph ph-gear"></i>
                                      <span>Basic</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'basic',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'basic',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Command</label>
                                        <textarea
                                          class="form-control"
                                          rows="3"
                                          v-model="handler.config.command"
                                        ></textarea>
                                      </div>
                                    </div>
                                  </div>
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <i class="ph ph-sliders"></i>
                                      <span>Options</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'options',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Working Directory</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          v-model="
                                            handler.config.workingDirectory
                                          "
                                        />
                                      </div>
                                      <div class="config-field">
                                        <label>Timeout (ms)</label>
                                        <input
                                          type="number"
                                          class="form-control"
                                          v-model.number="
                                            handler.config.timeout
                                          "
                                        />
                                      </div>
                                      <div class="config-field">
                                        <label class="checkbox-label">
                                          <input
                                            type="checkbox"
                                            v-model="
                                              handler.config.runInBackground
                                            "
                                          />
                                          Run in background
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                                <template
                                  v-if="
                                    handler.type === 'segmentAction' &&
                                    handler.config
                                  "
                                >
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'basic')
                                      "
                                    >
                                      <i class="ph ph-gear"></i>
                                      <span>Basic</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'basic',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'basic',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Action</label>
                                        <select
                                          class="form-control"
                                          v-model="handler.config.action"
                                        >
                                          <option value="clear">
                                            Clear All
                                          </option>
                                          <option value="undo">
                                            Undo Last
                                          </option>
                                          <option value="replace">
                                            Replace
                                          </option>
                                          <option value="deleteLastN">
                                            Delete Last N
                                          </option>
                                          <option value="lowercaseFirstChar">
                                            Lowercase First Char
                                          </option>
                                          <option value="uppercaseFirstChar">
                                            Uppercase First Char
                                          </option>
                                          <option value="capitalizeFirstWord">
                                            Capitalize First Word
                                          </option>
                                          <option value="removePattern">
                                            Remove Pattern
                                          </option>
                                        </select>
                                      </div>
                                    </div>
                                  </div>
                                  <div
                                    class="config-section"
                                    v-if="
                                      handler.config.action === 'replace' ||
                                      handler.config.action === 'deleteLastN' ||
                                      handler.config.action === 'removePattern'
                                    "
                                  >
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <i class="ph ph-sliders"></i>
                                      <span>Options</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'options',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'options',
                                        )
                                      "
                                    >
                                      <div
                                        v-if="
                                          handler.config.action === 'replace'
                                        "
                                        class="config-field"
                                      >
                                        <label>Replacement Text</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="{argument}"
                                          v-model="
                                            handler.config.replacementText
                                          "
                                        />
                                      </div>
                                      <div
                                        v-if="
                                          handler.config.action ===
                                          'deleteLastN'
                                        "
                                        class="config-field"
                                      >
                                        <label>Count</label>
                                        <input
                                          type="number"
                                          class="form-control"
                                          min="1"
                                          v-model.number="handler.config.count"
                                        />
                                      </div>
                                      <div
                                        v-if="
                                          handler.config.action ===
                                          'removePattern'
                                        "
                                        class="config-field"
                                      >
                                        <label>Pattern to Remove</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="\\.\\.\\."
                                          v-model="handler.config.pattern"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </template>
                                <template
                                  v-if="
                                    handler.type === 'transformText' &&
                                    handler.config
                                  "
                                >
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'basic')
                                      "
                                    >
                                      <i class="ph ph-gear"></i>
                                      <span>Basic</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'basic',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'basic',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Replace Pattern</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="Pattern to find and replace (e.g. [\\.!?]+$)"
                                          v-model="
                                            handler.config.replacePattern
                                          "
                                        />
                                      </div>
                                      <div class="config-field">
                                        <label>Replace Flags</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="gimuy"
                                          maxlength="6"
                                          v-model="handler.config.replaceFlags"
                                        />
                                      </div>
                                      <div
                                        class="config-field"
                                        v-if="
                                          handler.config.replacementMode ===
                                            'literal' ||
                                          !handler.config.replacementMode
                                        "
                                      >
                                        <label>Replacement Text</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="Text to replace with (leave blank to remove)"
                                          v-model="handler.config.replacement"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'match')
                                      "
                                    >
                                      <i class="ph ph-magnifying-glass"></i>
                                      <span>Match Conditions</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'match',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'match',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Match Pattern (Optional)</label>
                                        <input
                                          type="text"
                                          class="form-control"
                                          placeholder="Regex to match text (e.g. ^.{0,50}$)"
                                          v-model="handler.config.matchPattern"
                                        />
                                        <span class="field-help"
                                          >Leave blank to apply to all
                                          text</span
                                        >
                                      </div>
                                      <div class="action-form-row">
                                        <div class="action-form-col">
                                          <label>Match Flags</label>
                                          <input
                                            type="text"
                                            class="form-control"
                                            placeholder="gimuy"
                                            maxlength="6"
                                            v-model="handler.config.matchFlags"
                                          />
                                        </div>
                                        <div class="action-form-col">
                                          <label>Max Length</label>
                                          <input
                                            type="number"
                                            class="form-control"
                                            placeholder="Optional"
                                            v-model.number="
                                              handler.config.maxLength
                                            "
                                          />
                                        </div>
                                        <div class="action-form-col">
                                          <label>Min Length</label>
                                          <input
                                            type="number"
                                            class="form-control"
                                            placeholder="Optional"
                                            v-model.number="
                                              handler.config.minLength
                                            "
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(
                                          handler.id,
                                          'advanced',
                                        )
                                      "
                                    >
                                      <i class="ph ph-faders"></i>
                                      <span>Advanced</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'advanced',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'advanced',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <label>Replacement Mode</label>
                                        <select
                                          class="form-control"
                                          v-model="
                                            handler.config.replacementMode
                                          "
                                        >
                                          <option value="literal">
                                            Literal Text
                                          </option>
                                          <option value="lowercase">
                                            Lowercase Match
                                          </option>
                                          <option value="uppercase">
                                            Uppercase Match
                                          </option>
                                        </select>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                                <template v-if="handler.type === 'cleanUrl'">
                                  <div class="config-section">
                                    <div
                                      class="config-section-header"
                                      @click="
                                        toggleConfigSection(handler.id, 'info')
                                      "
                                    >
                                      <i class="ph ph-info"></i>
                                      <span>Information</span>
                                      <i
                                        class="ph ph-caret-down collapse-icon"
                                        :class="{
                                          collapsed: !isConfigSectionExpanded(
                                            handler.id,
                                            'info',
                                          ),
                                        }"
                                      ></i>
                                    </div>
                                    <div
                                      class="config-section-body"
                                      v-show="
                                        isConfigSectionExpanded(
                                          handler.id,
                                          'info',
                                        )
                                      "
                                    >
                                      <div class="config-field">
                                        <div
                                          class="field-description"
                                          style="margin-top: 0"
                                        >
                                          Automatically clean spoken URLs (e.g.
                                          "google dot com" → "google.com").
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </template>

                                <div class="config-section">
                                  <div
                                    class="config-section-header"
                                    @click="
                                      toggleConfigSection(handler.id, 'timing')
                                    "
                                  >
                                    <i class="ph ph-clock"></i>
                                    <span>Timing & Queue</span>
                                    <i
                                      class="ph ph-caret-down collapse-icon"
                                      :class="{
                                        collapsed: !isConfigSectionExpanded(
                                          handler.id,
                                          'timing',
                                        ),
                                      }"
                                    ></i>
                                  </div>
                                  <div
                                    class="config-section-body"
                                    v-show="
                                      isConfigSectionExpanded(
                                        handler.id,
                                        'timing',
                                      )
                                    "
                                  >
                                    <div class="config-field">
                                      <label class="checkbox-label">
                                        <input
                                          type="checkbox"
                                          v-model="handler.applyToNextSegment"
                                        />
                                        Apply to Next Segment
                                      </label>
                                      <span class="field-help"
                                        >Queue this handler for the next segment
                                        instead of current</span
                                      >
                                    </div>
                                    <div class="config-field">
                                      <label class="checkbox-label">
                                        <input
                                          type="checkbox"
                                          v-model="handler.stopOnSuccess"
                                        />
                                        Stop on Success
                                      </label>
                                      <span class="field-help"
                                        >Stop executing subsequent handlers if
                                        this one success</span
                                      >
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Rules Editor -->
              <div v-if="field.type === 'rules-editor'">
                <div class="rules-editor-container">
                  <div class="rules-editor-toolbar">
                    <button
                      @click="addNewRule"
                      type="button"
                      class="btn btn-primary btn-sm"
                    >
                      <i class="ph-duotone ph-plus"></i> Add Rule
                    </button>
                    <button
                      @click="resetRulesToDefaults"
                      type="button"
                      class="btn btn-default btn-sm"
                    >
                      <i class="ph-duotone ph-arrow-clockwise"></i> Reset ({{
                        enabledRulesCount
                      }}/{{ totalRulesCount }}
                      enabled)
                    </button>
                  </div>
                  <div class="rules-list">
                    <div
                      v-if="!settings.rules?.length"
                      class="empty-rules-state"
                    >
                      <i class="ph-duotone ph-text-aa"></i>
                      <p>No rules configured</p>
                      <p class="empty-subtitle">
                        Add your first text transformation rule to get started
                      </p>
                    </div>
                    <div
                      v-for="(rule, index) in settings.rules || []"
                      :key="rule.id || index"
                      class="rule-card"
                      :class="{ expanded: expandedRules[rule.id || index] }"
                    >
                      <div
                        class="rule-card-header"
                        @click="toggleRuleCard(rule.id || index)"
                      >
                        <div class="rule-info">
                          <div class="rule-toggle">
                            <input
                              type="checkbox"
                              class="rule-enabled-checkbox checkbox"
                              v-model="rule.enabled"
                              @click.stop
                            />
                            <h4 class="rule-name" :title="rule.name">
                              {{ rule.name }}
                            </h4>
                          </div>
                          <p class="rule-description">
                            {{ rule.examples?.length || 0 }}
                            {{
                              (rule.examples?.length || 0) === 1
                                ? "example"
                                : "examples"
                            }}
                            <span
                              v-if="rule.if && rule.if.length > 0"
                              class="rule-conditions"
                            >
                              •
                              <span
                                v-for="(condition, idx) in rule.if"
                                :key="condition"
                                class="condition-tag"
                              >
                                <i
                                  :class="[
                                    'ph-duotone',
                                    getConditionIcon(condition),
                                  ]"
                                ></i>
                              </span>
                            </span>
                          </p>
                        </div>
                        <div class="rule-controls">
                          <i
                            class="ph-duotone ph-arrow-up rule-move-btn"
                            @click.stop="moveRule(index, -1)"
                            :class="{ disabled: index === 0 }"
                            title="Move up"
                          ></i>
                          <i
                            class="ph-duotone ph-arrow-down rule-move-btn"
                            @click.stop="moveRule(index, 1)"
                            :class="{
                              disabled:
                                index === (settings.rules?.length || 0) - 1,
                            }"
                            title="Move down"
                          ></i>
                          <button
                            type="button"
                            class="btn btn-icn-only btn-sm"
                            @click.stop="deleteRule(index)"
                            title="Delete rule"
                          >
                            <i class="ph-duotone ph-trash"></i>
                          </button>
                        </div>
                      </div>
                      <div
                        class="rule-card-body"
                        :class="{ collapsed: !expandedRules[rule.id || index] }"
                      >
                        <div class="rule-form-group">
                          <label>Instructions</label>
                          <input
                            type="text"
                            class="form-control"
                            v-model="rule.name"
                          />
                        </div>
                        <div class="rule-form-group">
                          <label>Requires (optional)</label>
                          <div class="conditions-list">
                            <label
                              class="condition-checkbox"
                              :class="{
                                active:
                                  rule.if && rule.if.includes('selection'),
                              }"
                            >
                              <input
                                type="checkbox"
                                :checked="
                                  rule.if && rule.if.includes('selection')
                                "
                                @change="
                                  updateRuleCondition(
                                    rule,
                                    'selection',
                                    $event.target.checked,
                                  )
                                "
                              />
                              <i class="ph-duotone ph-selection"></i>
                              Selection
                            </label>
                            <label
                              class="condition-checkbox"
                              :class="{
                                active: rule.if && rule.if.includes('context'),
                              }"
                            >
                              <input
                                type="checkbox"
                                :checked="
                                  rule.if && rule.if.includes('context')
                                "
                                @change="
                                  updateRuleCondition(
                                    rule,
                                    'context',
                                    $event.target.checked,
                                  )
                                "
                              />
                              <i class="ph-duotone ph-file-text"></i>
                              Document
                            </label>
                            <label
                              class="condition-checkbox"
                              :class="{
                                active:
                                  rule.if && rule.if.includes('writing_style'),
                              }"
                            >
                              <input
                                type="checkbox"
                                :checked="
                                  rule.if && rule.if.includes('writing_style')
                                "
                                @change="
                                  updateRuleCondition(
                                    rule,
                                    'writing_style',
                                    $event.target.checked,
                                  )
                                "
                              />
                              <i class="ph-duotone ph-pen-nib"></i>
                              Writing style
                            </label>
                          </div>
                        </div>
                        <div class="section-header-small">
                          <h5>Examples ({{ rule.examples?.length || 0 }})</h5>
                          <button
                            type="button"
                            class="btn btn-sm"
                            @click="addNewExample(index)"
                          >
                            <i class="ph-duotone ph-plus"></i> Add
                          </button>
                        </div>
                        <div class="examples-list">
                          <div
                            v-for="(example, eIndex) in rule.examples || []"
                            :key="eIndex"
                            class="example-item"
                          >
                            <div class="example-controls">
                              <div class="example-inputs">
                                <div class="example-column">
                                  <label>From</label>
                                  <textarea
                                    class="form-control example-textarea"
                                    placeholder="Input text..."
                                    v-model="example.from"
                                    rows="4"
                                  ></textarea>
                                </div>
                                <div class="example-column">
                                  <label>To</label>
                                  <textarea
                                    class="form-control example-textarea"
                                    placeholder="Expected output..."
                                    v-model="example.to"
                                    rows="4"
                                  ></textarea>
                                </div>
                              </div>
                              <button
                                type="button"
                                class="btn btn-icn-only btn-negative btn-sm example-delete-btn"
                                @click="deleteExample(index, eIndex)"
                                title="Delete example"
                              >
                                <i class="ph-duotone ph-trash"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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
            <div
              v-if="currentSection.id === 'data'"
              class="data-management-section"
            >
              <!-- Total Data Usage Summary -->
              <div class="total-data-usage-summary">
                <div class="usage-stats">
                  <div class="usage-item">
                    <i class="ph-duotone ph-chart-pie"></i>
                    <span class="usage-label">Total Usage:</span>
                    <span class="usage-value">{{
                      formatBytes(totalDataUsage)
                    }}</span>
                  </div>
                  <div class="usage-item">
                    <i class="ph-duotone ph-folder-simple"></i>
                    <span class="usage-label">Plugins with Data:</span>
                    <span class="usage-value">{{ pluginCountWithData }}</span>
                  </div>
                </div>
              </div>

              <div class="section-header-small">
                <h5>Plugin Data Management</h5>
                <div class="header-actions">
                  <button
                    type="button"
                    @click="clearAllPluginData"
                    class="btn btn-negative btn-sm"
                    :disabled="isClearingAll || !pluginDataInfo.length"
                    title="Clear all data from all plugins"
                  >
                    <i class="ph-duotone ph-trash"></i>
                    Clear All Data
                  </button>
                  <button
                    type="button"
                    @click="refreshDataManagement"
                    class="btn btn-sm refresh-btn"
                    title="Refresh data management"
                  >
                    <i class="ph-duotone ph-arrow-clockwise"></i> Refresh
                  </button>
                </div>
              </div>
              <div class="plugin-data-list">
                <div v-if="!pluginDataInfo.length" class="loading-indicator">
                  <i
                    class="ph-duotone ph-circle-notch"
                    style="animation: spin 1s linear infinite"
                  ></i
                  >Loading...
                </div>
                <template v-for="plugin in pluginDataInfo" :key="plugin.name">
                  <div
                    class="plugin-data-item"
                    :class="{ active: plugin.isActive }"
                  >
                    <div class="plugin-data-info">
                      <div class="plugin-data-info-content">
                        <div>
                          <div class="plugin-name">
                            {{ plugin.displayName }}
                            <span v-if="plugin.isActive" class="active-badge"
                              >Active</span
                            >
                          </div>
                          <div class="plugin-data-details-summary">
                            <span class="data-size"
                              ><i class="ph-duotone ph-hard-drive"></i>
                              {{ formatBytes(plugin.dataSize) }}</span
                            >
                          </div>
                        </div>
                        <div class="plugin-data-actions">
                          <button
                            type="button"
                            @click="togglePluginDetails(plugin.name)"
                            class="btn btn-sm plugin-details-btn"
                            title="View Details"
                          >
                            <i class="ph-duotone ph-list-bullets"></i>
                          </button>
                          <button
                            v-if="!plugin.isActive"
                            type="button"
                            @click="clearPluginData(plugin.name)"
                            class="btn btn-negative btn-sm"
                            title="Clear All"
                          >
                            <i class="ph-duotone ph-trash"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div
                      class="plugin-data-details"
                      v-if="expandedDataPlugins[plugin.name]"
                    >
                      <div class="plugin-data-details-header">
                        <h6>Data Items</h6>
                        <span class="item-count"
                          >{{
                            pluginDataItems[plugin.name]?.length || 0
                          }}
                          items</span
                        >
                      </div>
                      <div
                        v-if="!pluginDataItems[plugin.name]"
                        class="loading-indicator"
                      >
                        <i
                          class="ph-duotone ph-circle-notch"
                          style="animation: spin 1s linear infinite"
                        ></i
                        >Loading...
                      </div>
                      <div
                        v-else-if="!pluginDataItems[plugin.name].length"
                        class="empty-state"
                      >
                        <i class="ph-duotone ph-folder-open"></i>
                        <p>No data items found</p>
                      </div>
                      <div v-else class="plugin-data-items">
                        <div
                          v-for="item in pluginDataItems[plugin.name]"
                          :key="item.id"
                          class="plugin-data-item-detail"
                        >
                          <div class="item-info">
                            <div class="item-size">
                              {{ formatBytes(item.size) }}
                            </div>
                            <div class="item-name" :title="item.description">
                              {{ item.name }}
                            </div>
                          </div>
                          <div class="item-actions">
                            <button
                              type="button"
                              @click="
                                deletePluginDataItem(
                                  plugin.name,
                                  item.id,
                                  item.name,
                                )
                              "
                              class="btn btn-xs btn-negative delete-item-btn"
                              title="Delete"
                            >
                              <i class="ph-duotone ph-trash"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div v-if="currentSectionId !== 'permissions'" class="form-actions">
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
            <span v-else class="about-app-version"
              >Version {{ appVersion }}</span
            >
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
  </div>
</template>
<script>
import settingsComponent from "../scripts/settingsWindow.js";
export default settingsComponent;
</script>

<style>
@import "../styles/settings.less";
</style>
