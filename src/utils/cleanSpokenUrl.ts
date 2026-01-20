/**
 * Robustly clean a spoken URL into a valid URL string.
 * Handles "dot com", "colon slash slash", "Hdb s", etc.
 * @param {string} text - The text to clean
 * @returns {string|null} The cleaned URL or null if invalid
 */
export const URL_FINDER_REGEX = /(?:https?|ftp|file|h[tbd][bpt][sp]?|w{3}|[a-z0-9.-]+\.(?:com|org|net|io|co|uk|us|gov|edu))[^\s]*/gi;

export default function cleanSpokenUrl(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  
  // Helper to remove trailing punctuation
  const removeTrailingPunctuation = (str: string): string => {
    return str.replace(/[.,?!:;]+$/, "");
  };
  
  let url = removeTrailingPunctuation(text);
  
  // Initial cleanup
  url = url.trim();
  
  // normalize common spoken artifacts
  url = url.replace(/^[,\.\s]+/i, ""); // leading punctuation
  
  // Spoken protocol: "Hdb s" -> "https"
  // Matches H[any char]b|t|e|p... s?
  // This is aggressive but fixes "Hdb s" -> "https"
  url = url.replace(/^h(\W?[tbd]\W?[bpt]\W?[sp])(\W?s)?/i, "https");
  // Also "http" without s
  if (!url.toLowerCase().startsWith("https")) {
     url = url.replace(/^h(\W?[tbd]\W?[bpt]\W?[bpt])/i, "http");
  }

  // "colon slash slash" -> "://"
  url = url.replace(/\W*(?:colon|:|cologne)\W*(?:slash|\/)\W*(?:slash|\/)\W*/gi, "://");
  
  // "dot" -> "."
  url = url.replace(/\W*(?:dot)\W*/gi, ".");
  
  // "slash" -> "/" (for paths)
  url = url.replace(/\W*(?:slash)\W*/gi, "/");
  
  // Fix spaces that shouldn't be there (simple heuristic: remove spaces around dots and slashes, then in the whole string if it looks like a domain)
  // Actually, URLs shouldn't have spaces.
  url = url.replace(/\s+/g, "");

  // Normalize protocol separators
  // Handle "http/" "https/" "http:" "https:" "http " "https " etc.
  // Replace "http[s]? + [non-word chars]" with "https://"
  // This covers "https://", "https/", "https:", "https "
  if (url.match(/^https?\W+/i)) {
    url = url.replace(/^https?\W+/i, "https://");
  }

  // Protocol check
  if (url.match(/^https?:\/\//i)) {
    // It has a protocol, looks good
  } else if (url.match(/^file:\/\//i)) {
    // file protocol
  } else {
    // No protocol, assume https if it looks like a domain
    if (url.includes(".") || url.startsWith("www")) {
       url = "https://" + url;
    } else {
      // Doesn't look like a URL
      return null;
    }
  }
  
  try {
    // Validate with URL constructor
    const urlObj = new URL(url);
    return urlObj.toString();
  } catch (e) {
    return null;
  }
}
