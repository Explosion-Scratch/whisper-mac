/**
 * Actions editor CRUD operations and helper utilities.
 * Provides functions for creating, managing, and displaying voice actions.
 */

/**
 * Create a new action with default values
 * @returns {Object} A new action object
 */
export function createNewAction() {
  const now = Date.now();
  return {
    id: "action_" + now,
    name: "New Action",
    description: "A new voice-activated action.",
    enabled: true,
    order: 1,
    closesTranscription: false,
    skipsTransformation: false,
    applyToAllSegments: false,
    timingMode: "before_ai",
    matchPatterns: [createNewPattern()],
    handlers: [createNewHandler()],
  };
}

/**
 * Create a new match pattern with default values
 * @returns {Object} A new pattern object
 */
export function createNewPattern() {
  return {
    id: "pattern_" + Date.now(),
    type: "startsWith",
    pattern: "",
    caseSensitive: false,
  };
}

/**
 * Create a new handler with default values
 * @param {number} order - The handler order (default 1)
 * @returns {Object} A new handler object
 */
export function createNewHandler(order = 1) {
  return {
    id: "handler_" + Date.now(),
    type: "openUrl",
    config: {
      urlTemplate: "https://",
      openInBackground: false,
    },
    order,
    applyToNextSegment: false,
    applyToAllSegments: false,
    timingMode: "before_ai",
  };
}

const HANDLER_TYPE_CONFIGS = {
  openUrl: {
    urlTemplate: "https://",
    openInBackground: false,
  },
  openApplication: {
    applicationName: "{argument}",
  },
  quitApplication: {
    applicationName: "{argument}",
    forceQuit: false,
  },
  executeShell: {
    command: "",
    timeout: 10000,
  },
  segmentAction: {
    action: "replace",
    replacementText: "{argument}",
  },
  transformText: {
    matchPattern: "",
    matchFlags: "",
    replacePattern: "",
    replaceFlags: "g",
    replacement: "",
    replacementMode: "literal",
  },
};

/**
 * Update handler config when type changes
 * @param {Object} handler - The handler to update
 * @param {string} type - The new handler type
 */
export function updateHandlerType(handler, type) {
  if (!handler) return;

  handler.type = type;
  handler.config = { ...(HANDLER_TYPE_CONFIGS[type] || {}) };
  handler.applyToNextSegment = false;
  handler.applyToAllSegments = false;
  handler.timingMode = "before_ai";
}

const HANDLER_ICONS = {
  openUrl: "ph ph-link",
  openApplication: "ph ph-app-window",
  quitApplication: "ph ph-x-circle",
  executeShell: "ph ph-terminal",
  segmentAction: "ph ph-stack",
  transformText: "ph ph-text-aa",
};

/**
 * Get the icon class for a handler type
 * @param {string} type - The handler type
 * @returns {string} The icon class
 */
export function getHandlerIcon(type) {
  return HANDLER_ICONS[type] || "ph ph-gear";
}

const HANDLER_TYPE_NAMES = {
  openUrl: "Open URL",
  openApplication: "Open App",
  quitApplication: "Quit App",
  executeShell: "Shell",
  segmentAction: "Segment",
  transformText: "Transform",
};

/**
 * Get the display name for a handler type
 * @param {string} type - The handler type
 * @returns {string} The display name
 */
export function getHandlerTypeName(type) {
  return HANDLER_TYPE_NAMES[type] || type || "Unknown";
}

/**
 * Get a summary text for a handler's configuration
 * @param {Object} handler - The handler object
 * @returns {string} Summary text
 */
export function getHandlerSummary(handler) {
  if (!handler?.type) return "Configure...";
  if (!handler.config) return "No config set";

  const config = handler.config;

  switch (handler.type) {
    case "openUrl":
      return config.urlTemplate || "No URL set";
    case "openApplication":
      return config.applicationName || "No app set";
    case "quitApplication":
      return config.applicationName || "No app set";
    case "executeShell": {
      const cmd = config.command || "";
      return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd || "No command set";
    }
    case "segmentAction":
      return config.action || "No action set";
    case "transformText": {
      const pattern = config.replacePattern || "";
      return pattern ? `Replace: ${pattern}` : "No pattern set";
    }
    default:
      return "Configure...";
  }
}

const PATTERN_TYPE_BADGES = {
  startsWith: "START",
  endsWith: "END",
  exact: "EXACT",
  regex: "REGEX",
};

/**
 * Get the badge text for a pattern type
 * @param {string} type - The pattern type
 * @returns {string} The badge text
 */
export function getPatternTypeBadge(type) {
  return PATTERN_TYPE_BADGES[type] || (type ? type.toUpperCase() : "START");
}

/**
 * Move an item in an array by a direction (-1 for up, 1 for down)
 * @param {Array} array - The array to modify
 * @param {number} index - The current index of the item
 * @param {number} direction - The direction (-1 or 1)
 * @returns {boolean} Whether the move was successful
 */
export function moveItem(array, index, direction) {
  const newIndex = index + direction;

  if (newIndex >= 0 && newIndex < array.length) {
    [array[index], array[newIndex]] = [array[newIndex], array[index]];
    return true;
  }
  return false;
}

/**
 * Re-sync order properties after reordering
 * @param {Array} items - The items with order properties
 */
export function resyncOrder(items) {
  items.forEach((item, idx) => {
    item.order = idx + 1;
  });
}

/**
 * Add a new action to the settings
 * @param {Object} settings - The settings object
 */
export function addAction(settings) {
  if (!settings.actions) {
    settings.actions = { actions: [] };
  } else if (!Array.isArray(settings.actions.actions)) {
    settings.actions.actions = [];
  }

  const action = createNewAction();
  action.order = (settings.actions.actions.length || 0) + 1;
  action.matchPatterns[0].pattern = "trigger word ";
  action.handlers[0].config.urlTemplate = "https://www.google.com/search?q={argument}";
  settings.actions.actions.push(action);
}

/**
 * Delete an action from settings
 * @param {Object} settings - The settings object
 * @param {number} index - The action index to delete
 */
export function deleteAction(settings, index) {
  if (settings.actions?.actions) {
    settings.actions.actions.splice(index, 1);
  }
}

/**
 * Add a new pattern to an action
 * @param {Object} action - The action object
 */
export function addPattern(action) {
  if (!action.matchPatterns) {
    action.matchPatterns = [];
  }
  action.matchPatterns.push(createNewPattern());
}

/**
 * Delete a pattern from an action
 * @param {Object} action - The action object
 * @param {number} patternIndex - The pattern index to delete
 */
export function deletePattern(action, patternIndex) {
  if (action.matchPatterns) {
    action.matchPatterns.splice(patternIndex, 1);
  }
}

/**
 * Add a new handler to an action
 * @param {Object} action - The action object
 */
export function addHandler(action) {
  if (!action.handlers) {
    action.handlers = [];
  }
  const order = (action.handlers.length || 0) + 1;
  action.handlers.push(createNewHandler(order));
}

/**
 * Delete a handler from an action
 * @param {Object} action - The action object
 * @param {number} handlerIndex - The handler index to delete
 */
export function deleteHandler(action, handlerIndex) {
  if (action.handlers) {
    action.handlers.splice(handlerIndex, 1);
  }
}
