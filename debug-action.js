// Debug script to test action detection
const testCases = [
  "Quit Zen",
  "Quit Zen.",
  "Quit Zen,",
  "quit zen",
  "quit zen.",
  "QUIT ZEN",
  "Quit Zen period",
  "Quit Zen comma",
];

function normalizeText(text) {
  return text.trim().replace(/[^\w\s]/g, "");
}

function testPattern(text, pattern) {
  const testText = pattern.caseSensitive ? text : text.toLowerCase();
  const testPattern = pattern.caseSensitive
    ? pattern.pattern
    : pattern.pattern.toLowerCase();

  if (testText.startsWith(testPattern)) {
    const argument = text.substring(pattern.pattern.length).trim();
    return { argument };
  }
  return null;
}

console.log("Testing action detection logic:\n");

testCases.forEach((testCase) => {
  const normalized = normalizeText(testCase);
  const pattern = {
    type: "startsWith",
    pattern: "quit ",
    caseSensitive: false,
  };
  const match = testPattern(normalized, pattern);

  console.log(`Input: "${testCase}"`);
  console.log(`Normalized: "${normalized}"`);
  console.log(`Match:`, match);
  console.log("---");
});
