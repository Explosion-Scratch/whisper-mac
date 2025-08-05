#!/usr/bin/env node

/**
 * Performance test script for dictation window launch
 *
 * This script helps measure the performance improvements made to the dictation window launch.
 *
 * Usage:
 * 1. Run the app and trigger dictation
 * 2. Check console logs for timing information
 */

console.log("=== WhisperMac Performance Test ===");
console.log("");
console.log("To test performance improvements:");
console.log("1. Launch the app");
console.log("2. Press Ctrl+D to start dictation");
console.log("3. Check console logs for timing breakdown:");
console.log("   - Clear segments: Xms");
console.log("   - Selected text retrieval: Xms");
console.log("   - Window creation: Xms");
console.log("   - Total time: Xms");
console.log("");
console.log("Expected improvements:");
console.log("- Window positioning: ~200-500ms faster (eliminated AppleScript)");
console.log("- Selected text: ~150-300ms faster (reduced delays)");
console.log("");
console.log("Total expected improvement: 350-800ms faster startup");
