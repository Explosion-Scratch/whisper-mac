/**
 * Plugin registration and exports
 */
export {
  BaseTranscriptionPlugin,
  TranscriptionSetupProgress,
  PluginActivationCriteria,
} from "./TranscriptionPlugin";
export { TranscriptionPluginManager } from "./TranscriptionPluginManager";
export { YapTranscriptionPlugin } from "./YapTranscriptionPlugin";
export { WhisperCppTranscriptionPlugin } from "./WhisperCppTranscriptionPlugin";
export { VoskTranscriptionPlugin } from "./VoskTranscriptionPlugin";
export { GeminiTranscriptionPlugin } from "./GeminiTranscriptionPlugin";
export { MistralTranscriptionPlugin } from "./MistralTranscriptionPlugin";
export { ParakeetTranscriptionPlugin } from "./ParakeetTranscriptionPlugin";

import { TranscriptionPluginManager } from "./TranscriptionPluginManager";
import { YapTranscriptionPlugin } from "./YapTranscriptionPlugin";
import { WhisperCppTranscriptionPlugin } from "./WhisperCppTranscriptionPlugin";
import { VoskTranscriptionPlugin } from "./VoskTranscriptionPlugin";
import { GeminiTranscriptionPlugin } from "./GeminiTranscriptionPlugin";
import { MistralTranscriptionPlugin } from "./MistralTranscriptionPlugin";
import { ParakeetTranscriptionPlugin } from "./ParakeetTranscriptionPlugin";
import { AppConfig } from "../config/AppConfig";

/**
 * Initialize and register all transcription plugins
 */
export function createTranscriptionPluginManager(
  config: AppConfig,
): TranscriptionPluginManager {
  const pluginManager = new TranscriptionPluginManager(config);

  // Register YAP plugin
  const yapPlugin = new YapTranscriptionPlugin(config);
  pluginManager.registerPlugin(yapPlugin);

  // Register Whisper.cpp plugin
  const whisperCppPlugin = new WhisperCppTranscriptionPlugin(config);
  pluginManager.registerPlugin(whisperCppPlugin);

  // Register Vosk plugin
  const voskPlugin = new VoskTranscriptionPlugin(config);
  pluginManager.registerPlugin(voskPlugin);

  // Register Gemini plugin
  const geminiPlugin = new GeminiTranscriptionPlugin(config);
  pluginManager.registerPlugin(geminiPlugin);

  // Register Mistral plugin
  const mistralPlugin = new MistralTranscriptionPlugin(config);
  pluginManager.registerPlugin(mistralPlugin);

  // Register Parakeet plugin
  const parakeetPlugin = new ParakeetTranscriptionPlugin(config);
  pluginManager.registerPlugin(parakeetPlugin);

  return pluginManager;
}
