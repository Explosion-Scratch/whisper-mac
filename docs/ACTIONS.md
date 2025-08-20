# Actions Handler System

The Actions Handler System allows you to trigger specific actions by speaking certain keywords followed by arguments during dictation.

## How It Works

When you're dictating, the system continuously monitors your transcribed text for action patterns. If an action is detected, it immediately:

1. Executes the corresponding action
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
- Conditional transforms

## Built-in Actions

### `open [target]`

Opens an application, file, URL, or searches the web.

**Behavior:**

1. If the target is a URL (starts with http://, https://, or www.), opens it in the default browser
2. If the target is a file path (starts with /, ~/, or ./), opens the file
3. If the target matches an installed application name, opens that application
4. Otherwise, performs a Google search for the target and opens the first result

**Examples:**

- "open safari" - Opens Safari browser
- "open calculator" - Opens Calculator app
- "open google.com" - Opens Google in your default browser
- "open ~/Documents/file.txt" - Opens a file
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
- "quit Calculator" - Quits the Calculator app

### `close`

Closes the current application window using Cmd+W.

**Examples:**

- "close" - Closes the current window or tab

## Action Detection Rules

- **Case Insensitive**: Actions work regardless of capitalization
- **Whitespace Handling**: Leading and trailing whitespace is automatically stripped
- **Punctuation Removal**: Punctuation is stripped from both keywords and arguments for better matching
- **Pattern Matching**: Actions must follow the pattern `[keyword] [argument]`
- **Real-time Processing**: Actions are detected as soon as a completed segment is processed

## Application Discovery

The system automatically discovers installed applications on startup by scanning the `/Applications` directory. This allows the `open` action to quickly check if an application is installed before falling back to web search.

- Applications are discovered once during initialization to avoid repeated filesystem queries
- Application names are normalized (lowercase, no punctuation) for better matching
- The discovery process is logged for debugging purposes

## Technical Details

### Integration Points

The Actions Handler is integrated at two key points in the processing pipeline:

1. **Segment Manager**: Checks for actions when new transcribed segments are added
2. **Main Application**: Listens for action detection events and handles execution

### Event Flow

1. Audio is captured and transcribed
2. Transcribed segments are added to the Segment Manager
3. Segment Manager checks for action patterns in completed segments
4. If an action is detected, an event is emitted
5. Main application receives the event and executes the action
6. Dictation is stopped and window is hidden

### Open Action Implementation

The `open` action uses a priority-based approach:

1. **URL Detection**: Checks if the argument is a valid URL (http://, https://, www.)
2. **File Path Detection**: Checks if the argument is a file path (starts with /, ~/, ./)
3. **Application Lookup**: Checks against the pre-loaded list of installed applications
4. **Web Search Fallback**: Performs a Google search if no match is found

This ensures fast application launching while providing a useful fallback for unknown applications.

### Extensibility

The system is designed to be easily extensible. New actions can be configured by:

1. Creating a new `ActionHandler` object in the default actions config
2. Adding it to the actions configuration through the Settings UI
3. The action will automatically be available for use

### Action Ordering

Actions can be reordered in the Settings UI using the up/down arrow buttons:

- **Priority**: Actions are processed in order, so higher-priority actions should have lower order numbers
- **UI Controls**: Use the ↑ and ↓ buttons in the Actions settings to reorder
- **Automatic Numbering**: When actions are moved, their order numbers are automatically updated

### Segment Management Actions

The system supports advanced segment manipulation actions that can be triggered by voice:

#### Basic Actions

- **Clear**: Say "clear" or "clear." to remove all transcribed segments
- **Undo**: Say "undo" or "undo." to delete only the last segment

#### Content Replacement

- **Replace Segment**: Say "replace this with [text]" to replace current segment content
- **Shell Command Helper**:
  - Say "shell" to replace with "Write a shell command to"
  - Say "shell [task]" to replace with "Write a shell command to [task]"
  - Examples: "shell add commit and push" → "Write a shell command to add commit and push"

#### Bulk Operations

- **Delete Previous**: Say "delete this and the previous" to delete current and previous segments
- **Delete All**: Say "delete all past transcribed text" to clear all segments

#### Conditional Transforms

- **Ellipses Transform**: Automatically removes trailing "..." and applies transformations to subsequent segments
- **Smart Replacements**: Context-aware text replacements based on patterns

### Error Handling

- If an action fails to execute, an error event is emitted
- The application continues running normally
- Failed actions are logged for debugging

## Future Enhancements

Potential future improvements could include:

- Custom action registration through settings
- Action aliases and synonyms
- Context-aware actions
- Action history and undo functionality
- Integration with system automation tools
