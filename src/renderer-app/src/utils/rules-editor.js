/**
 * Rules editor CRUD operations and helper utilities.
 * Provides functions for creating, managing, and displaying AI transformation rules.
 */

/**
 * Create a new rule with default values
 * @returns {Object} A new rule object
 */
export function createNewRule() {
  return {
    id: "rule_" + Date.now(),
    name: "New Rule",
    enabled: true,
    examples: [createNewExample()],
  };
}

/**
 * Create a new example with default values
 * @returns {Object} A new example object
 */
export function createNewExample() {
  return {
    from: "",
    to: "",
  };
}

/**
 * Add a new rule to settings
 * @param {Object} settings - The settings object
 */
export function addRule(settings) {
  if (!settings.rules) {
    settings.rules = [];
  }
  settings.rules.push(createNewRule());
}

/**
 * Delete a rule from settings
 * @param {Object} settings - The settings object
 * @param {number} index - The rule index to delete
 */
export function deleteRule(settings, index) {
  if (settings.rules) {
    settings.rules.splice(index, 1);
  }
}

/**
 * Move a rule in the array by direction
 * @param {Array} rules - The rules array
 * @param {number} index - The current index
 * @param {number} direction - The direction (-1 or 1)
 * @returns {boolean} Whether the move was successful
 */
export function moveRule(rules, index, direction) {
  const newIndex = index + direction;

  if (newIndex >= 0 && newIndex < rules.length) {
    [rules[index], rules[newIndex]] = [rules[newIndex], rules[index]];
    return true;
  }
  return false;
}

/**
 * Add a new example to a rule
 * @param {Object} rule - The rule object
 */
export function addExample(rule) {
  if (!rule.examples) {
    rule.examples = [];
  }
  rule.examples.push(createNewExample());
}

/**
 * Delete an example from a rule
 * @param {Object} rule - The rule object
 * @param {number} exampleIndex - The example index to delete
 */
export function deleteExample(rule, exampleIndex) {
  if (rule.examples) {
    rule.examples.splice(exampleIndex, 1);
  }
}

/**
 * Update a condition on a rule
 * @param {Object} rule - The rule object
 * @param {string} condition - The condition to add/remove
 * @param {boolean} checked - Whether to add or remove
 */
export function updateRuleCondition(rule, condition, checked) {
  if (!rule.if) {
    rule.if = [];
  }

  if (checked && !rule.if.includes(condition)) {
    rule.if.push(condition);
  } else if (!checked && rule.if.includes(condition)) {
    rule.if = rule.if.filter((c) => c !== condition);
  }
}

const CONDITION_ICONS = {
  selection: "ph-selection",
  context: "ph-file-text",
  writing_style: "ph-pen-nib",
};

/**
 * Get the icon class for a condition
 * @param {string} condition - The condition type
 * @returns {string} The icon class
 */
export function getConditionIcon(condition) {
  return CONDITION_ICONS[condition] || "ph-gear";
}

const CONDITION_LABELS = {
  selection: "Selection",
  context: "Document",
  writing_style: "Writing style",
};

/**
 * Get the display label for a condition
 * @param {string} condition - The condition type
 * @returns {string} The display label
 */
export function getConditionLabel(condition) {
  return CONDITION_LABELS[condition] || condition;
}

/**
 * Get all available conditions
 * @returns {Array<{id: string, icon: string, label: string}>}
 */
export function getAvailableConditions() {
  return Object.keys(CONDITION_ICONS).map((id) => ({
    id,
    icon: CONDITION_ICONS[id],
    label: CONDITION_LABELS[id],
  }));
}
