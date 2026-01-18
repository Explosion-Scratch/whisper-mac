/**
 * Status and progress notification utilities.
 * Provides reactive state management for status messages and progress bars.
 */

/**
 * @typedef {Object} StatusState
 * @property {boolean} visible - Whether the status is visible
 * @property {string} message - The status message
 * @property {'success'|'error'|'warning'|'info'} type - The status type
 */

/**
 * @typedef {Object} ProgressState
 * @property {boolean} visible - Whether the progress is visible
 * @property {string} message - The progress message
 * @property {number} percent - The progress percentage (0-100)
 */

/**
 * Create initial status state
 * @returns {StatusState}
 */
export function createStatusState() {
  return {
    visible: false,
    message: "",
    type: "success",
  };
}

/**
 * Create initial progress state
 * @returns {ProgressState}
 */
export function createProgressState() {
  return {
    visible: false,
    message: "",
    percent: 0,
  };
}

/**
 * Show a status message
 * @param {StatusState} state - The status state object to modify
 * @param {string} message - The message to display
 * @param {'success'|'error'|'warning'|'info'} type - The status type
 * @param {number} timeout - How long to show the message (ms)
 * @returns {number} The timeout ID for cancellation
 */
export function showStatus(state, message, type = "success", timeout = 3000) {
  state.visible = true;
  state.message = message;
  state.type = type;

  return setTimeout(() => {
    state.visible = false;
  }, timeout);
}

/**
 * Hide a status message immediately
 * @param {StatusState} state - The status state object to modify
 */
export function hideStatus(state) {
  state.visible = false;
}

/**
 * Show a progress bar
 * @param {ProgressState} state - The progress state object to modify
 * @param {string} message - The progress message
 * @param {number} percent - The progress percentage (0-100)
 */
export function showProgress(state, message, percent) {
  state.visible = true;
  state.message = message;
  state.percent = Math.max(0, Math.min(100, percent));
}

/**
 * Hide the progress bar
 * @param {ProgressState} state - The progress state object to modify
 */
export function hideProgress(state) {
  state.visible = false;
}

/**
 * Update progress percentage only
 * @param {ProgressState} state - The progress state object to modify
 * @param {number} percent - The progress percentage (0-100)
 */
export function updateProgressPercent(state, percent) {
  state.percent = Math.max(0, Math.min(100, percent));
}

/**
 * Update progress message only
 * @param {ProgressState} state - The progress state object to modify
 * @param {string} message - The progress message
 */
export function updateProgressMessage(state, message) {
  state.message = message;
}
