# Actions Handler System

The Actions Handler System allows you to trigger specific actions by speaking certain keywords followed by arguments during dictation.

## How It Works

When you're dictating, the system continuously monitors your transcribed text for action patterns. If an action is detected, it immediately:

1. Executes the corresponding action handlers in order
2. **Conditionally** stops dictation and audio recording (based on action type)
3. **Conditionally** skips AI transformation (based on action type)
4. Hides the dictation window (only if transcription is stopped)

## Action Behavior Types

Actions can be configured with two key behavioral properties:

- **Closes Transcription**: When enabled, the action stops listening and closes the dictation window immediately after execution
- **Skips Transformation**: When enabled, the action bypasses AI transformation and injects the original transcribed text

### One-off Actions (Close Transcription + Skip Transformation)

These actions perform immediate tasks and end the dictation session:

- `open` - Opens applications, URLs, or files
- `search` - Performs web searches
- `quit` - Quits applications
- `launch/start` - Launches applications
- `close` - Closes current window/application

### Continuous Actions (Continue Transcription)

These actions modify the current dictation and allow you to continue speaking:

- `shell` - Transforms to "Write a shell command to..."
- `clear` - Clears all segments
- `undo` - Removes last segment
- Text replacement actions
- Segment transformations (lowercase, uppercase, etc.)

## Handler Types

Each action contains one or more handlers that execute in order. Handlers can:

1. **Execute immediately** on the current segment
2. **Queue for next segment** by setting `applyToNextSegment: true`

### Available Handler Types

#### 1. `openUrl`
Opens URLs in the default browser.

**Config:**
```json
{
  "urlTemplate": "https://example.com/{argument}",
  "openInBackground": false
}
```

#### 2. `openApplication`
Launches applications by name.

**Config:**
```json
{
  "applicationName": "{argument}"
}
```

#### 3. `quitApplication`
Quits running applications.

**Config:**
```json
{
  "applicationName": "{argument}",
  "forceQuit": false
}
```

#### 4. `executeShell`
Runs shell commands.

**Config:**
```json
{
  "command": "osascript -e 'tell application \"System Events\" to keystroke \"w\" using command down'",
  "runInBackground": false
}
```

#### 5. `segmentAction`
Manipulates transcript segments.

**Available Actions:**
- `clear` - Clear all segments
- `undo` - Delete last segment
- `replace` - Replace segment content
- `deleteLastN` - Delete N segments
- `lowercaseFirstChar` - Lowercase first character
- `uppercaseFirstChar` - Uppercase first character
- `capitalizeFirstWord` - Capitalize first word
- `removePattern` - Remove pattern from segment

## Queued Actions (Next Segment)

Handlers can be queued to apply to the **next** segment by setting `applyToNextSegment: true`. This allows actions to span multiple segments naturally.

### Example: Ellipses Transform

When you say "I was thinking...", the system:
1. Removes the "..." from the current segment
2. Queues a lowercase action for the next segment
3. When you say "About the weather", it becomes "about the weather"

**Action Configuration:**
```json
{
  "id": "ellipses-transform-action",
  "name": "Transform Ellipses",
  "handlers": [
    {
      "id": "remove-ellipses",
      "type": "segmentAction",
      "config": {
        "action": "removePattern",
        "pattern": "\\.\\.\\."
      },
      "order": 1
    },
    {
      "id": "lowercase-next",
      "type": "segmentAction",
      "config": {
        "action": "lowercaseFirstChar"
      },
      "order": 2,
      "applyToNextSegment": true
    }
  ]
}
```

### How Queued Actions Work

1. **Queue Storage**: Handlers marked with `applyToNextSegment: true` are stored in a queue
2. **Event-Driven**: When a new completed segment is added, queued handlers are processed
3. **Automatic Processing**: All queued handlers execute in order on the new segment
4. **Auto-Clearing**: Queue is cleared after processing

### Voice Flow Example

```
You say: "I was thinking..."
Result:  "I was thinking"
         [Queue: lowercaseFirstChar handler]

You say: "About the weather"
Result:  "about the weather"
         [Queue cleared]
```

## Built-in Actions

### `open [target]`

Opens an application, file, URL, or searches the web.

**Behavior:**

1. If the target is a URL (starts with http://, https://, or www.), opens it in the default browser
2. If the target matches an installed application name, opens that application
3. Otherwise, performs a Google search for the target and opens the first result

**Examples:**

- "open safari" - Opens Safari browser
- "open calculator" - Opens Calculator app
- "open google.com" - Opens Google in your default browser
- "open weather app" - Searches for "weather app" and opens the first result

### `search [query]`

Performs a web search for the specified query.

**Examples:**

- "search how to make coffee" - Searches Google for coffee making instructions
- "search weather in New York" - Searches for weather information

### `quit [application]`

Quits a specific application.

**Examples:**

- "quit Cursor" - Quits the Cursor application
- "quit Safari" - Quits the Safari browser

### `close`

Closes the current application window using Cmd+W.

**Examples:**

- "close" - Closes the current window or tab

### `shell [task]` or `shell`

Transforms the segment into a prompt for shell command generation.

**Examples:**

- "shell list files" → "Write a shell command to list files"
- "shell" → "Write a shell command to"

### `clear`

Clears all transcribed segments.

**Examples:**

- "clear" - Removes all segments

### `undo`

Deletes the last two segments (the previous segment and the "undo" command itself).

**Examples:**

- "undo" - Removes the last segment

## Creating Custom Actions

### Basic Action Structure

```json
{
  "id": "unique-action-id",
  "name": "Action Name",
  "description": "What the action does",
  "enabled": true,
  "order": 10,
  "closesTranscription": false,
  "skipsTransformation": false,
  "matchPatterns": [
    {
      "id": "pattern-1",
      "type": "startsWith",
      "pattern": "keyword ",
      "caseSensitive": false
    }
  ],
  "handlers": [
    {
      "id": "handler-1",
      "type": "segmentAction",
      "config": {
        "action": "replace",
        "replacementText": "Replaced text with {argument}"
      },
      "order": 1
    }
  ]
}
```

### Match Pattern Types

- **`exact`**: Exact match
- **`startsWith`**: Starts with pattern
- **`endsWith`**: Ends with pattern
- **`regex`**: Regular expression match

### Example: Comma Continuation

Continue a sentence after a comma without capitalizing:

```json
{
  "id": "comma-continuation",
  "name": "Comma Continuation",
  "description": "Insert comma and lowercase next segment",
  "enabled": true,
  "order": 15,
  "closesTranscription": false,
  "skipsTransformation": false,
  "matchPatterns": [
    {
      "id": "comma-pattern",
      "type": "regex",
      "pattern": ".*\\s+comma\\.?$",
      "caseSensitive": false
    }
  ],
  "handlers": [
    {
      "id": "remove-word-comma",
      "type": "segmentAction",
      "config": {
        "action": "removePattern",
        "pattern": "\\s+comma\\.?"
      },
      "order": 1
    },
    {
      "id": "lowercase-next",
      "type": "segmentAction",
      "config": {
        "action": "lowercaseFirstChar"
      },
      "order": 2,
      "applyToNextSegment": true
    }
  ]
}
```

**Voice Flow:**
```
Say: "I went to the store comma"
Result: "I went to the store,"
        [Queue: lowercaseFirstChar]

Say: "Bought some milk"
Result: "bought some milk"
```

### Example: New Paragraph

Start a new paragraph with proper capitalization:

```json
{
  "id": "new-paragraph",
  "name": "New Paragraph",
  "description": "Insert paragraph break and capitalize next",
  "enabled": true,
  "order": 19,
  "closesTranscription": false,
  "skipsTransformation": false,
  "matchPatterns": [
    {
      "id": "new-para-pattern",
      "type": "regex",
      "pattern": ".*new\\s+paragraph\\.?$",
      "caseSensitive": false
    }
  ],
  "handlers": [
    {
      "id": "remove-command",
      "type": "segmentAction",
      "config": {
        "action": "removePattern",
        "pattern": "\\s*new\\s+paragraph\\.?"
      },
      "order": 1
    },
    {
      "id": "capitalize-next",
      "type": "segmentAction",
      "config": {
        "action": "capitalizeFirstWord"
      },
      "order": 2,
      "applyToNextSegment": true
    }
  ]
}
```

## Variable Interpolation

Handlers support variable interpolation in config values:

- `{match}` - The full matched text
- `{argument}` - The extracted argument from the pattern
- `{pattern}` - The pattern that matched

**Example:**
```json
{
  "type": "openUrl",
  "config": {
    "urlTemplate": "https://www.google.com/search?q={argument}"
  }
}
```

## Action Detection Rules

- **Case Insensitive**: Actions work regardless of capitalization (unless `caseSensitive: true`)
- **Whitespace Handling**: Leading and trailing whitespace is automatically stripped
- **Pattern Matching**: Actions can use exact, startsWith, endsWith, or regex patterns
- **Real-time Processing**: Actions are detected as soon as a completed segment is processed
- **Handler Ordering**: Handlers execute in order based on the `order` property

## Technical Details

### Integration Points

The Actions Handler is integrated at two key points:

1. **Segment Manager**: Checks for actions when new transcribed segments are added
2. **ConfigurableActionsService**: Executes handlers and manages queued handlers

### Event Flow

1. Audio is captured and transcribed
2. Transcribed segments are added to the Segment Manager
3. Segment Manager checks for action patterns in completed segments
4. If an action is detected, handlers are executed
5. Handlers with `applyToNextSegment: true` are queued
6. When next segment arrives, queued handlers are processed

### Application Discovery

The system automatically discovers installed applications on startup by scanning the `/Applications` directory.

### Handler Processing

Each handler returns an `ActionResult`:

```typescript
interface ActionResult {
  success: boolean;
  shouldEndTranscription?: boolean;
  queuedHandlers?: ActionHandlerConfig[];
  error?: string;
}
```

This allows handlers to:
- Indicate success/failure
- Queue additional handlers for next segment
- Report errors

## Best Practices

1. **Start Simple**: Begin with basic segment actions
2. **Test Thoroughly**: Test with various speech patterns
3. **Use Queued Actions**: Leverage `applyToNextSegment` for natural flow
4. **Order Matters**: Set handler `order` appropriately
5. **Clear State**: Queue is automatically cleared after processing
6. **Log Everything**: Check console logs for debugging

## Debugging

### Logging

The system provides comprehensive logging:

```
[ConfigurableActions] Executing action: ellipses-transform-action
[ConfigurableActions] Queued handler lowercase-next for next segment
[ConfigurableActions] Processing 1 queued handler(s) on new segment
[ConfigurableActions] Lowercased first char: "about the weather"
```

### Inspection

Check queued handlers programmatically:

```typescript
const count = actionsService.getQueuedHandlersCount();
console.log(`Handlers in queue: ${count}`);
```

### Common Issues

**Actions Not Triggering**
- Verify pattern matching is correct
- Check action is enabled
- Review action order/priority

**Wrong Transformation**
- Verify correct handler type
- Check handler order
- Review `applyToNextSegment` flag

**Queue Not Processing**
- Ensure segment is marked as completed
- Check event listeners are active
- Verify SegmentManager is connected

## Future Enhancements

Potential improvements:

- Custom handler types
- Parameterized queued actions
- Multi-segment queue (apply to next N segments)
- Conditional queue (only if conditions met)
- Action chaining
- UI for managing actions in settings

## Conclusion

The Actions Handler System provides a powerful, flexible way to create voice commands that enhance your dictation workflow. By using handlers with `applyToNextSegment`, you can create natural, context-aware commands that span multiple segments.

