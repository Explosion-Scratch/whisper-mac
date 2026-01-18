/**
 * Generic formatting utilities.
 * Provides functions for formatting bytes, URLs, and strings.
 */

/**
 * Format bytes to human-readable size string
 * @param {number} bytes - The number of bytes
 * @returns {string} Formatted size string (e.g., "1.5 MB")
 */
export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Convert a git repository URL to a browsable URL
 * @param {string} url - The git URL (e.g., "git+https://github.com/user/repo.git")
 * @returns {string} The browsable URL
 */
export function formatRepoUrl(url) {
  if (!url) return "";
  return url.replace("git+", "").replace(".git", "");
}

/**
 * Get the author URL from a repository URL
 * @param {string} repoUrl - The repository URL
 * @returns {string} The author/organization URL
 */
export function getAuthorUrl(repoUrl) {
  const cleanUrl = formatRepoUrl(repoUrl);
  return cleanUrl.split("/").slice(0, -1).join("/");
}

/**
 * Truncate a string with ellipsis
 * @param {string} str - The string to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Truncated string
 */
export function truncateString(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength) + "...";
}

/**
 * Open an external URL in the default browser
 * @param {string} url - The URL to open
 * @returns {Promise<void>}
 */
export async function openExternalUrl(url) {
  try {
    await window.electronAPI.openExternalUrl(url);
  } catch (error) {
    console.error("Failed to open external link:", error);
  }
}
