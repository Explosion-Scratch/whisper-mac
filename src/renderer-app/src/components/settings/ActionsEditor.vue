<template>
  <div class="actions-editor-container">
    <div class="actions-editor-toolbar">
      <button @click="addNewAction" type="button" class="btn btn-primary btn-sm">
        <i class="ph-duotone ph-plus"></i> Add Action
      </button>
      <button @click="resetActionsToDefaults" type="button" class="btn btn-default btn-sm">
        <i class="ph-duotone ph-arrow-clockwise"></i> Reset to Defaults
      </button>
    </div>
    <div class="actions-list">
      <div v-if="!actions?.length" class="empty-actions-state">
        <i class="ph-duotone ph-lightning"></i>
        <p>No actions configured</p>
        <p class="empty-subtitle">Add your first voice action to get started</p>
      </div>
      <div
        v-for="(action, index) in actions || []"
        :key="action.id"
        class="action-card"
      >
        <div class="action-card-header" @click.self="toggleActionCard(action.id)">
          <div class="action-info" @click="toggleActionCard(action.id)">
            <div class="action-toggle">
              <input
                type="checkbox"
                class="action-enabled-checkbox checkbox"
                v-model="action.enabled"
                @click.stop
              />
              <h4 class="action-name">{{ action.name }}</h4>
              <div class="action-badges">
                <span class="action-badge" :title="`${(action.matchPatterns || []).length} pattern(s)`">
                  <i class="ph ph-hash"></i>{{ (action.matchPatterns || []).length }}
                </span>
                <span class="action-badge" :title="`${(action.handlers || []).length} handler(s)`">
                  <i class="ph ph-lightning"></i>{{ (action.handlers || []).length }}
                </span>
              </div>
            </div>
            <p class="action-description">{{ action.description }}</p>
          </div>
          <div class="action-controls">
            <button type="button" class="btn btn-icn-only btn-compact" @click="moveAction(index, -1)" :disabled="index === 0" title="Move up">
              <i class="ph ph-caret-up"></i>
            </button>
            <button type="button" class="btn btn-icn-only btn-compact" @click="moveAction(index, 1)" :disabled="index === (actions?.length || 0) - 1" title="Move down">
              <i class="ph ph-caret-down"></i>
            </button>
            <button type="button" class="btn btn-icn-only btn-compact btn-negative" @click="deleteAction(index)" title="Delete action">
              <i class="ph ph-trash"></i>
            </button>
          </div>
        </div>
        <div class="action-card-body" :class="{ collapsed: !expandedActions[action.id] }">
          <div class="action-form-group">
            <label>Action Name</label>
            <input type="text" class="form-control" v-model="action.name" />
          </div>
          <div class="action-form-group">
            <label>Description</label>
            <input type="text" class="form-control" v-model="action.description" />
          </div>
          <div class="config-section">
            <div class="config-section-header" @click="toggleConfigSection(action.id, 'options')">
              <i class="ph ph-gear-six"></i>
              <span>Action Options</span>
              <i class="ph ph-caret-down collapse-icon" :class="{ collapsed: !isConfigSectionExpanded(action.id, 'options') }"></i>
            </div>
            <div class="config-section-body" v-show="isConfigSectionExpanded(action.id, 'options')">
              <div class="action-form-row">
                <div class="action-form-col">
                  <label class="checkbox-label"><input type="checkbox" v-model="action.closesTranscription" /> Closes Transcription</label>
                </div>
                <div class="action-form-col">
                  <label class="checkbox-label"><input type="checkbox" v-model="action.skipsTransformation" /> Skips Transformation</label>
                </div>
              </div>
              <div class="action-form-row" style="margin-top: 8px">
                <div class="action-form-col">
                  <label class="checkbox-label">
                    <input type="checkbox" v-model="action.applyToAllSegments" />
                    Apply to All Segments
                  </label>
                  <span class="field-help">Run on all segments after transcription</span>
                </div>
                <div class="action-form-col" v-if="action.applyToAllSegments">
                  <label>Timing Mode</label>
                  <select class="form-control" v-model="action.timingMode">
                    <option value="before_ai">Before AI (Default)</option>
                    <option value="after_ai">After AI</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- Match Patterns -->
          <div class="section-header-small">
            <h5>Match Patterns</h5>
            <button type="button" class="btn btn-sm" @click="addNewPattern(index)">
              <i class="ph ph-plus"></i> Add
            </button>
          </div>
          <div class="patterns-pills-container">
            <template v-for="(pattern, pIndex) in action.matchPatterns || []" :key="`pattern-${index}-${pIndex}`">
              <div
                v-if="pattern"
                class="pattern-pill"
                :class="{ editing: isPatternEditing(index, pIndex), 'case-sensitive': pattern && pattern.caseSensitive }"
                @click="editPattern(index, pIndex)"
              >
                <span class="pill-badge" :class="pattern.type ? `badge-${pattern.type}` : ''">
                  {{ getPatternTypeBadge(pattern.type || 'startsWith') }}
                </span>
                <span class="pill-text">{{ pattern.pattern || 'empty' }}</span>
                <button type="button" class="pill-delete" @click.stop="deletePattern(index, pIndex)" title="Delete pattern">
                  <i class="ph ph-x"></i>
                </button>
              </div>
            </template>
            <div
              v-if="editingPattern && editingPattern.actionIndex === index && editingPattern.patternIndex !== undefined && actions?.[index]?.matchPatterns?.[editingPattern.patternIndex]"
              class="inline-edit-form pattern-edit-form"
            >
              <select class="form-control form-control-sm" v-model="actions[index].matchPatterns[editingPattern.patternIndex].type">
                <option value="startsWith">Starts with</option>
                <option value="endsWith">Ends with</option>
                <option value="exact">Exact</option>
                <option value="regex">Regex</option>
              </select>
              <input
                type="text"
                class="form-control form-control-sm"
                placeholder="Pattern text..."
                v-model="actions[index].matchPatterns[editingPattern.patternIndex].pattern"
                @keydown.enter="closePatternEdit"
                @keydown.esc="closePatternEdit"
              />
              <label class="checkbox-label-inline">
                <input type="checkbox" v-model="actions[index].matchPatterns[editingPattern.patternIndex].caseSensitive" />
                Aa
              </label>
              <button type="button" class="btn btn-sm btn-primary" @click="closePatternEdit">
                <i class="ph ph-check"></i>
              </button>
            </div>
          </div>

          <!-- Action Handlers -->
          <div class="section-header-small">
            <h5>Action Handlers</h5>
            <button type="button" class="btn btn-sm" @click="addNewHandler(index)">
              <i class="ph ph-plus"></i> Add
            </button>
          </div>
          <div class="handlers-pills-container">
            <template v-for="(handler, hIndex) in action.handlers || []" :key="`handler-${index}-${hIndex}`">
              <div v-if="handler" class="handler-pill-wrapper">
                <div class="handler-pill" :class="{ expanded: isHandlerExpanded(index, hIndex) }" @click="toggleHandler(index, hIndex)">
                  <span class="handler-icon" :class="handler.type ? `icon-${handler.type}` : ''">
                    <i :class="getHandlerIcon(handler.type || '')"></i>
                  </span>
                  <span class="handler-type">{{ getHandlerTypeName(handler.type || '') }}</span>
                  <span class="handler-arrow">→</span>
                  <span class="handler-summary">{{ getHandlerSummary(handler) }}</span>
                  <button type="button" class="pill-delete" @click.stop="deleteHandler(index, hIndex)" title="Delete handler">
                    <i class="ph ph-x"></i>
                  </button>
                </div>
                <div class="handler-config-panel" v-show="isHandlerExpanded(index, hIndex) && handler.type">
                  <div class="handler-type-selector">
                    <label>Handler Type</label>
                    <select class="form-control" v-model="handler.type" @change="updateHandlerType(handler)">
                      <option value="openUrl">Open URL</option>
                      <option value="openApplication">Open Application</option>
                      <option value="quitApplication">Quit Application</option>
                      <option value="executeShell">Execute Shell</option>
                      <option value="segmentAction">Segment Action</option>
                      <option value="transformText">Transform Text</option>
                      <option value="cleanUrl">Clean Spoken URL</option>
                    </select>
                  </div>

                  <!-- Handler type configs -->
                  <template v-if="handler.type === 'openUrl' && handler.config">
                    <ConfigSection :handler-id="handler.id" section="basic" icon="ph-gear" label="Basic" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>URL Template</label>
                        <input type="text" class="form-control" placeholder="{argument}" v-model="handler.config.urlTemplate" />
                      </div>
                    </ConfigSection>
                    <ConfigSection :handler-id="handler.id" section="options" icon="ph-sliders" label="Options" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label class="checkbox-label"><input type="checkbox" v-model="handler.config.openInBackground" /> Open in background</label>
                      </div>
                    </ConfigSection>
                  </template>

                  <template v-if="handler.type === 'openApplication' && handler.config">
                    <ConfigSection :handler-id="handler.id" section="basic" icon="ph-gear" label="Basic" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Application Name</label>
                        <input type="text" class="form-control" placeholder="{argument}" v-model="handler.config.applicationName" />
                      </div>
                    </ConfigSection>
                    <ConfigSection :handler-id="handler.id" section="options" icon="ph-sliders" label="Options" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label class="checkbox-label"><input type="checkbox" v-model="handler.config.waitForExit" /> Wait for exit</label>
                      </div>
                    </ConfigSection>
                  </template>

                  <template v-if="handler.type === 'quitApplication' && handler.config">
                    <ConfigSection :handler-id="handler.id" section="basic" icon="ph-gear" label="Basic" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Application Name</label>
                        <input type="text" class="form-control" placeholder="{argument}" v-model="handler.config.applicationName" />
                      </div>
                    </ConfigSection>
                    <ConfigSection :handler-id="handler.id" section="options" icon="ph-sliders" label="Options" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label class="checkbox-label"><input type="checkbox" v-model="handler.config.forceQuit" /> Force quit</label>
                      </div>
                    </ConfigSection>
                  </template>

                  <template v-if="handler.type === 'executeShell' && handler.config">
                    <ConfigSection :handler-id="handler.id" section="basic" icon="ph-gear" label="Basic" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Command</label>
                        <textarea class="form-control" rows="3" placeholder="Enter shell command..." v-model="handler.config.command"></textarea>
                      </div>
                    </ConfigSection>
                    <ConfigSection :handler-id="handler.id" section="options" icon="ph-sliders" label="Options" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Working Directory</label>
                        <input type="text" class="form-control" placeholder="/tmp" v-model="handler.config.workingDirectory" />
                      </div>
                      <div class="config-field">
                        <label>Timeout (ms)</label>
                        <input type="number" class="form-control" v-model.number="handler.config.timeout" />
                      </div>
                      <div class="config-field">
                        <label class="checkbox-label"><input type="checkbox" v-model="handler.config.runInBackground" /> Run in background</label>
                      </div>
                    </ConfigSection>
                  </template>

                  <template v-if="handler.type === 'segmentAction' && handler.config">
                    <ConfigSection :handler-id="handler.id" section="basic" icon="ph-gear" label="Basic" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Action</label>
                        <select class="form-control" v-model="handler.config.action">
                          <option value="clear">Clear All</option>
                          <option value="deleteLastN">Delete Last N</option>
                          <option value="replace">Replace Text</option>
                          <option value="removePattern">Remove Pattern</option>
                          <option value="lowercaseFirstChar">Lowercase First Char</option>
                          <option value="uppercaseFirstChar">Uppercase First Char</option>
                          <option value="mergeWithPrevious">Merge with Previous</option>
                        </select>
                      </div>
                      <div class="config-field" v-if="handler.config.action === 'deleteLastN'">
                        <label>Count</label>
                        <input type="number" class="form-control" v-model.number="handler.config.count" min="1" />
                      </div>
                      <div class="config-field" v-if="handler.config.action === 'replace'">
                        <label>Replacement Text</label>
                        <input type="text" class="form-control" placeholder="{argument}" v-model="handler.config.replacementText" />
                      </div>
                      <div class="config-field" v-if="handler.config.action === 'removePattern'">
                        <label>Pattern to Remove</label>
                        <input type="text" class="form-control" v-model="handler.config.pattern" />
                      </div>
                      <template v-if="handler.config.action === 'mergeWithPrevious'">
                        <div class="config-field">
                          <label>Joiner</label>
                          <input type="text" class="form-control" v-model="handler.config.joiner" placeholder=" " />
                        </div>
                        <div class="config-field">
                          <label class="checkbox-label"><input type="checkbox" v-model="handler.config.trimPreviousPunctuation" /> Trim previous punctuation</label>
                        </div>
                      </template>
                    </ConfigSection>
                  </template>

                  <template v-if="handler.type === 'transformText' && handler.config">
                    <ConfigSection :handler-id="handler.id" section="basic" icon="ph-gear" label="Basic" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Replace Pattern</label>
                        <input type="text" class="form-control" v-model="handler.config.replacePattern" />
                      </div>
                      <div class="config-field">
                        <label>Replace Flags</label>
                        <input type="text" class="form-control" placeholder="gi" v-model="handler.config.replaceFlags" />
                      </div>
                      <div class="config-field">
                        <label>Replacement</label>
                        <input type="text" class="form-control" v-model="handler.config.replacement" />
                      </div>
                    </ConfigSection>
                    <ConfigSection :handler-id="handler.id" section="match" icon="ph-magnifying-glass" label="Match Conditions" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Match Pattern</label>
                        <input type="text" class="form-control" v-model="handler.config.matchPattern" />
                      </div>
                      <div class="config-field">
                        <label>Match Flags</label>
                        <input type="text" class="form-control" v-model="handler.config.matchFlags" />
                      </div>
                      <div class="config-field">
                        <label>Min Length</label>
                        <input type="number" class="form-control" v-model.number="handler.config.minLength" />
                      </div>
                      <div class="config-field">
                        <label>Max Length</label>
                        <input type="number" class="form-control" v-model.number="handler.config.maxLength" />
                      </div>
                    </ConfigSection>
                    <ConfigSection :handler-id="handler.id" section="advanced" icon="ph-faders" label="Advanced" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <label>Replacement Mode</label>
                        <select class="form-control" v-model="handler.config.replacementMode">
                          <option value="literal">Literal Text</option>
                          <option value="lowercase">Lowercase Match</option>
                          <option value="uppercase">Uppercase Match</option>
                        </select>
                      </div>
                    </ConfigSection>
                  </template>

                  <template v-if="handler.type === 'cleanUrl'">
                    <ConfigSection :handler-id="handler.id" section="info" icon="ph-info" label="Information" :config-sections="configSections" @toggle="toggleConfigSection">
                      <div class="config-field">
                        <div class="field-description" style="margin-top: 0">
                          Automatically clean spoken URLs (e.g. "google dot com" → "google.com").
                        </div>
                      </div>
                    </ConfigSection>
                  </template>

                  <!-- Timing & Queue (shared across all handler types) -->
                  <ConfigSection :handler-id="handler.id" section="timing" icon="ph-clock" label="Timing & Queue" :config-sections="configSections" @toggle="toggleConfigSection">
                    <div class="config-field">
                      <label class="checkbox-label">
                        <input type="checkbox" v-model="handler.applyToNextSegment" />
                        Apply to Next Segment
                      </label>
                      <span class="field-help">Queue this handler for the next segment instead of current</span>
                    </div>
                    <div class="config-field">
                      <label class="checkbox-label">
                        <input type="checkbox" v-model="handler.stopOnSuccess" />
                        Stop on Success
                      </label>
                      <span class="field-help">Stop executing subsequent handlers if this one success</span>
                    </div>
                  </ConfigSection>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  addAction,
  deleteAction as deleteActionUtil,
  addPattern,
  deletePattern as deletePatternUtil,
  addHandler,
  deleteHandler as deleteHandlerUtil,
  updateHandlerType as updateHandlerTypeUtil,
  getHandlerIcon,
  getHandlerTypeName,
  getHandlerSummary,
  getPatternTypeBadge,
  moveItem,
  resyncOrder,
} from '../../utils/actions-editor';
import { deepClone } from '../../utils/settings-store';
import ConfigSection from './ui/ConfigSection.vue';

export default {
  components: { ConfigSection },
  props: {
    settings: { type: Object, required: true },
    schema: { type: Array, required: true },
  },
  emits: ['status'],
  data() {
    return {
      expandedActions: {},
      editingPattern: null,
      expandedHandlers: {},
      configSections: {},
    };
  },
  computed: {
    actions() {
      return this.settings.actions?.actions || [];
    },
  },
  methods: {
    addNewAction() {
      addAction(this.settings);
    },
    deleteAction(index) {
      if (confirm('Delete this action?')) {
        deleteActionUtil(this.settings, index);
      }
    },
    moveAction(index, direction) {
      if (moveItem(this.settings.actions.actions, index, direction)) {
        resyncOrder(this.settings.actions.actions);
      }
    },
    toggleActionCard(actionId) {
      this.expandedActions[actionId] = !this.expandedActions[actionId];
    },
    resetActionsToDefaults() {
      if (confirm('Reset actions to defaults?')) {
        const actionsField = this.schema
          .find((s) => s.id === 'actions')
          ?.fields.find((f) => f.key === 'actions');
        if (actionsField) {
          this.settings.actions = deepClone(actionsField.defaultValue);
          this.$emit('status', 'Actions have been reset to default.', 'success');
        }
      }
    },
    addNewPattern(actionIndex) {
      addPattern(this.settings.actions.actions[actionIndex]);
    },
    deletePattern(actionIndex, patternIndex) {
      deletePatternUtil(this.settings.actions.actions[actionIndex], patternIndex);
    },
    addNewHandler(actionIndex) {
      addHandler(this.settings.actions.actions[actionIndex]);
    },
    deleteHandler(actionIndex, handlerIndex) {
      deleteHandlerUtil(this.settings.actions.actions[actionIndex], handlerIndex);
    },
    updateHandlerType(handler) {
      updateHandlerTypeUtil(handler, handler.type);
    },
    toggleConfigSection(itemId, sectionName) {
      const key = `${itemId}_${sectionName}`;
      this.configSections[key] = !this.configSections[key] ? true : !this.configSections[key];
    },
    isConfigSectionExpanded(itemId, sectionName) {
      return this.configSections[`${itemId}_${sectionName}`] !== false;
    },
    editPattern(actionIndex, patternIndex) {
      if (this.editingPattern?.actionIndex === actionIndex && this.editingPattern?.patternIndex === patternIndex) {
        this.editingPattern = null;
      } else {
        this.editingPattern = { actionIndex, patternIndex };
      }
    },
    closePatternEdit() {
      this.editingPattern = null;
    },
    isPatternEditing(actionIndex, patternIndex) {
      return this.editingPattern?.actionIndex === actionIndex && this.editingPattern?.patternIndex === patternIndex;
    },
    getPatternTypeBadge(type) {
      return getPatternTypeBadge(type);
    },
    toggleHandler(actionIndex, handlerIndex) {
      const key = `${actionIndex}_${handlerIndex}`;
      this.expandedHandlers[key] = !this.expandedHandlers[key];
    },
    isHandlerExpanded(actionIndex, handlerIndex) {
      return this.expandedHandlers[`${actionIndex}_${handlerIndex}`] || false;
    },
    getHandlerIcon(type) {
      return getHandlerIcon(type);
    },
    getHandlerTypeName(type) {
      return getHandlerTypeName(type);
    },
    getHandlerSummary(handler) {
      return getHandlerSummary(handler);
    },
  },
};
</script>
