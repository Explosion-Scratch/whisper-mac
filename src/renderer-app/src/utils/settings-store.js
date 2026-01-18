/**
 * Settings value access and persistence utilities.
 * Provides deep get/set operations for nested settings objects.
 */

/**
 * Get a setting value by dot-notation key
 * @param {Object} settings - The settings object
 * @param {string} key - Dot-notation key (e.g., 'ai.model')
 * @returns {*} The value at the key path, or undefined if not found
 */
export function getSettingValue(settings, key) {
  return key.split(".").reduce((o, i) => (o ? o[i] : undefined), settings);
}

/**
 * Set a setting value by dot-notation key
 * Creates intermediate objects if they don't exist
 * @param {Object} settings - The settings object to modify
 * @param {string} key - Dot-notation key (e.g., 'ai.model')
 * @param {*} value - The value to set
 */
export function setSettingValue(settings, key, value) {
  const keys = key.split(".");
  let temp = settings;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!temp[keys[i]]) temp[keys[i]] = {};
    temp = temp[keys[i]];
  }
  temp[keys[keys.length - 1]] = value;
}

/**
 * Standard field types that SettingsField component can handle
 */
const STANDARD_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "textarea",
  "slider",
  "directory",
  "hotkey",
];

/**
 * Check if a field type is handled by the standard SettingsField component
 * @param {string} type - The field type
 * @returns {boolean}
 */
export function isStandardFieldType(type) {
  return STANDARD_FIELD_TYPES.includes(type);
}

/**
 * Deep clone an object using JSON serialization
 * @param {*} obj - The object to clone
 * @returns {*} A deep clone of the object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if settings have changed from original
 * @param {Object} current - Current settings
 * @param {Object} original - Original settings
 * @returns {boolean}
 */
export function hasSettingsChanged(current, original) {
  return JSON.stringify(current) !== JSON.stringify(original);
}
