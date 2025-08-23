import { Segment, TranscribedSegment } from "../types/SegmentTypes";
import { AppConfig, Rule } from "../config/AppConfig";
import { SelectedTextResult } from "./SelectedTextService";
import { AiValidationService } from "./AiValidationService";
import { SecureStorageService } from "./SecureStorageService";
import { SelectedTextService } from "./SelectedTextService";
import { readFileSync } from "fs";

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

export interface SegmentTransformationResult {
  transformedText: string;
  segmentsProcessed: number;
  success: boolean;
  error?: string;
}

export class TransformationService {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Process a prompt by replacing placeholders and handling sel tags
   * @param prompt The base prompt template
   * @param savedState Selected text state
   * @param windowInfo Active window information
   * @param text Additional text to include in the prompt
   * @param config AppConfig instance to get rules from
   * @returns Processed prompt with all placeholders replaced
   */
  static processPrompt({
    prompt,
    savedState,
    windowInfo,
    text,
    config,
    writingStyle,
  }: {
    prompt: string;
    savedState: SelectedTextResult;
    windowInfo: { title: string; appName: string };
    text?: string;
    config?: AppConfig;
    writingStyle?: string;
  }): string {
    const context = this.prototype.createContext(
      windowInfo.title || "",
      windowInfo.appName || ""
    );

    const rules = config?.getRules() || [];

    let processed = prompt
      .replace(/{selection}/g, savedState.text || "")
      .replace(/{context}/g, context.text)
      .replace(/{text}/g, text || "")
      .replace(
        /{rules}/g,
        this.prototype.createRuleText(rules, {
          hasSelection: savedState.hasSelection,
          hasContext: context.hasContext,
          hasWritingStyle: !!writingStyle,
        })
      )
      .replace(/{writing_style}/g, writingStyle || "");

    const repTagIf = (
      tag: string,
      condition: boolean,
      text: string
    ): string => {
      const openTag = new RegExp(`<${tag}>`, "g");
      const closeTag = new RegExp(`</${tag}>`, "g");
      if (condition) {
        text = text.replace(openTag, "");
        text = text.replace(closeTag, "");
      } else {
        text = text.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
      }
      return text;
    };

    processed = repTagIf("sel", savedState.hasSelection, processed);
    processed = repTagIf("no_sel", !savedState.hasSelection, processed);
    processed = repTagIf("context", context.hasContext, processed);
    processed = repTagIf("no_context", context.hasContext, processed);
    processed = repTagIf("rules", !!rules.length, processed);
    processed = repTagIf("writing_style", !!rules.length, processed);

    return processed;
  }

  /**
   * Creates a context string by combining title, app, and text.
   * @private
   * @param {string} title - The title component.
   * @param {string} app - The application identifier.
   */
  private createContext(title: string, app: string) {
    if (!(title || app)) {
      return { hasContext: false, text: "" };
    }
    return { hasContext: true, text: `Window title: ${title}\nApp: ${app}` };
  }

  /**
   * Create rule text from an array of rules
   * @param rules Array of rules to format
   * @param context Context information for conditional rule filtering
   * @returns Formatted rule text
   */
  private createRuleText(
    rules: Rule[],
    context: {
      hasSelection: boolean;
      hasContext: boolean;
      hasWritingStyle: boolean;
    }
  ): string {
    const filteredRules = rules.filter((rule) => {
      if (!rule.if) return true;

      return rule.if.every((condition) => {
        switch (condition) {
          case "selection":
            return context.hasSelection;
          case "context":
            return context.hasContext;
          case "writing_style":
            return context.hasWritingStyle;
          default:
            return true;
        }
      });
    });

    return (
      filteredRules
        .map((rule, i) => {
          let out = `${i + 1}. ${rule.name}`;
          if (rule?.examples?.length) {
            out +=
              ":\n" +
              rule.examples
                .map((ex) => `    "${ex.from}":\n        ${ex.to}`)
                .join("\n");
          }
          return out;
        })
        .join("\n") + "\n"
    );
  }

  /**
   * Extract code block content if it's significantly longer than non-code content
   * @param text The text to extract code from
   * @returns Extracted code or null if no code block found
   */
  static extractCode(text: string): string | null {
    const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)\n```/g;
    const matches = Array.from(text.matchAll(codeBlockRegex));

    if (matches.length === 0) {
      return null;
    }

    let longestCodeContent = "";

    for (const match of matches) {
      const codeContent = match[2] || "";
      if (codeContent.length > longestCodeContent.length) {
        longestCodeContent = codeContent;
      }
    }

    const textWithoutCodeBlocks = text.replace(codeBlockRegex, "");
    const nonCodeContent = textWithoutCodeBlocks.trim();

    if (
      longestCodeContent.length > nonCodeContent.length * 2 &&
      longestCodeContent.length > 0
    ) {
      return longestCodeContent.trim();
    }

    return null;
  }

  /**
   * Remove content between <think> tags and trim the result
   * @param text The text to process
   * @returns Text with think tags removed
   */
  static removeThink(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  /**
   * Remove "changed/new/replaced text:" prefixes
   * @param text The text to process
   * @returns Text with prefixes removed
   */
  static async removeChanged(text: string): Promise<string> {
    const transformed = text
      .trim()
      .replace(/^(?:changed|new|replaced)\s*(?:text)\:?\s*/gi, "")
      .trim();
    return transformed;
  }

  /**
   * Build Gemini API request parts from various inputs
   * @param systemPrompt Processed system prompt
   * @param messagePrompt Processed message prompt
   * @param audioWavBase64 Base64 audio data
   * @param screenshotBase64 Optional base64 screenshot data
   * @param savedState Selected text state
   * @returns Array of request parts
   */
  static buildGeminiRequestParts(
    systemPrompt: string,
    messagePrompt: string,
    audioWavBase64: string,
    screenshotBase64?: string,
    savedState?: SelectedTextResult
  ): Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
  }> {
    const parts = [
      { text: systemPrompt + "\n\n" + messagePrompt },
      ...(screenshotBase64
        ? [
            {
              inlineData: {
                mimeType: "image/png",
                data: screenshotBase64,
              },
            },
          ]
        : []),
      {
        inlineData: {
          mimeType: "audio/x-wav",
          data: audioWavBase64,
        },
      },
    ];

    // Add selection reminder if needed
    if (savedState?.hasSelection) {
      parts.push({ text: "Remember, output the new selection." });
    }

    return parts;
  }

  /**
   * Transform segments by combining all text first, then applying transformations
   */
  async transformSegments(
    segments: Segment[],
    savedState: SelectedTextResult
  ): Promise<SegmentTransformationResult> {
    console.log("=== TransformationService.transformSegments ===");
    console.log("Input segments:", segments);

    try {
      const transcribedSegments = segments.filter(
        (s) => s.type === "transcribed"
      ) as TranscribedSegment[];

      const combinedText = transcribedSegments
        .map((segment) => segment.text.trim())
        .filter((text) => text.length > 0)
        .join(" ");

      console.log("Combined text before transformation:", combinedText);

      const transformedText = await this.transformText(
        combinedText,
        savedState
      );

      console.log("Final transformed text:", transformedText);

      return {
        transformedText,
        segmentsProcessed: transcribedSegments.length,
        success: true,
      };
    } catch (error: unknown) {
      console.error("=== TransformationService.transformSegments ERROR ===");
      console.error("Failed to transform segments:", error);
      return {
        transformedText: "",
        segmentsProcessed: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Transform text according to the specified options
   */
  private async transformText(
    text: string,
    savedState: SelectedTextResult
  ): Promise<string> {
    console.log("=== TransformationService.transformText ===");
    console.log("Input text:", text);

    let transformedText = text;

    if (this.config.ai?.enabled) {
      // Validate AI configuration before using it
      const validationService = new AiValidationService();
      const validationResult = await validationService.validateAiConfiguration(
        this.config.ai.baseUrl,
        this.config.ai.model
      );

      if (!validationResult.isValid) {
        console.warn(
          "AI configuration is invalid, skipping AI transformation:",
          validationResult.error
        );
        // Continue without AI transformation
      } else {
        transformedText = await this.transformWithAi(
          transformedText,
          this.config.ai,
          savedState
        );
      }
    }

    const extractedCode = TransformationService.extractCode(transformedText);
    if (extractedCode) {
      return extractedCode;
    }

    return transformedText.trim();
  }

  /**
   * Extract code block content if it's significantly longer than non-code content
   */
  private extractCode(text: string): string | null {
    return TransformationService.extractCode(text);
  }

  private async removeChanged(text: string): Promise<string> {
    return TransformationService.removeChanged(text);
  }

  /**
   * Remove extra whitespace and normalize spacing
   */
  async normalizeWhitespace(text: string): Promise<string> {
    console.log("=== TransformationService.normalizeWhitespace ===");
    console.log("Input text:", text);

    const transformed = text.replace(/\s+/g, " ").trim();
    return transformed;
  }

  /**
   * Remove content between <think> tags and trim the result
   */
  private removeThink(text: string): string {
    return TransformationService.removeThink(text);
  }

  /**
   * Transform text using AI API
   */
  private async transformWithAi(
    text: string,
    aiConfig: AiTransformationConfig,
    savedState: SelectedTextResult
  ): Promise<string> {
    console.log("=== TransformationService.transformWithAi ===");
    console.log("Input text:", text);
    console.log("Saved state:", savedState);

    let apiKey: string | undefined;
    try {
      const secure = new SecureStorageService();
      apiKey = (await secure.getApiKey()) || undefined;
    } catch (e) {}
    if (!apiKey) apiKey = process.env["AI_API_KEY"];
    if (!apiKey)
      throw new Error(
        "AI API key not found. Please set it in onboarding or settings."
      );

    // Get active window information
    const selectedTextService = new SelectedTextService();
    const windowInfo = await selectedTextService.getActiveWindowInfo();

    console.log("Active window info:", windowInfo);

    let messagePrompt = TransformationService.processPrompt({
      prompt: aiConfig.messagePrompt,
      savedState,
      windowInfo,
      text,
      config: this.config,
      writingStyle: aiConfig.writingStyle,
    });

    const systemPrompt = TransformationService.processPrompt({
      prompt: aiConfig.prompt,
      savedState,
      windowInfo,
      text,
      config: this.config,
      writingStyle: aiConfig.writingStyle,
    });

    console.log("PROMPT:", systemPrompt);
    console.log("MESSAGE_PROMPT:", messagePrompt);

    const response = await fetch(aiConfig.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        stream: false,
        max_tokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
        top_p: aiConfig.topP,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: messagePrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API request failed with status: ${response.status}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0]?.message?.content) {
      throw new Error("Invalid AI API response format");
    }

    let transformed = TransformationService.removeThink(
      data.choices[0].message.content
    );
    transformed = await TransformationService.removeChanged(transformed);
    console.log("AI transformed text:", transformed);
    return transformed;
  }
}
