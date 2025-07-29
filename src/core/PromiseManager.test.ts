import { promiseManager } from "./PromiseManager";

// Simple test to verify PromiseManager functionality
async function testPromiseManager() {
  console.log("Testing PromiseManager...");

  // Test 1: Basic promise lifecycle
  console.log("\n=== Test 1: Basic promise lifecycle ===");
  promiseManager.start("test-promise", { data: "initial" });

  // Wait for it in another async context
  setTimeout(() => {
    promiseManager.resolve("test-promise", { result: "success" });
  }, 100);

  try {
    const result = await promiseManager.waitFor("test-promise", 1000);
    console.log("✅ Promise resolved successfully:", result);
  } catch (error) {
    console.error("❌ Promise failed:", error);
  }

  // Test 2: Multiple promises
  console.log("\n=== Test 2: Multiple promises ===");
  promiseManager.start("promise-1");
  promiseManager.start("promise-2");
  promiseManager.start("promise-3");

  setTimeout(() => promiseManager.resolve("promise-1", { id: 1 }), 50);
  setTimeout(() => promiseManager.resolve("promise-2", { id: 2 }), 100);
  setTimeout(() => promiseManager.resolve("promise-3", { id: 3 }), 150);

  try {
    const results = await promiseManager.waitForAll(
      ["promise-1", "promise-2", "promise-3"],
      1000
    );
    console.log("✅ All promises resolved:", results);
  } catch (error) {
    console.error("❌ Some promises failed:", error);
  }

  // Test 3: Promise rejection
  console.log("\n=== Test 3: Promise rejection ===");
  promiseManager.start("error-promise");

  setTimeout(() => {
    promiseManager.reject("error-promise", new Error("Test error"));
  }, 50);

  try {
    await promiseManager.waitFor("error-promise", 1000);
    console.log("❌ Should have failed");
  } catch (error) {
    console.log(
      "✅ Promise correctly rejected:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 4: Timeout
  console.log("\n=== Test 4: Timeout ===");
  promiseManager.start("timeout-promise");

  try {
    await promiseManager.waitFor("timeout-promise", 100);
    console.log("❌ Should have timed out");
  } catch (error) {
    console.log(
      "✅ Promise correctly timed out:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 5: Statistics
  console.log("\n=== Test 5: Statistics ===");
  const stats = promiseManager.getStats();
  console.log("Promise Manager Stats:", stats);

  const allPromises = promiseManager.getAllPromises();
  console.log(
    "All Promises:",
    allPromises.map((p) => ({ id: p.id, status: p.status }))
  );

  // Clean up
  promiseManager.clearAll();
  console.log("\n✅ All tests completed!");
}

// Run the test if this file is executed directly
if (require.main === module) {
  testPromiseManager().catch(console.error);
}

export { testPromiseManager };
