/**
 * Plugin registration and exports
 */
export { TranscriptionPlugin, BaseTranscriptionPlugin, TranscriptionSetupProgress, TranscriptionPluginConfigSchema } from "./TranscriptionPlugin";
export { TranscriptionPluginManager } from "./TranscriptionPluginManager";
export { YapTranscriptionPlugin } from "./YapTranscriptionPlugin";
export { WhisperCppTranscriptionPlugin } from "./WhisperCppTranscriptionPlugin";

import { TranscriptionPluginManager } from "./TranscriptionPluginManager";
import { YapTranscriptionPlugin } from "./YapTranscriptionPlugin";
import { WhisperCppTranscriptionPlugin } from "./WhisperCppTranscriptionPlugin";
import { AppConfig } from "../config/AppConfig";

/**
 * Initialize and register all transcription plugins
 */
export function createTranscriptionPluginManager(config: AppConfig): TranscriptionPluginManager {
  const pluginManager = new TranscriptionPluginManager(config);

  // Register YAP plugin
  const yapPlugin = new YapTranscriptionPlugin(config);
  pluginManager.registerPlugin(yapPlugin);

  // Register Whisper.cpp plugin  
  const whisperCppPlugin = new WhisperCppTranscriptionPlugin(config);
  pluginManager.registerPlugin(whisperCppPlugin);

  return pluginManager;
}
