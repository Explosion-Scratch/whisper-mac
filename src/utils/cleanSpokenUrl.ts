/**
 * Robustly clean a spoken URL into a valid URL string.
 * Handles "dot com", "colon slash slash", "Hdb s", etc.
 * @param {string} text - The text to clean
 * @returns {string|null} The cleaned URL or null if invalid
 */
export const URL_FINDER_REGEX =
  /(?:https?|ftp|file|h[tbd][bpt][sp]?|w{3}|[a-z0-9.-]+\.(?:com|org|net|io|co|uk|us|gov|edu))[^\s]*/gi;

/**
 * Pre-process text to normalize spoken URL components into their symbol equivalents.
 * This should be called BEFORE applying URL_FINDER_REGEX so that spoken URLs with spaces
 * get converted to proper URLs that the regex can match.
 *
 * Example: "Go to https: colon slash slash github dot com slash explosion hyphen scratch."
 * Becomes: "Go to https://github.com/explosion-scratch."
 *
 * @param {string} text - The full text that may contain spoken URLs
 * @returns {string} The text with spoken URL components normalized
 */
export function normalizeSpokenUrlInText(text: string): string {
  if (!text || typeof text !== "string") return text;

  let result = text;

  // Step 0: Remove garbled/duplicate protocol prefixes before valid URLs
  // Handles cases like "htdps: https://costco.com/" → "https://costco.com/"
  // Pattern matches: garbled protocol-like text (h followed by consonants) + optional colon/space
  // followed by a valid URL starting with http:// or https://
  result = result.replace(
    /\b[hH][a-zA-Z]{2,6}[sS]?[:\s]+(?=https?:\/\/)/gi,
    "",
  );

  // Also handle cases where garbled protocol has no separator: "htdpshttps://..."
  result = result.replace(/\b[hH][tTdDbBpP]{2,5}[sS]?(?=https?:\/\/)/gi, "");

  // Step 1: Handle "protocol colon slash slash" or "protocol: colon slash slash" pattern
  // This captures: "https: colon slash slash ..." or "https colon slash slash ..."
  // The URL body pattern captures words that may be separated by:
  // - Spoken punctuation (dot, slash, hyphen, dash)
  // - Plain spaces (for multi-word names like "open ai" → "openai")
  // The pattern uses negative lookahead to stop BEFORE common stop words
  const stopWords =
    "and|or|but|the|a|an|to|for|in|on|at|by|with|is|are|was|were|it|this|that|which|who|where|when|how|why|if|so|as|of|from";
  const urlBodyPattern = new RegExp(
    `\\b(https?|h[tbd][bpt][sp]?s?|ftp|file)\\s*:?\\s*colon\\s+slash\\s+slash\\s+((?:(?!\\b(?:${stopWords})\\b)[a-z0-9]+(?:\\s+(?:dot|slash|hyphen|dash)\\s+|\\s+(?=(?!\\b(?:${stopWords})\\b)[a-z0-9]))?)*)(?=\\s*[.!?]?\\s*$|\\s*[.!?]\\s|\\s+[A-Z]|\\s+(?:${stopWords})\\b)`,
    "gi",
  );
  result = result.replace(urlBodyPattern, (match, protocol, urlBody) => {
    let cleanProtocol = protocol.toLowerCase();
    if (cleanProtocol.match(/^h[tbd][bpt][sp]?s?$/i)) {
      cleanProtocol = "https";
    }

    // Clean the URL body - convert spoken punctuation to symbols
    // Also handle typos like "come" → "com"
    let cleanBody = urlBody
      .trim()
      .replace(/\bcome\b/gi, "com") // Common mistranscription
      .replace(/\s+dot\s+/gi, ".")
      .replace(/\s+slash\s+/gi, "/")
      .replace(/\s+hyphen\s+/gi, "-")
      .replace(/\s+dash\s+/gi, "-")
      .replace(/\s+colon\s+/gi, ":")
      .replace(/\s+/g, ""); // Remove any remaining spaces (handles "open ai" → "openai")

    return `${cleanProtocol}://${cleanBody}`;
  });

  // Step 2: Handle "www dot ..." patterns (no protocol)
  const wwwPattern = new RegExp(
    `\\bwww\\s+dot\\s+((?:(?!\\b(?:${stopWords})\\b)[a-z0-9]+(?:\\s+(?:dot|slash|hyphen|dash)\\s+|\\s+(?=(?!\\b(?:${stopWords})\\b)[a-z0-9]))?)*)(?=\\s*[.!?]?\\s*$|\\s*[.!?]\\s|\\s+[A-Z]|\\s+(?:${stopWords})\\b)`,
    "gi",
  );
  result = result.replace(wwwPattern, (match, urlBody) => {
    let cleanBody = urlBody
      .trim()
      .replace(/\bcome\b/gi, "com")
      .replace(/\s+dot\s+/gi, ".")
      .replace(/\s+slash\s+/gi, "/")
      .replace(/\s+hyphen\s+/gi, "-")
      .replace(/\s+dash\s+/gi, "-")
      .replace(/\s+/g, "");

    return `https://www.${cleanBody}`;
  });

  // Step 3: Handle domain patterns like "github dot com slash something"
  // This catches URLs without explicit protocol that have recognizable TLDs
  // Only match if not already preceded by "://" (to avoid double-processing)
  // Also skip if we're in the middle of a URL (preceded by a dot or slash)
  const domainPattern = new RegExp(
    `(?<!:\\/\\/[^\\s]*)(?<![\\.\\/:])(^|\\s)([a-z0-9]+)\\s+dot\\s+(com|org|net|io|co|uk|us|gov|edu|come)((?:\\s+(?:slash|hyphen|dash)\\s+(?!\\b(?:${stopWords})\\b)[a-z0-9]+)*)(?=\\s*[.!?]?\\s*$|\\s*[.!?]\\s|\\s+[A-Z]|\\s+(?:${stopWords})\\b)`,
    "gi",
  );
  result = result.replace(domainPattern, (match, prefix, domain, tld, path) => {
    let cleanUrl = `${domain}.${tld}${path || ""}`
      .replace(/\bcome\b/gi, "com")
      .replace(/\s+dot\s+/gi, ".")
      .replace(/\s+slash\s+/gi, "/")
      .replace(/\s+hyphen\s+/gi, "-")
      .replace(/\s+dash\s+/gi, "-")
      .replace(/\s+/g, "");

    return `${prefix}https://${cleanUrl}`;
  });

  return result;
}

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
  url = url.replace(
    /\W*(?:colon|:|cologne)\W*(?:slash|\/)\W*(?:slash|\/)\W*/gi,
    "://",
  );

  // "dot" -> "."
  url = url.replace(/\W*(?:dot)\W*/gi, ".");

  // "slash" -> "/" (for paths)
  url = url.replace(/\W*(?:slash)\W*/gi, "/");

  // "hyphen" or "dash" -> "-"
  url = url.replace(/\W*(?:hyphen|dash)\W*/gi, "-");

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
