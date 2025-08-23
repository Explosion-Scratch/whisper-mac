# Core Utilities Architecture

This directory contains the refactored core utilities that were extracted from
the monolithic `main.ts` file. Each utility class has a single responsibility
and follows clean code principles.

## Architecture Overview

The main application (`WhisperMacApp`) now orchestrates these focused utility
classes instead of handling everything internally. This provides better
separation of concerns, testability, and maintainability.

## Utility Classes

### AppStateManager

- **Responsibility**: Manages application setup status and state transitions
- **Key Features**:
  - Tracks current setup status (idle, downloading-models, etc.)
  - Manages status change callbacks
  - Provides status messages for UI display
  - Integrates with tray service for status updates

### WindowManager

- **Responsibility**: Manages all browser window creation and lifecycle
- **Key Features**:
  - Creates and manages onboarding window
  - Creates and manages model manager window
  - Handles window focus and cleanup
  - Provides force close functionality for cleanup

### ShortcutManager

- **Responsibility**: Handles global keyboard shortcuts
- **Key Features**:
  - Registers/unregisters global shortcuts
  - Manages shortcut state tracking
  - Provides shortcut validation and status checking

### ErrorManager

- **Responsibility**: Centralized error handling and display
- **Key Features**:
  - Sets up global error handlers (uncaught exceptions, unhandled rejections)
  - Displays error dialogs with fallback options
  - Manages error window service integration
  - Provides specialized error handling (e.g., port conflicts)

### CleanupManager

- **Responsibility**: Handles application cleanup and shutdown
- **Key Features**:
  - Orchestrates cleanup of all services and windows
  - Manages cleanup timeouts and force quit scenarios
  - Handles transcription plugin cleanup
  - Cleans up IPC handlers and shortcuts

### DictationFlowManager

- **Responsibility**: Manages the complete dictation workflow
- **Key Features**:
  - Handles dictation start/stop/finish logic
  - Manages recording state and transitions
  - Processes audio segments and transcription updates
  - Handles segment accumulation and flushing
  - Manages dictation window state

### IpcHandlerManager

- **Responsibility**: Manages all IPC communication
- **Key Features**:
  - Sets up dictation control handlers
  - Manages model download IPC
  - Handles plugin switching IPC
  - Manages onboarding IPC handlers
  - Provides IPC cleanup functionality

### InitializationManager

- **Responsibility**: Handles application initialization flow
- **Key Features**:
  - Manages first-run vs regular initialization
  - Handles onboarding flow
  - Sets up data directories
  - Initializes plugins and services
  - Manages parallel initialization tasks

### TrayInteractionManager

- **Responsibility**: Handles tray and dock interactions
- **Key Features**:
  - Manages tray click handling
  - Handles dock icon interactions
  - Manages pending toggle state
  - Handles window visibility state
  - Integrates with settings and model manager windows

## Benefits of This Architecture

1. **Single Responsibility**: Each class has one clear purpose
2. **Testability**: Individual utilities can be unit tested in isolation
3. **Maintainability**: Changes to one area don't affect others
4. **Reusability**: Utilities can be reused or extended independently
5. **Readability**: The main app class is now much cleaner and easier to
   understand
6. **Dependency Injection**: Clear dependencies make the system more flexible

## Usage in Main App

The main `WhisperMacApp` class now:

- Creates and initializes all utility classes
- Orchestrates their interactions
- Provides a clean, high-level interface
- Maintains the same external API while being much more maintainable

## Migration Notes

- All functionality from the original `main.ts` has been preserved
- No breaking changes to the public API
- Improved error handling and state management
- Better separation of concerns
- Easier to extend and modify individual components
