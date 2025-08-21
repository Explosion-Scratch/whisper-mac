# Unified Plugin System

## Overview

The unified plugin system provides a standardized interface for all transcription plugins in Whisper Mac, enabling consistent lifecycle management, configuration, and user experience across different transcription engines.

## Architecture

### Core Components

1. **BaseTranscriptionPlugin** - Abstract base class defining the unified interface
2. **TranscriptionPluginManager** - Central manager for plugin registration and lifecycle
3. **UnifiedModelDownloadService** - Handles model downloads across different plugins
4. **Plugin-specific implementations** - Concrete implementations for each transcription engine

### Plugin Types

- **YapTranscriptionPlugin** - Uses macOS Speech Recognition (YAP)
- **WhisperCppTranscriptionPlugin** - Uses Whisper.cpp for local transcription
- **VoskTranscriptionPlugin** - Uses Vosk for offline speech recognition

## Unified Interface

### Required Methods

All plugins must implement these methods from `BaseTranscriptionPlugin`:

#### Core Plugin Information

```typescript
readonly name: string;           // Unique plugin identifier
readonly displayName: string;    // Human-readable name
readonly version: string;        // Plugin version
readonly description: string;    // Plugin description
readonly supportsRealtime: boolean;      // Real-time transcription support
readonly supportsBatchProcessing: boolean; // File transcription support
```

#### Lifecycle Management

```typescript
async initialize(): Promise<void>;           // Basic plugin setup (called on app launch)
async destroy(): Promise<void>;              // Plugin cleanup
async onActivated(uiFunctions?: PluginUIFunctions): Promise<void>;  // Main plugin setup and activation
async onDeactivate(): Promise<void>;         // Plugin deactivation
```

#### Configuration

```typescript
getOptions(): PluginOption[];                // Available configuration options
async verifyOptions(options: Record<string, any>): Promise<{ valid: boolean; errors: string[] }>;
async updateOptions(options: Record<string, any>, uiFunctions?: PluginUIFunctions): Promise<void>;
```

#### Data Management

```typescript
async clearData(): Promise<void>;            // Clear plugin data/cache
```

#### Transcription Methods

```typescript
async isAvailable(): Promise<boolean>;       // Check if plugin is ready
async startTranscription(onUpdate: (update: SegmentUpdate) => void, onProgress?: (progress: TranscriptionSetupProgress) => void, onLog?: (line: string) => void): Promise<void>;
async processAudioSegment(audioData: Float32Array): Promise<void>;
async transcribeFile(filePath: string): Promise<string>;
async stopTranscription(): Promise<void>;
async cleanup(): Promise<void>;
getConfigSchema(): TranscriptionPluginConfigSchema;
configure(config: Record<string, any>): void;
```

### State Management

Plugins maintain consistent state through the `PluginState` interface:

```typescript
interface PluginState {
  isLoading: boolean;
  loadingMessage?: string;
  downloadProgress?: ModelDownloadProgress;
  error?: string;
}
```

### UI Integration

Plugins can interact with the UI through the `PluginUIFunctions` interface:

```typescript
interface PluginUIFunctions {
  showProgress: (message: string, percent: number) => void;
  hideProgress: () => void;
  showDownloadProgress: (progress: ModelDownloadProgress) => void;
  showError: (error: string) => void;
  showSuccess: (message: string) => void;
  confirmAction: (message: string) => Promise<boolean>;
}
```

## Plugin Manager

### Initialization Timing

Plugin initialization follows a two-phase approach for optimal performance:

1. **App Launch Phase** - All plugins are initialized with basic setup

   - `initialize()` is called for all registered plugins
   - Lightweight operations only (binary checks, basic dependencies)
   - No heavy model loading or resource allocation
   - Ensures fast app startup

2. **Activation Phase** - Heavy setup when plugin becomes active
   - `onActivated()` is called only for the active plugin
   - Model validation and loading
   - Resource allocation and configuration
   - Heavy initialization work

This approach ensures that:

- App startup remains fast even with multiple plugins
- Resources are only allocated when needed
- Plugin switching is efficient
- Memory usage is optimized

### Registration and Management

```typescript
// Register plugins
pluginManager.registerPlugin(yapPlugin);
pluginManager.registerPlugin(whisperCppPlugin);
pluginManager.registerPlugin(voskPlugin);

// Get available plugins
const availablePlugins = await pluginManager.getAvailablePlugins();

// Set active plugin
await pluginManager.setActivePlugin("whisper-cpp", {
  model: "ggml-base.en.bin",
});
```

### Event System

The plugin manager forwards events from individual plugins:

- `plugin-registered` - New plugin registered
- `plugin-error` - Plugin encountered an error
- `plugin-state-changed` - Plugin state updated
- `plugin-download-progress` - Model download progress
- `active-plugin-changed` - Active plugin changed

## Configuration Options

### Plugin Options Schema

Each plugin defines its configuration options using the `PluginOption` interface:

```typescript
interface PluginOption {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "model-select";
  label: string;
  description: string;
  default: any;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
    size?: string;
  }>;
  min?: number;
  max?: number;
  required?: boolean;
  category?: "basic" | "advanced" | "model";
}
```

### Option Categories

- **basic** - Essential settings for most users
- **advanced** - Advanced configuration options
- **model** - Model selection and configuration

## Model Management

### Unified Download Service

The `UnifiedModelDownloadService` provides consistent model management across plugins:

```typescript
// Ensure model is available for a plugin
await unifiedService.ensureModelForPlugin("whisper-cpp", "ggml-base.en.bin");

// Switch to a different plugin with model
await unifiedService.switchToPlugin("vosk", "vosk-model-small-en-us-0.15");
```

### Model Download Progress

All plugins use the same progress tracking interface:

```typescript
interface ModelDownloadProgress {
  status: "starting" | "downloading" | "extracting" | "complete" | "error";
  progress: number;
  message: string;
  modelName?: string;
}
```

## Post-Processing

### Standardized Transcription Output

All plugins use the `PostProcessedTranscription` interface:

```typescript
interface PostProcessedTranscription {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
}
```

### Built-in Post-Processing

The base class provides common post-processing utilities:

- Timestamp parsing and normalization
- Text cleaning and normalization
- Confidence score extraction
- Segment combination for multi-line output

## Error Handling

### Consistent Error Management

All plugins follow the same error handling patterns:

1. **Validation errors** - Invalid configuration options
2. **Availability errors** - Plugin not ready or missing dependencies
3. **Model errors** - Missing or corrupted models
4. **Runtime errors** - Transcription failures

### Error Recovery

Plugins implement graceful error recovery:

- Automatic retry mechanisms
- Fallback to alternative configurations
- Clear error messages for users
- State restoration after errors

## IPC Integration

### Onboarding Support

The unified system integrates with the onboarding process:

```typescript
// Get all plugin options for UI
const allOptions = pluginManager.getAllPluginOptions();

// Verify plugin options
const validation = await pluginManager.verifyPluginOptions(
  "whisper-cpp",
  options
);

// Update active plugin options
await pluginManager.updateActivePluginOptions(options, uiFunctions);
```

### Settings Integration

Plugin configurations are automatically saved and restored:

- Settings persistence through `SettingsService`
- Configuration validation on load
- Automatic migration of old settings

## Usage Examples

### Basic Plugin Usage

```typescript
// Initialize plugin manager (happens on app launch)
const pluginManager = createTranscriptionPluginManager(config);
// All plugins are initialized with basic setup at this point

// Set active plugin (triggers onActivated with heavy initialization)
await pluginManager.setActivePlugin("whisper-cpp", {
  model: "ggml-base.en.bin",
  language: "en",
  threads: 4,
});
// onActivated() is called here, performing model validation and loading

// Start transcription
await pluginManager.startTranscription(
  (update) => console.log("Transcription:", update),
  (progress) => console.log("Progress:", progress)
);
```

### Plugin Switching

```typescript
// Switch from YAP to Whisper.cpp
await unifiedService.switchToPlugin("whisper-cpp", "ggml-base.en.bin");

// Switch to Vosk with specific model
await unifiedService.switchToPlugin("vosk", "vosk-model-small-en-us-0.15");
```

### Configuration Management

```typescript
// Get plugin options
const options = pluginManager.getPluginOptions("whisper-cpp");

// Update configuration
await pluginManager.updateActivePluginOptions({
  model: "ggml-small.en.bin",
  threads: 8,
});
```

## Benefits

### For Users

- **Consistent Experience** - Same UI and workflow across all plugins
- **Easy Switching** - Seamless transition between transcription engines
- **Unified Configuration** - Standardized settings interface
- **Better Error Handling** - Clear, actionable error messages

### For Developers

- **Extensible Architecture** - Easy to add new plugins
- **Code Reuse** - Common functionality in base class
- **Type Safety** - Strong TypeScript interfaces
- **Event-Driven** - Clean separation of concerns

### For Maintenance

- **Centralized Management** - Single point of control for all plugins
- **Consistent Lifecycle** - Standardized initialization and cleanup
- **Unified Logging** - Consistent error reporting and debugging
- **Configuration Validation** - Automatic option validation

## Future Enhancements

### Planned Features

1. **Plugin Marketplace** - Dynamic plugin loading and management
2. **Advanced Configuration** - Plugin-specific advanced settings
3. **Performance Metrics** - Plugin performance monitoring
4. **Plugin Dependencies** - Automatic dependency resolution
5. **Plugin Updates** - Automatic plugin updates and versioning

### Extension Points

The unified system is designed for easy extension:

- New plugin types can be added by extending `BaseTranscriptionPlugin`
- Additional configuration options can be added to the schema
- Custom post-processing can be implemented in plugins
- New UI integration points can be added to `PluginUIFunctions`
