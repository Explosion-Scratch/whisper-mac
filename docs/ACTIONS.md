# WhisperMac Unified Actions System

## Overview

The WhisperMac actions system provides a unified framework for handling all types of actions - from voice commands to text transformations. This document describes the architecture, configuration, and usage of the unified actions system.

## Architecture

### Core Concepts

1. **Actions**: High-level commands or transformations that can be triggered by voice or applied to text
2. **Handlers**: The actual operations that execute when an action is triggered
3. **Queued Actions**: Handlers that are stored and applied to the next segment instead of executing immediately
4. **Variable Interpolation**: Dynamic replacement of placeholders in handler configurations

### Unified Action Structure

Every action in the system follows the same structure:

```typescript
interface Action {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  patterns: string[];          // Regex patterns to match voice commands
  handlers: ActionHandlerConfig[]; // Operations to execute
  skipsTransformation?: boolean;   // Skip AI transformation when triggered
  skipsAllTransforms?: boolean;    // Skip all transformations (AI + default actions)
}
```

### Handler Types

All handlers use the same `ActionHandlerConfig` interface:

```typescript
interface ActionHandlerConfig {
  type: HandlerType;
  config?: any;                // Type-specific configuration
  applyToNextSegment?: boolean; // Queue for next segment
  skipsTransformation?: boolean; // Skip AI transformation for this handler
  skipsAllTransforms?: boolean;  // Skip all transformations for this handler
}
```

#### Available Handler Types

1. **openUrl** - Opens a URL in the default browser
   ```typescript
   config: { url: string }
   ```

2. **openApplication** - Launches an application
   ```typescript
   config: { appName: string }
   ```

3. **quitApplication** - Quits a running application
   ```typescript
   config: { appName: string }
   ```

4. **executeShell** - Executes a shell command
   ```typescript
   config: { command: string }
   ```

5. **segmentAction** - Performs operations on segments
   ```typescript
   config: {
     action: "delete" | "deleteAll" | "ellipses" | 
             "lowercaseFirst" | "uppercaseFirst" | 
             "capitalizeFirst" | "lowercase"
   }
   ```

6. **transformText** - Applies regex-based text transformations
   ```typescript
   config: {
     matchPattern?: string;      // Regex pattern to match
     matchFlags?: string;        // Regex flags (e.g., "gi")
     replacePattern: string;     // Replacement pattern
     replacement?: string;       // Direct replacement text
     replacementMode?: "literal" | "lowercase" | "uppercase";
     maxLength?: number;         // Max length constraint
     minLength?: number;         // Min length constraint
   }
   ```

## Transformation Skipping Options

### skipTransformation
When `skipsTransformation: true` is set on an action or handler:
- Only skips AI-powered transformations (Gemini, etc.)
- Default text transformation actions (punctuation trimming, case changes) still execute
- Useful for performance-critical actions like "open" or "search"

### skipAllTransforms
When `skipsAllTransforms: true` is set on an action or handler:
- Skips ALL transformations (both AI and default text transformations)
- No processing is applied to the text
- Useful for plugin-based actions that handle their own transformation logic

### Plugin Integration

Plugins can specify transformation skipping through their activation criteria:

```typescript
interface PluginActivationCriteria {
  pluginId: string;
  activationPatterns: string[];
  skipTransformation?: boolean;  // Skip AI transformations only
  skipAllTransforms?: boolean;    // Skip all transformations
}
```

## Default Actions and Transformations

### System Actions (skipAllTransforms)
Actions like "open", "search", "quit", "launch", and "close" are configured to skip all transformations for optimal performance:

```typescript
{
  id: "open",
  name: "Open Application",
  handlers: [{
    type: "openApplication",
    config: { appName: "{argument}" },
    skipsAllTransforms: true  // Skip all transformations for speed
  }]
}
```

### Text Transformation Actions (Default Behavior)
Text processing actions like punctuation trimming and case conversion maintain normal transformation behavior:

```typescript
{
  id: "trim_punctuation",
  name: "Trim Trailing Punctuation",
  handlers: [{
    type: "transformText",
    config: {
      matchPattern: "[.!?]+$",
      replacement: ""
    },
    skipsTransformation: false,  // Allow AI transformations
    skipsAllTransforms: false    // Allow all default transformations
  }]
}
```

## Push-to-Talk Mode Behavior

### Overview
Push-to-talk mode has special behavior to balance speed and text quality:

- **AI Transformations**: Skipped for immediate response
- **Default Text Transformations**: Executed for basic text cleanup
- **Voice Commands**: Still processed normally

### Configuration
Push-to-talk uses `skipTransformation: true` when processing segments, which:
- Allows immediate text output without AI processing delays
- Maintains default text transformation actions for basic cleanup
- Ensures commands like "This is short." become "this is short"

### Example Transformation
When dictating "This is short." with push-to-talk:
1. Raw transcript: "This is short."
2. Default actions execute:
   - Trim trailing period
   - Convert to lowercase
3. Final output: "this is short"
4. No AI transformation occurs (faster response)

## Queued Actions

Any handler can be queued for the next segment by setting `applyToNextSegment: true`. This allows actions to affect future transcription segments.

### How Queued Actions Work

1. When an action with `applyToNextSegment: true` is triggered, the handler is stored in a queue
2. When a new segment is added, all queued handlers are executed on that segment
3. The queue is cleared after processing

### Example: Ellipses Action

The ellipses action demonstrates queued handlers:

```javascript
{
  id: "ellipses",
  name: "Ellipses",
  description: "Remove trailing ellipses and lowercase next segment",
  patterns: ["ellipses"],
  handlers: [
    {
      type: "segmentAction",
      config: { action: "ellipses" }
    },
    {
      type: "segmentAction",
      config: { action: "lowercaseFirst" },
      applyToNextSegment: true  // Queue for next segment
    }
  ]
}
```

When triggered:
1. Immediately removes ellipses from the current segment
2. Queues lowercase transformation for the next segment

## Variable Interpolation

Handlers support dynamic variable replacement:

- `{match}` - The full matched text from the pattern
- `{argument}` - Extracted argument from the voice command
- `{pattern}` - The specific pattern that matched

### Example with Variables

```javascript
{
  id: "search_web",
  name: "Search Web",
  patterns: ["search for (.+)", "google (.+)"],
  handlers: [{
    type: "openUrl",
    config: {
      url: "https://google.com/search?q={argument}"
    }
  }]
}
```

## Text Transformations as Actions

Text transformations are now unified as actions with the `transformText` handler type. This provides consistent behavior and configuration.

### Simple Replacement

```javascript
{
  id: "lowercase_short",
  name: "Lowercase Short Responses",
  description: "Lowercase single words under 5 characters",
  patterns: [],  // No voice trigger
  handlers: [{
    type: "transformText",
    config: {
      matchPattern: "^.{1,4}$",
      replacementMode: "lowercase"
    }
  }]
}
```

### Regex-Based Transformation

```javascript
{
  id: "fix_spacing",
  name: "Fix Spacing",
  patterns: [],
  handlers: [{
    type: "transformText",
    config: {
      matchPattern: "\\s+",
      matchFlags: "g",
      replacement: " "
    }
  }]
}
```

## UI Integration

The settings interface provides a unified editor for all actions:

### Action Editor Features

1. **Name & Description**: Edit display name and description
2. **Enable/Disable**: Toggle individual actions
3. **Pattern Editor**: Add/remove voice command patterns with regex support
4. **Handler Editor**: Configure multiple handlers per action
5. **Handler Type Selection**: Choose from all available handler types
6. **Configuration Editor**: Type-specific configuration fields
7. **Queue Option**: Toggle `applyToNextSegment` for any handler
8. **Skip Options**: Control transformation skipping behavior
9. **Test Interface**: Preview how actions will behave

### UI Components

```html
<!-- Action List -->
<div class="actions-list">
  <!-- Each action shows name, status, pattern count -->
</div>

<!-- Action Editor -->
<div class="action-editor">
  <!-- Basic Info -->
  <input type="text" class="action-name" />
  <textarea class="action-description"></textarea>
  
  <!-- Patterns -->
  <div class="patterns-editor">
    <!-- Add/remove regex patterns -->
  </div>
  
  <!-- Handlers -->
  <div class="handlers-editor">
    <!-- Configure multiple handlers -->
    <select class="handler-type">
      <option value="openUrl">Open URL</option>
      <option value="transformText">Transform Text</option>
      <!-- ... -->
    </select>
    
    <!-- Dynamic config based on type -->
    <div class="handler-config">
      <!-- Type-specific fields -->
    </div>
    
    <!-- Queue option -->
    <label>
      <input type="checkbox" class="apply-to-next" />
      Apply to next segment
    </label>
    
    <!-- Skip options -->
    <label>
      <input type="checkbox" class="skip-transformation" />
      Skip AI transformation
    </label>
    
    <label>
      <input type="checkbox" class="skip-all-transforms" />
      Skip all transformations
    </label>
  </div>
</div>
```

## Categories of Actions

### 1. Command Actions
Execute operations like opening apps or URLs:
- Voice-triggered
- Immediate execution
- Skip all transformations for speed
- Can include queued follow-ups

### 2. Transform Actions  
Modify transcribed text:
- Pattern-based matching
- Regex transformations
- Normal transformation behavior
- Can be applied immediately or queued

### 3. System Actions
Built-in actions for common operations:
- Pre-configured with optimal skip settings
- Performance-optimized
- Covers common voice commands

## Configuration Storage

All actions are stored in the settings under a single `actions` array:

```json
{
  "actions": [
    {
      "id": "unique_id",
      "name": "Action Name",
      "description": "What this action does",
      "enabled": true,
      "patterns": ["voice pattern 1", "pattern 2"],
      "handlers": [
        {
          "type": "openUrl",
          "config": {
            "url": "https://example.com"
          },
          "skipsAllTransforms": true
        },
        {
          "type": "transformText",
          "config": {
            "matchPattern": "test",
            "replacement": "TEST"
          },
          "applyToNextSegment": true
        }
      ]
    }
  ]
}
```

## Migration from Legacy System

The system automatically migrates old configurations:

1. **Old Voice Commands** → New actions with appropriate handlers
2. **Old Text Transformations** → New actions with `transformText` handlers
3. **Separate Configs** → Unified actions array

## Best Practices

### Creating Effective Actions

1. **Use Descriptive Names**: Make actions easy to identify
2. **Clear Patterns**: Use specific regex patterns to avoid false triggers
3. **Combine Handlers**: Leverage multiple handlers for complex workflows
4. **Queue Wisely**: Use `applyToNextSegment` for natural language flow
5. **Skip Appropriately**: Use skip flags to optimize performance

### Performance Considerations

1. **Pattern Complexity**: Keep regex patterns efficient
2. **Handler Order**: Place most likely handlers first
3. **Transformation Chains**: Minimize redundant transformations
4. **Skip Wisely**: Use skip flags for speed-critical actions
5. **Push-to-Talk Optimization**: Default text transformations work in push-to-talk mode

### Testing Actions

1. **Test Patterns**: Verify voice commands match correctly
2. **Preview Transformations**: Check text modifications before saving
3. **Queue Behavior**: Test multi-segment workflows
4. **Skip Behavior**: Verify transformation skipping works as expected
5. **Push-to-Talk Testing**: Test with both short and long phrases

## Examples

### Open Documentation
```javascript
{
  id: "open_docs",
  name: "Open Documentation",
  patterns: ["open docs", "show documentation"],
  handlers: [{
    type: "openUrl",
    config: { url: "https://docs.whisper-mac.com" },
    skipsAllTransforms: true
  }]
}
```

### Smart Punctuation
```javascript
{
  id: "smart_punctuation",
  name: "Smart Punctuation",
  patterns: [],
  handlers: [
    {
      type: "transformText",
      config: {
        matchPattern: "\\?{2,}",
        matchFlags: "g",
        replacement: "?"
      }
    },
    {
      type: "transformText",
      config: {
        matchPattern: "!{2,}",
        matchFlags: "g",
        replacement: "!"
      }
    }
  ]
}
```

### Complex Workflow
```javascript
{
  id: "create_note",
  name: "Create Note",
  patterns: ["create note (.+)", "new note (.+)"],
  handlers: [
    {
      type: "openApplication",
      config: { appName: "Notes" },
      skipsAllTransforms: true
    },
    {
      type: "executeShell",
      config: { command: "echo '{argument}' | pbcopy" }
    },
    {
      type: "transformText",
      config: {
        matchPattern: "^",
        replacement: "Note: "
      },
      applyToNextSegment: true
    }
  ]
}
```

## Technical Implementation

### ConfigurableActionsService

The core service handles:
- Action detection in transcribed text
- Handler execution with variable interpolation  
- Queue management for deferred handlers
- Transformation skipping logic
- Event emission for UI updates

### Key Methods

```typescript
// Detect action in text
detectAction(text: string): ActionMatch | null

// Execute handlers for an action
async executeAction(action: Action, options?: ExecuteOptions)

// Execute specific handler type
async executeHandler(handler: ActionHandlerConfig, options?: ExecuteOptions)

// Process queued handlers on new segment
private async processQueuedHandlers(segment: Segment)

// Check transformation skipping flags
private shouldSkipTransformation(options?: ExecutionOptions): boolean
private shouldSkipAllTransforms(options?: ExecutionOptions): boolean
```

### Event System

The service emits events for UI synchronization:
- `action-detected`: When voice command matches
- `handler-executed`: After handler completion
- `handler-queued`: When handler is queued
- `queue-processed`: After processing queued handlers
- `transformation-skipped`: When skip flags prevent transformations

## Summary

The unified actions system provides:
- **Consistency**: All actions use the same interface
- **Flexibility**: Mix command and transform handlers
- **Power**: Queue handlers for complex workflows
- **Performance**: Skip transformations when appropriate
- **Simplicity**: One configuration, one UI

The enhanced skip flags provide granular control over transformation behavior:
- `skipsTransformation`: Skip AI transformations only
- `skipsAllTransforms`: Skip all transformations (AI + default)
- Push-to-talk mode optimization for speed while maintaining text quality

This architecture enables sophisticated voice-driven workflows while maintaining a clean, understandable configuration that users can easily customize through the settings interface.
