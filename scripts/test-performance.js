#!/usr/bin/env node

/**
 * Performance test script for dictation window launch
 *
 * This script helps measure the performance improvements made to the dictation window launch.
 *
 * Usage:
 * 1. Set skipSelectedTextRetrieval to true in AppConfig.ts for fastest startup
 * 2. Run the app and trigger dictation
 * 3. Check console logs for timing information
 */

console.log("=== WhisperMac Performance Test ===");
console.log("");
console.log("To test performance improvements:");
console.log("1. Set skipSelectedTextRetrieval to true in AppConfig.ts");
console.log("2. Launch the app");
console.log("3. Press Ctrl+D to start dictation");
console.log("4. Check console logs for timing breakdown:");
console.log("   - Clear segments: Xms");
console.log("   - Selected text retrieval: Xms (if enabled)");
console.log("   - Window creation: Xms");
console.log("   - Total time: Xms");
console.log("");
console.log("Expected improvements:");
console.log("- Window positioning: ~200-500ms faster (eliminated AppleScript)");
console.log("- Selected text: ~150-300ms faster (reduced delays)");
console.log("- Optional text retrieval: ~300-800ms faster (when disabled)");
console.log("");
console.log("Total expected improvement: 650-1600ms faster startup");
