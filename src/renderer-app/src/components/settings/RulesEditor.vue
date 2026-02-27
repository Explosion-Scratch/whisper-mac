<template>
  <div class="rules-editor-container">
    <div class="rules-editor-toolbar">
      <button @click="addNewRule" type="button" class="btn btn-primary btn-sm">
        <i class="ph-duotone ph-plus"></i> Add Rule
      </button>
      <button @click="resetRulesToDefaults" type="button" class="btn btn-default btn-sm">
        <i class="ph-duotone ph-arrow-clockwise"></i> Reset ({{ enabledRulesCount }}/{{ totalRulesCount }} enabled)
      </button>
    </div>
    <div class="rules-list">
      <div v-if="!rules?.length" class="empty-rules-state">
        <i class="ph-duotone ph-text-aa"></i>
        <p>No rules configured</p>
        <p class="empty-subtitle">Add your first text transformation rule to get started</p>
      </div>
      <div
        v-for="(rule, index) in rules || []"
        :key="rule.id || index"
        class="rule-card"
        :class="{ expanded: expandedRules[rule.id || index] }"
      >
        <div class="rule-card-header" @click="toggleRuleCard(rule.id || index)">
          <div class="rule-info">
            <div class="rule-toggle">
              <input type="checkbox" class="rule-enabled-checkbox checkbox" v-model="rule.enabled" @click.stop />
              <h4 class="rule-name" :title="rule.name">{{ rule.name }}</h4>
            </div>
            <p class="rule-description">
              {{ rule.examples?.length || 0 }}
              {{ (rule.examples?.length || 0) === 1 ? 'example' : 'examples' }}
              <span v-if="rule.if && rule.if.length > 0" class="rule-conditions">
                •
                <span v-for="(condition, idx) in rule.if" :key="condition" class="condition-tag">
                  <i :class="['ph-duotone', getConditionIcon(condition)]"></i>
                </span>
              </span>
            </p>
          </div>
          <div class="rule-controls">
            <i class="ph-duotone ph-arrow-up rule-move-btn" @click.stop="moveRule(index, -1)" :class="{ disabled: index === 0 }" title="Move up"></i>
            <i class="ph-duotone ph-arrow-down rule-move-btn" @click.stop="moveRule(index, 1)" :class="{ disabled: index === (rules?.length || 0) - 1 }" title="Move down"></i>
            <button type="button" class="btn btn-icn-only btn-sm" @click.stop="deleteRule(index)" title="Delete rule">
              <i class="ph-duotone ph-trash"></i>
            </button>
          </div>
        </div>
        <div class="rule-card-body" :class="{ collapsed: !expandedRules[rule.id || index] }">
          <div class="rule-form-group">
            <label>Instructions</label>
            <input type="text" class="form-control" v-model="rule.name" />
          </div>
          <div class="rule-form-group">
            <label>Requires (optional)</label>
            <div class="conditions-list">
              <label
                v-for="cond in conditions"
                :key="cond.value"
                class="condition-checkbox"
                :class="{ active: rule.if && rule.if.includes(cond.value) }"
              >
                <input
                  type="checkbox"
                  :checked="rule.if && rule.if.includes(cond.value)"
                  @change="updateRuleConditionHandler(rule, cond.value, $event.target.checked)"
                />
                <i :class="['ph-duotone', cond.icon]"></i>
                {{ cond.label }}
              </label>
            </div>
          </div>
          <div class="section-header-small">
            <h5>Examples ({{ rule.examples?.length || 0 }})</h5>
            <button type="button" class="btn btn-sm" @click="addNewExample(index)">
              <i class="ph-duotone ph-plus"></i> Add
            </button>
          </div>
          <div class="examples-list">
            <div v-for="(example, eIndex) in rule.examples || []" :key="eIndex" class="example-item">
              <div class="example-controls">
                <div class="example-inputs">
                  <div class="example-column">
                    <label>From</label>
                    <textarea class="form-control example-textarea" placeholder="Input text..." v-model="example.from" rows="4"></textarea>
                  </div>
                  <div class="example-column">
                    <label>To</label>
                    <textarea class="form-control example-textarea" placeholder="Expected output..." v-model="example.to" rows="4"></textarea>
                  </div>
                </div>
                <button type="button" class="btn btn-icn-only btn-negative btn-sm example-delete-btn" @click="deleteExample(index, eIndex)" title="Delete example">
                  <i class="ph-duotone ph-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  addRule,
  deleteRule as deleteRuleUtil,
  moveRule as moveRuleUtil,
  addExample,
  deleteExample as deleteExampleUtil,
  updateRuleCondition,
  getConditionIcon,
} from '../../utils/rules-editor';
import { deepClone } from '../../utils/settings-store';

export default {
  props: {
    settings: { type: Object, required: true },
    schema: { type: Array, required: true },
  },
  emits: ['status'],
  data() {
    return {
      expandedRules: {},
      conditions: [
        { value: 'selection', icon: 'ph-selection', label: 'Selection' },
        { value: 'context', icon: 'ph-file-text', label: 'Document' },
        { value: 'writing_style', icon: 'ph-pen-nib', label: 'Writing style' },
      ],
    };
  },
  computed: {
    rules() {
      return this.settings.rules || [];
    },
    enabledRulesCount() {
      return this.rules.filter((r) => r.enabled).length;
    },
    totalRulesCount() {
      return this.rules.length;
    },
  },
  methods: {
    addNewRule() {
      addRule(this.settings);
    },
    deleteRule(index) {
      if (confirm('Delete this rule?')) {
        deleteRuleUtil(this.settings, index);
      }
    },
    moveRule(index, direction) {
      moveRuleUtil(this.settings.rules, index, direction);
    },
    toggleRuleCard(ruleId) {
      this.expandedRules[ruleId] = !this.expandedRules[ruleId];
    },
    resetRulesToDefaults() {
      if (confirm('Reset rules to defaults?')) {
        const rulesField = this.schema
          .find((s) => s.id === 'ai')
          ?.fields.find((f) => f.key === 'rules');
        if (rulesField) {
          this.settings.rules = deepClone(rulesField.defaultValue);
          this.$emit('status', 'Rules have been reset to default.', 'success');
        }
      }
    },
    addNewExample(ruleIndex) {
      addExample(this.settings.rules[ruleIndex]);
    },
    deleteExample(ruleIndex, exampleIndex) {
      deleteExampleUtil(this.settings.rules[ruleIndex], exampleIndex);
    },
    updateRuleConditionHandler(rule, condition, checked) {
      updateRuleCondition(rule, condition, checked);
    },
    getConditionIcon(condition) {
      return getConditionIcon(condition);
    },
  },
};
</script>
