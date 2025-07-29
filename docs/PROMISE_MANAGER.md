# PromiseManager Documentation

The `PromiseManager` is a singleton class that provides a centralized way to coordinate asynchronous operations across the WhisperMac application. It allows modules to wait for specific events or operations to complete before proceeding.

## Overview

The PromiseManager is designed to solve the problem of coordinating startup sequences and dependencies between different modules in the application. Instead of using complex callback chains or event listeners, modules can simply wait for the promises they depend on.

## Basic Usage

### Import the PromiseManager

```typescript
import { promiseManager } from "../core/PromiseManager";
```

### Starting a Promise

```typescript
// Start a new promise with optional initial data
promiseManager.start("my-operation", { initialData: "value" });
```

### Resolving a Promise

```typescript
// Resolve a promise with result data
promiseManager.resolve("my-operation", { result: "success", data: "value" });
```

### Rejecting a Promise

```typescript
// Reject a promise with an error
promiseManager.reject("my-operation", new Error("Something went wrong"));
```

### Waiting for a Promise

```typescript
// Wait for a single promise
try {
  const result = await promiseManager.waitFor("my-operation", 5000); // 5 second timeout
  console.log("Operation completed:", result);
} catch (error) {
  console.error("Operation failed:", error);
}
```

### Waiting for Multiple Promises

```typescript
// Wait for all promises to complete
try {
  const results = await promiseManager.waitForAll(
    ["operation-1", "operation-2", "operation-3"],
    10000
  );
  console.log("All operations completed:", results);
} catch (error) {
  console.error("Some operations failed:", error);
}
```

### Waiting for Any Promise

```typescript
// Wait for any of the promises to complete
try {
  const result = await promiseManager.waitForAny(
    ["operation-1", "operation-2"],
    5000
  );
  console.log("First completed operation:", result);
} catch (error) {
  console.error("All operations failed:", error);
}
```

## Application Startup Promises

The application uses several predefined promises for startup coordination:

### Core Startup Promises

- `app-initialization` - Resolved when the main app is fully initialized
- `models-check` - Resolved when model installation check is complete
- `modules-initialization` - Resolved when all modules are initialized
- `whisper-server-startup` - Resolved when the WhisperLive server is ready (auto-started on app launch)
- `audio-capture-ready` - Resolved when audio capture is ready (auto-started on app launch)
- `dictation-window-ready` - Resolved when the dictation window is ready

### Example: Waiting for Dependencies

```typescript
// In a module that needs the server to be ready
async startTranscription(): Promise<void> {
  // Wait for server to be ready (auto-started on app launch)
  await promiseManager.waitFor("whisper-server-startup", 30000);

  // Wait for audio capture to be ready (auto-started on app launch)
  await promiseManager.waitFor("audio-capture-ready", 10000);

  // Now safe to start transcription (server and audio capture are already running)
  await this.startTranscriptionProcess();
}
```

## Checking Promise Status

```typescript
// Check if a promise exists
if (promiseManager.hasPromise("my-operation")) {
  console.log("Promise exists");
}

// Get the status of a promise
const status = promiseManager.getPromiseStatus("my-operation");
// Returns: "pending" | "resolved" | "rejected" | "not-found"
```

## Statistics and Monitoring

```typescript
// Get statistics about all promises
const stats = promiseManager.getStats();
console.log("Total promises:", stats.total);
console.log("Pending:", stats.pending);
console.log("Resolved:", stats.resolved);
console.log("Rejected:", stats.rejected);
console.log("Average resolve time:", stats.averageResolveTime);

// Get all promise data
const allPromises = promiseManager.getAllPromises();
allPromises.forEach((promise) => {
  console.log(`${promise.id}: ${promise.status}`);
});
```

## Cleanup

```typescript
// Clear a specific promise
promiseManager.clearPromise("my-operation");

// Clear all promises (useful during shutdown)
promiseManager.clearAll();
```

## Best Practices

1. **Use descriptive names**: Choose clear, descriptive names for your promises
2. **Set appropriate timeouts**: Always set reasonable timeouts when waiting for promises
3. **Handle errors gracefully**: Always wrap `waitFor` calls in try-catch blocks
4. **Resolve promises promptly**: Don't leave promises pending indefinitely
5. **Clean up on shutdown**: Clear all promises during application shutdown

## Integration with Modules

Modules can use the PromiseManager to coordinate their initialization and operations:

```typescript
export class MyModule extends BaseModule {
  async onInitialize(): void {
    // Wait for dependencies
    await promiseManager.waitFor("dependency-ready", 5000);

    // Initialize this module
    await this.initializeModule();

    // Signal that this module is ready
    promiseManager.resolve("my-module-ready", { moduleId: this.getId() });
  }
}
```

## Error Handling

The PromiseManager provides robust error handling:

```typescript
try {
  await promiseManager.waitFor("critical-operation", 10000);
} catch (error) {
  if (error.message.includes("timed out")) {
    console.error("Operation timed out");
  } else if (error.message.includes("was rejected")) {
    console.error("Operation was rejected:", error);
  } else {
    console.error("Unknown error:", error);
  }
}
```

This centralized approach to managing asynchronous operations makes the application more reliable and easier to debug.
