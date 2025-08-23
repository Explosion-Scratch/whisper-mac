import { resolve } from "path";
import { readPrompt } from "../helpers/getPrompt";
import { app } from "electron";
import { getDefaultActionsConfig } from "./DefaultActions";
import { readFileSync } from "fs";

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
    | "actions-editor";
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
    icon: "microphone",
    fields: [],
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
        defaultValue: "qwen-3-32b",
        options: [
          { value: "qwen-3-32b", label: "Qwen 3 32B" },
          { value: "gpt-4", label: "GPT-4" },
          { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
        ],
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
    id: "actions",
    title: "Actions",
    description: "Configure voice-activated actions and commands",
    icon: "lightning",
    fields: [
      {
        key: "actions",
        type: "actions-editor",
        label: "Voice Actions",
        description:
          "Configure actions that can be triggered by voice commands during dictation",
        defaultValue: getDefaultActionsConfig(),
      },
    ],
  },
  {
    id: "rules",
    title: "Text Rules",
    description: "Configure rules for text transformation and processing",
    icon: "edit",
    fields: [
      {
        key: "rules",
        type: "textarea",
        label: "Transformation Rules",
        description:
          "JSON array of rules for text transformation. Each rule should have a name and examples array with from/to pairs. Rules can include an optional 'if' array with conditions: 'selection', 'context', 'writing_style'.",
        defaultValue: loadDefaultRules(),
        validation: (value) => {
          try {
            if (typeof value === "string") {
              JSON.parse(value);
            } else if (Array.isArray(value)) {
              // Validate rule structure
              for (const rule of value) {
                if (!rule.name || !Array.isArray(rule.examples)) {
                  return "Each rule must have a 'name' and 'examples' array";
                }
                for (const example of rule.examples) {
                  if (!example.from || !example.to) {
                    return "Each example must have 'from' and 'to' properties";
                  }
                }
                // Validate if property if present
                if (rule.if && !Array.isArray(rule.if)) {
                  return "Rule 'if' property must be an array of strings";
                }
                if (rule.if) {
                  const validConditions = [
                    "selection",
                    "context",
                    "writing_style",
                  ];
                  for (const condition of rule.if) {
                    if (!validConditions.includes(condition)) {
                      return `Invalid condition '${condition}'. Valid conditions are: ${validConditions.join(
                        ", "
                      )}`;
                    }
                  }
                }
              }
            }
            return null;
          } catch (error) {
            return "Invalid JSON format";
          }
        },
      },
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Advanced configuration options",
    icon: "slider",
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
  {
    id: "data",
    title: "Data Management",
    description: "Manage plugin data and storage usage",
    icon: "database",
    fields: [],
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
    return JSON.parse(rulesContent);
  } catch (error) {
    console.warn("Failed to load default rules:", error);
    return [];
  }
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
