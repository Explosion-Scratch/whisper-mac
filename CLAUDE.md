# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development Commands

- `bun run build` - TypeScript compilation and asset copying
- `bun run start` - Launch Electron app
- `bun run dev` - Development mode with hot reload (uses nodemon + concurrent build/start)
- `bun run setup:plugins` - Setup transcription plugins (yap, whisper-cpp)
- `bun run prep` - Prepare plugins and VAD assets
- `bun run icons` - Generate app icons
- `bun run build:mac` - Build for macOS (includes icons, plugins, prep)
- `bun run pack:prod` - Production build as directory

### Testing Commands

- No specific test runner configured, but tests can be run directly with Node.js:
  `node dist/core/PromiseManager.test.js`
  `node dist/services/AiValidationService.test.js`

### Utility Commands

- `bun run fullclean` - Complete cleanup including dist/.crush/build files
- `bun run clear:userdata` - Clear user data and app support directories
- `bun run dist` - Electron builder with packaging
- `bun run pack` - Electron builder directory build

### Package Management

- Uses Bun instead of npm/yarn
- `bun install` - Install dependencies
- `bun run postinstall` - Auto-runs preparation after install

## Architecture Overview

### Core Application Structure

Electron-based menu bar app for AI-powered dictation using multiple transcription engines (Whisper.cpp, YAP/Automatic Speech Recognition).

### Main Entry Point (src/main.ts)

- Central orchestrator managing all services and state
- Handles onboarding flow, plugin management, global shortcuts
- Controls startup sequence with parallel initialization tasks
- Manages dictation workflow through complex state machine (recording, finishing, accumulating modes)

### Key Services

1. **TranscriptionPluginManager** - Plugin system for different transcription engines

   - Supports YAP (Apple Speech), Whisper.cpp, Vosk, Mistral, and Gemini plugins
   - Manages plugin lifecycle (init, switch, cleanup)
   - Handles audio segment processing and transcription updates

2. **AudioCaptureService** - Handles audio capture and processing

   - Integrates with VAD (Voice Activity Detection) in the browser
   - Manages audio permissions and capture flow

3. **DictationWindowService** - UI overlay for transcription display

   - Preloaded for instant display
   - Supports multiple positioning modes
   - Handles real-time transcription updates

4. **SegmentManager** - Manages text segment lifecycle

   - Accumulating mode for real-time display vs auto-transformation
   - Text transformation and injection pipeline
   - State management for in-progress segments

5. **TransformationService** - AI-powered text enhancement
   - Integration with external AI services (Cerebras API support)
   - Configurable writing styles and system prompts
   - Text transformation pipeline

### Plugin Architecture

- Modular plugin system in `src/plugins/`
- Each plugin implements the `TranscriptionPlugin` interface
- Plugins register with the manager and handle their own initialization
- Current plugins: `YapTranscriptionPlugin`, `WhisperCppTranscriptionPlugin`, `VoskTranscriptionPlugin`, `MistralTranscriptionPlugin`, `GeminiTranscriptionPlugin`

### Configuration System

- Schema-based settings in `src/config/SettingsSchema.ts`
- Settings manager with validation
- Supports nested configuration structure with multiple field types
- Sections: Onboarding, Transcription, General, Dictation Window, AI Enhancement, Advanced, Actions Editor, Rules Editor

### UI Windows

- **Onboarding Window** - First-run setup and configuration
- **Settings Window** - Main settings interface
- **Dictation Window** - Real-time transcription overlay
- **Error Window** - Error display and resolution
- Multiple preload mechanisms for faster startup

### Data Flow

1. Global shortcuts trigger dictation workflow
2. Dictation window shows immediately, starts VAD audio processing
3. Audio segments sent to active transcription plugin
4. Transcription updates flow to segment manager
5. Optional AI enhancement through transformation service
6. Text injection via accessibility API

### State Management

- Complex state machine in main.ts with clear states (idle, recording, finishing)
- Promise-based coordination through PromiseManager singleton
- Event-driven architecture between services

### Build System

- TypeScript compilation to `dist/`
- Asset copying via custom scripts
- Electron integration for packaging
- Bundles whisper.cpp binaries and YAP plugin

### Key Design Patterns

- Event-driven architecture with EventEmitter
- Plugin system for extensibility
- Service-oriented architecture
- Promise-based async coordination
- State machine for UI/control flow

## Development Notes

### First Run Setup

- App runs onboarding flow on first launch
- Downloads Whisper models if needed
- Handles accessibility permissions
- Sets up initial configuration

### Voice Processing Pipeline

1. VAD detects speech segments
2. Audio segments sent to transcription plugin
3. Plugin returns transcription results
4. Segments processed and displayed
5. Optional AI transformation applied
6. Text injected via accessibility APIs

### Error Handling

- Global error handlers in main process
- Plugin-level error management
- User-friendly error display windows
- Fallback dialog systems

### Performance Considerations

- Window preloading for instant display
- Parallel initialization tasks
- Audio processing in browser/worker threads
- Memory management for audio buffers

### Integration Points

- Accessibility API for text injection
- Global shortcuts for quick activation
- Menu bar icon for status indication
- Dock icon activation handling
