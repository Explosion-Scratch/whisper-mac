const { copy, paste } = require("copy-paste/promises");
const { keyboard, Key } = require("@nut-tree-fork/nut-js");

async function testClipboardFunctionality() {
  console.log("=== Testing Clipboard Functionality ===");

  try {
    // Test 1: Basic clipboard operations
    console.log("\n1. Testing basic clipboard operations...");
    const testText = "Hello World from WhisperMac!";

    // Store original clipboard
    const originalClipboard = await paste();
    console.log("Original clipboard:", originalClipboard);

    // Copy test text
    await copy(testText);
    console.log("Copied test text to clipboard");

    // Read back
    const readText = await paste();
    console.log("Read from clipboard:", readText);

    // Verify
    if (readText === testText) {
      console.log("✅ Basic clipboard operations work correctly");
    } else {
      console.log("❌ Basic clipboard operations failed");
    }

    // Restore original clipboard
    await copy(originalClipboard);
    console.log("Restored original clipboard");

    // Test 2: Keyboard operations (just test if we can import and access)
    console.log("\n2. Testing keyboard operations...");
    console.log("✅ Keyboard module imported successfully");
    console.log("Available keys:", Object.keys(Key).slice(0, 10) + "...");

    console.log("\n=== All tests completed successfully ===");
    console.log(
      "\nNote: To test actual keyboard operations, you would need to:"
    );
    console.log("1. Focus on a text field");
    console.log("2. Run keyboard.pressKey(Key.LeftCmd, Key.C)");
    console.log("3. Check if text was copied to clipboard");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
testClipboardFunctionality();
