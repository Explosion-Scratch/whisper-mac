import { join, resolve } from "path";
import { homedir } from "os";
import { readPrompt } from "../helpers/getPrompt";
import { readFileSync } from "fs";
import {
  NonAiTransformationConfig,
  NonAiTransformationRule,
} from "../types/TransformationRuleTypes";

// Safe electron import
let app: any;
try {
  app = require("electron").app;
} catch (e) {
  // Electron not available (CLI mode)
}

export type DictationWindowPosition = "active-app-corner" | "screen-corner";

export interface AiTransformationConfig {
  enabled: boolean;
  writingStyle: string;
  prompt: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  messagePrompt: string;
}

export type Rule = {
  name: string;
  examples: { from: string; to: string }[];
  if?: string[];
};

export class AppConfig {
  modelPath: string;
  dataDir: string;

  // Dictation window configuration
  dictationWindowPosition: DictationWindowPosition;
  dictationWindowWidth: number;
  dictationWindowHeight: number;
  showDictationWindowAlways: boolean;

  // AI transformation configuration
  ai: AiTransformationConfig;

  // Rules configuration
  rules: Rule[];

  // Non-AI transformation configuration
  nonAiTransformations: NonAiTransformationConfig;

  // Plugin configuration storage (no deprecated keys)
  private pluginConfig: Record<string, any> = {};

  constructor() {
    this.modelPath = "";

    // Use Electron's user data directory if available, otherwise default to standard location
    if (app && !process.env.USE_LOCAL_DATA_DIR) {
        this.dataDir = app.getPath("userData");
    } else {
        // Fallback for CLI/Node environment to match Electron's default
        const platform = process.platform;
        if (platform === 'darwin') {
            this.dataDir = resolve(homedir(), "Library/Application Support/WhisperMac");
        } else if (platform === 'win32') {
            this.dataDir = resolve(homedir(), "AppData/Roaming/WhisperMac");
        } else {
            this.dataDir = resolve(homedir(), ".config/WhisperMac");
        }
        
        // Allow override via env var (useful for dev/testing)
        if (process.env.WHISPER_MAC_DATA_DIR) {
            this.dataDir = process.env.WHISPER_MAC_DATA_DIR;
        }
    }

    // Dictation window defaults
    this.dictationWindowPosition = "screen-corner";
    this.dictationWindowWidth = 400;
    this.dictationWindowHeight = 50;
    this.showDictationWindowAlways = false;

    // AI transformation defaults
    this.ai = {
      enabled: true,
      writingStyle: readPrompt("writing_style"),
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      model: "qwen-3-32b",
      maxTokens: 16382,
      temperature: 0.3,
      topP: 0.95,
      prompt: readPrompt("prompt"),
      messagePrompt: readPrompt("message"),
    };

    // Rules defaults
    this.rules = this.loadDefaultRules();

    // Non-AI transformation defaults
    this.nonAiTransformations = this.getDefaultNonAiTransformationsConfig();
  }

  setModelPath(path: string): void {
    this.modelPath = path;
  }

  setDataDir(path: string): void {
    this.dataDir = path;
  }

  getModelsDir(): string {
    return join(this.dataDir, "models");
  }

  getCacheDir(): string {
    return join(this.dataDir, "cache");
  }

  /**
   * Get all plugin configuration
   */
  getPluginConfig(): Record<string, any> {
    return { ...this.pluginConfig };
  }

  get(key: string): any {
    return this.pluginConfig[key];
  }

  set(key: string, value: any): void {
    this.pluginConfig[key] = value;
  }

  has(key: string): boolean {
    return key in this.pluginConfig;
  }

  delete(key: string): boolean {
    if (key in this.pluginConfig) {
      delete this.pluginConfig[key];
      return true;
    }
    return false;
  }

  setPluginConfig(config: Record<string, any>): void {
    this.pluginConfig = { ...this.pluginConfig, ...config };
  }

  /**
   * Load default rules from rules.json file
   */
  private loadDefaultRules(): Rule[] {
    try {
      const rulesPath = resolve(__dirname, "../prompts/rules.json");
      const rulesContent = readFileSync(rulesPath, "utf-8");
      return JSON.parse(rulesContent);
    } catch (error) {
      console.warn("Failed to load default rules:", error);
      return [];
    }
  }

  /**
   * Get current rules configuration
   */
  getRules(): Rule[] {
    return [...this.rules];
  }

  /**
   * Set rules configuration
   */
  setRules(rules: Rule[]): void {
    this.rules = [...rules];
  }

  getNonAiTransformations(): NonAiTransformationConfig {
    const rules = this.nonAiTransformations?.rules || [];
    return {
      rules: rules.map((rule, index) => ({
        ...rule,
        order: rule.order ?? index + 1,
      })),
    };
  }

  setNonAiTransformations(config: NonAiTransformationConfig): void {
    if (!config || !Array.isArray(config.rules)) {
      this.nonAiTransformations = { rules: [] };
      return;
    }

    this.nonAiTransformations = {
      rules: config.rules.map((rule, index) => this.normalizeNonAiRule(rule, index)),
    };
  }

  private normalizeNonAiRule(
    rule: NonAiTransformationRule,
    index: number,
  ): NonAiTransformationRule {
    const sanitizedFlags = (flags?: string) =>
      (flags || "")
        .split("")
        .filter((char, pos, arr) => arr.indexOf(char) === pos)
        .join("")
        .replace(/[^gimsuy]/g, "");

    return {
      ...rule,
      order: rule.order ?? index + 1,
      matchPattern: rule.matchPattern || ".*",
      matchFlags: sanitizedFlags(rule.matchFlags),
      replacePattern: rule.replacePattern || "",
      replaceFlags: sanitizedFlags(rule.replaceFlags) || "g",
      replacement:
        rule.replacement !== undefined ? rule.replacement : "",
      replacementMode: rule.replacementMode || "literal",
      enabledForTranscription: Boolean(rule.enabledForTranscription),
      enabledForActions: Boolean(rule.enabledForActions),
    };
  }

  /**
   * Get default non-AI transformation configuration
   * Note: Non-AI transformations are now primarily handled by the unified actions system
   */
  private getDefaultNonAiTransformationsConfig(): NonAiTransformationConfig {
    return {
      rules: [
        {
          id: "remove_ellipses",
          name: "Remove Ellipses",
          description: "Replace three or more periods with a single period",
          enabledForTranscription: true,
          enabledForActions: false,
          matchPattern: "\\.{3,}",
          matchFlags: "g",
          replacePattern: "\\.{3,}",
          replaceFlags: "g",
          replacement: ".",
          replacementMode: "literal",
          order: 1,
        },
        {
          id: "fix_spacing",
          name: "Fix Spacing",
          description: "Clean up extra whitespace around punctuation",
          enabledForTranscription: true,
          enabledForActions: false,
          matchPattern: "\\s*([.,!?;:])\\s*",
          matchFlags: "g",
          replacePattern: "$1 ",
          replaceFlags: "g",
          replacement: "",
          replacementMode: "literal",
          order: 2,
        },
      ],
    };
  }
}
