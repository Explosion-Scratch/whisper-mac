import { resolve } from "path";
import { readPrompt } from "../helpers/getPrompt";
import { app } from "electron";
import { getDefaultActionsConfig } from "./DefaultActions";
import { readFileSync } from "fs";

// Default history settings
const DEFAULT_HISTORY_MAX_RECORDINGS = 100;

export interface SettingsField {
  key: string;
  type:
    | "text"
    | "number"
    | "boolean"
    | "select"
    | "textarea"
    | "slider"
    | "directory"
    | "actions-editor"
    | "rules-editor"
    | "hotkey";
  label: string;
  description?: string;
  defaultValue: any;
  options?: Array<{ value: any; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  validation?: (value: any) => string | null;
}

export interface SettingsSection {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  fields: SettingsField[];
}

export const SETTINGS_SCHEMA: SettingsSection[] = [
  {
    id: "onboarding",
    title: "Onboarding",
    description: "First-run setup flags",
    icon: "settings",
    fields: [
      {
        key: "onboardingComplete",
        type: "boolean",
        label: "Onboarding Complete",
        description: "Internal flag to skip the welcome flow",
        defaultValue: false,
      },
    ],
  },
  {
    id: "transcription",
    title: "Transcription",
    description: "Choose transcription engine and model",
    icon: "waveform",
    fields: [],
  },

  {
    id: "dictation",
    title: "Dictation Window",
    description: "Appearance and behavior of the dictation overlay",
    icon: "window",
    fields: [
      {
        key: "selectedMicrophone",
        type: "select",
        label: "Selected Microphone",
        description: "Choose which microphone to use for audio capture",
        defaultValue: "default",
        options: [], // Will be populated dynamically with available microphones
      },
      {
        key: "dictationWindowPosition",
        type: "select",
        label: "Window Position",
        description: "Where to position the dictation window",
        defaultValue: "screen-corner",
        options: [
          { value: "screen-corner", label: "Screen Corner" },
          { value: "active-app-corner", label: "Active App Corner" },
        ],
      },
      {
        key: "dictationWindowWidth",
        type: "slider",
        label: "Window Width",
        description: "Width of the dictation window in pixels",
        defaultValue: 400,
        min: 200,
        max: 800,
        step: 10,
      },
      {
        key: "dictationWindowHeight",
        type: "slider",
        label: "Window Height",
        description: "Height of the dictation window in pixels",
        defaultValue: 50,
        min: 30,
        max: 200,
        step: 5,
      },

      {
        key: "showDictationWindowAlways",
        type: "boolean",
        label: "Always Show Window",
        description: "Keep dictation window visible even when not recording",
        defaultValue: false,
      },
    ],
  },
  {
    id: "ai",
    title: "AI Enhancement",
    description: "Configure AI-powered text transformation",
    icon: "flash",
    fields: [
      {
        key: "ai.enabled",
        type: "boolean",
        label: "Enable AI Enhancement",
        description: "Use AI to improve and transform transcribed text",
        defaultValue: true,
      },
      {
        key: "ai.writingStyle",
        type: "textarea",
        label: "Writing Style",
        description:
          "Custom writing style instructions to inject into the system prompt. Use {writing_style} placeholder in the system prompt to include this content.",
        defaultValue: readPrompt("writing_style"),
        placeholder: "Describe your preferred writing style and tone...",
      },
      {
        key: "ai.baseUrl",
        type: "text",
        label: "API Base URL",
        description: "Base URL for the AI service API",
        defaultValue: "https://api.cerebras.ai/v1/chat/completions",
        placeholder: "https://api.example.com/v1/chat/completions",
      },
      {
        key: "ai.model",
        type: "select",
        label: "Model Name",
        description: "AI model to use for text enhancement",
        defaultValue: "qwen-3-235b-a22b-instruct",
      },
      {
        key: "ai.maxTokens",
        type: "number",
        label: "Max Tokens",
        description: "Maximum number of tokens in AI response",
        defaultValue: 16382,
        min: 1,
        max: 100000,
      },
      {
        key: "ai.temperature",
        type: "slider",
        label: "Temperature",
        description:
          "Controls randomness in AI responses (0 = deterministic, 1 = creative)",
        defaultValue: 0.6,
        min: 0,
        max: 1,
        step: 0.1,
      },
      {
        key: "ai.topP",
        type: "slider",
        label: "Top P",
        description: "Controls diversity via nucleus sampling",
        defaultValue: 0.95,
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        key: "ai.prompt",
        type: "textarea",
        label: "System Prompt",
        description:
          "Instructions for the AI on how to process text. Use {writing_style} placeholder to include your writing style instructions.",
        defaultValue: readPrompt("prompt"),
      },
      {
        key: "ai.messagePrompt",
        type: "textarea",
        label: "Message Template",
        description:
          "Template for formatting messages sent to AI service (use {selection}, {text}, {title}, {app} placeholders)",
        defaultValue: readPrompt("message"),
      },
      {
        key: "rules",
        type: "rules-editor",
        label: "Text Rules",
        description: "Configure rules for text transformation and processing",
        defaultValue: loadDefaultRules(),
      },
    ],
  },
  {
    id: "actions",
    title: "Actions & Transformations",
    description:
      "Configure all voice commands, text transformations, and automated actions",
    icon: "flow-arrow",
    fields: [
      {
        key: "actions",
        type: "actions-editor",
        label: "Unified Actions",
        description:
          "Configure voice commands, text transformations, and segment actions in one unified system. Actions can be triggered immediately or queued for the next segment.",
        defaultValue: getDefaultActionsConfig(),
      },
    ],
  },

  {
    id: "sounds",
    title: "Sounds",
    description: "Configure audio feedback sounds for dictation events",
    icon: "speaker-high",
    fields: [
      {
        key: "sounds.enabled",
        type: "boolean",
        label: "Enable Sounds",
        description: "Play audio feedback when starting and stopping dictation",
        defaultValue: true,
      },
      {
        key: "sounds.volume",
        type: "slider",
        label: "Volume",
        description: "Volume level for feedback sounds",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.1,
      },
      {
        key: "sounds.startSound",
        type: "select",
        label: "Start Recording Sound",
        description: "Sound to play when starting dictation",
        defaultValue: "start",
        options: [
          { value: "none", label: "None" },
          { value: "start", label: "Start" },
          { value: "end", label: "End" },
        ],
      },
      {
        key: "sounds.stopSound",
        type: "select",
        label: "Stop Recording Sound",
        description: "Sound to play when stopping dictation",
        defaultValue: "end",
        options: [
          { value: "none", label: "None" },
          { value: "start", label: "Start" },
          { value: "end", label: "End" },
        ],
      },
      {
        key: "sounds.playTransformCompleteSound",
        type: "boolean",
        label: "Play Transformation Complete Sound",
        description:
          "Play a sound when AI text transformation completes (only when transformation is used)",
        defaultValue: false,
      },
      {
        key: "sounds.transformCompleteSound",
        type: "select",
        label: "Transformation Complete Sound",
        description: "Sound to play when text transformation completes",
        defaultValue: "end",
        options: [
          { value: "none", label: "None" },
          { value: "start", label: "Start" },
          { value: "end", label: "End" },
        ],
      },
    ],
  },

  {
    id: "hotkeys",
    title: "Hotkeys",
    description: "Configure keyboard shortcuts for app functions",
    icon: "keyboard",
    fields: [
      {
        key: "hotkeys.startStopDictation",
        type: "hotkey",
        label: "Start/Stop Dictation",
        description: "Keyboard shortcut to start or stop dictation recording",
        defaultValue: "Control+D",
      },
      {
        key: "hotkeys.pushToTalk",
        type: "hotkey",
        label: "Push to Talk",
        description:
          "Hold to capture audio, release to transcribe and inject without AI transformation",
        defaultValue: "",
      },
      {
        key: "hotkeys.pasteRawDictation",
        type: "hotkey",
        label: "Paste Raw Dictation",
        description:
          "Keyboard shortcut to finish dictation and paste transcription without AI transformation",
        defaultValue: "Control+Shift+D",
      },
      {
        key: "hotkeys.cancelDictation",
        type: "hotkey",
        label: "Cancel Dictation",
        description:
          "Keyboard shortcut to cancel ongoing dictation without saving",
        defaultValue: "",
      },
      {
        key: "hotkeys.injectLastResult",
        type: "hotkey",
        label: "Inject Last Result",
        description:
          "Keyboard shortcut to inject the last transformed result into active app",
        defaultValue: "",
      },
      {
        key: "hotkeys.cyclePlugin",
        type: "hotkey",
        label: "Cycle Plugin",
        description:
          "Keyboard shortcut to cycle to the next available transcription plugin",
        defaultValue: "",
      },
      {
        key: "hotkeys.quitApp",
        type: "hotkey",
        label: "Quit App",
        description: "Keyboard shortcut to quit WhisperMac",
        defaultValue: "",
      },
      {
        key: "hotkeys.injectRawLastResult",
        type: "hotkey",
        label: "Inject Raw Last Result",
        description:
          "Keyboard shortcut to inject the last raw transcription result (without AI transformation) into active app",
        defaultValue: "",
      },
    ],
  },

  {
    id: "permissions",
    title: "Permissions",
    description: "Manage system permissions required by WhisperMac",
    icon: "shield",
    fields: [],
  },

  {
    id: "advanced",
    title: "Advanced",
    description: "Advanced configuration options",
    icon: "slider",
    fields: [
      {
        key: "launchAtLogin",
        type: "boolean",
        label: "Launch at Login",
        description:
          "Start WhisperMac automatically when you log in to your Mac",
        defaultValue: false,
      },
      {
        key: "dataDir",
        type: "directory",
        label: "Data Directory",
        description: "Directory to store app data and models",
        defaultValue:
          app && !process.env.USE_LOCAL_DATA_DIR
            ? app.getPath("userData")
            : resolve(__dirname, "../../.whispermac-data"),
        placeholder: "Select directory...",
      },
      {
        key: "audioSpeedMultiplier",
        type: "slider",
        label: "Audio Speed Multiplier",
        description:
          "Speed up audio before transcription. Higher values may improve transcription speed but could reduce accuracy. Set to 1 for no speed change.",
        defaultValue: 1.0,
        min: 1.0,
        max: 3.0,
        step: 0.1,
      },
    ],
  },
  {
    id: "data",
    title: "Data Management",
    description: "Manage plugin data and storage usage",
    icon: "database",
    fields: [],
  },
  {
    id: "history",
    title: "Recording History",
    description: "View and manage your recording history",
    icon: "history",
    fields: [
      {
        key: "history.enabled",
        type: "boolean",
        label: "Enable Recording History",
        description: "Save recordings and transcriptions for later review",
        defaultValue: true,
      },
      {
        key: "history.maxRecordings",
        type: "number",
        label: "Maximum Recordings",
        description: "Maximum number of recordings to keep in history",
        defaultValue: DEFAULT_HISTORY_MAX_RECORDINGS,
        min: 1,
        max: 1000,
      },
    ],
  },
];

export function getDefaultSettings(): Record<string, any> {
  const defaults: Record<string, any> = {};

  SETTINGS_SCHEMA.forEach((section) => {
    section.fields.forEach((field) => {
      const keys = field.key.split(".");
      let current = defaults;

      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = field.defaultValue;
    });
  });

  return defaults;
}

/**
 * Load default rules from rules.json file
 */
function loadDefaultRules(): any[] {
  try {
    const rulesPath = resolve(__dirname, "../prompts/rules.json");
    const rulesContent = readFileSync(rulesPath, "utf-8");
    const rules = JSON.parse(rulesContent);

    // Add enabled property and id to each rule
    return rules.map((rule: any, index: number) => ({
      ...rule,
      id: `rule_${index}_${Date.now()}`,
      enabled: true,
    }));
  } catch (error) {
    console.warn("Failed to load default rules:", error);
    return [];
  }
}

export function validateSettings(
  settings: Record<string, any>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  SETTINGS_SCHEMA.forEach((section) => {
    section.fields.forEach((field) => {
      const keys = field.key.split(".");
      let current: any = settings;

      for (const key of keys) {
        if (current && typeof current === "object" && key in current) {
          current = current[key];
        } else {
          current = undefined;
          break;
        }
      }

      if (field.validation && current !== undefined) {
        const error = field.validation(current);
        if (error) {
          errors[field.key] = error;
        }
      }
    });
  });

  return errors;
}
