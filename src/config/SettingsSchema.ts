import { resolve } from "path";
import { readPrompt } from "../helpers/getPrompt";
import { app } from "electron";

export interface SettingsField {
  key: string;
  type:
    | "text"
    | "number"
    | "boolean"
    | "select"
    | "textarea"
    | "slider"
    | "directory";
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
    id: "general",
    title: "General",
    description: "Basic application settings",
    icon: "settings",
    fields: [
      {
        key: "serverPort",
        type: "number",
        label: "Server Port",
        description: "Port for the WhisperLive server",
        defaultValue: 9090,
        min: 1024,
        max: 65535,
        validation: (value) => {
          if (value < 1024 || value > 65535) {
            return "Port must be between 1024 and 65535";
          }
          return null;
        },
      },
      {
        key: "defaultModel",
        type: "select",
        label: "Default Model",
        description: "Whisper model to use for transcription",
        defaultValue: "Systran/faster-whisper-tiny.en",
        options: [
          {
            value: "Systran/faster-whisper-tiny",
            label: "Tiny (Multilingual)",
          },
          { value: "Systran/faster-whisper-tiny.en", label: "Tiny (English)" },
          {
            value: "Systran/faster-whisper-base",
            label: "Base (Multilingual)",
          },
          { value: "Systran/faster-whisper-base.en", label: "Base (English)" },
          {
            value: "Systran/faster-whisper-small",
            label: "Small (Multilingual)",
          },
          {
            value: "Systran/faster-whisper-small.en",
            label: "Small (English)",
          },
          {
            value: "Systran/faster-whisper-medium",
            label: "Medium (Multilingual)",
          },
          {
            value: "Systran/faster-whisper-medium.en",
            label: "Medium (English)",
          },
          {
            value: "Systran/faster-whisper-large-v1",
            label: "Large v1 (Multilingual)",
          },
          {
            value: "Systran/faster-whisper-large-v2",
            label: "Large v2 (Multilingual)",
          },
          {
            value: "Systran/faster-whisper-large-v3",
            label: "Large v3 (Multilingual)",
          },
        ],
      },
    ],
  },
  {
    id: "dictation",
    title: "Dictation Window",
    description: "Appearance and behavior of the dictation overlay",
    icon: "window",
    fields: [
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
    id: "text",
    title: "Text Processing",
    description: "Settings for text transformation and handling",
    icon: "document-text",
    fields: [
      {
        key: "transformTrim",
        type: "boolean",
        label: "Trim Whitespace",
        description:
          "Remove leading and trailing whitespace from transcribed text",
        defaultValue: true,
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
        defaultValue:
          'I type all lowercase without punctuation except for exclamation points in messaging apps like instagram or imessage. Emails should be very concise, don\'t make them flowery. I frequently dictate instructions like "Set menu bar icon in electron" and in these instances I want you to simply correct and fix grammar or interpret the request but not fulfill it, e.g. you\'d respond "Set menu bar icon in Electron". Only if I explicitly ask you should you fulfill a request I\'m dictating, or when selected text is provided.',
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
        type: "text",
        label: "Model Name",
        description: "AI model to use for text enhancement",
        defaultValue: "qwen-3-32b",
        placeholder: "gpt-4",
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
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Advanced configuration options",
    icon: "cog",
    fields: [
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

export function validateSettings(
  settings: Record<string, any>
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
