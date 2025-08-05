import { Segment, TranscribedSegment } from "../types/SegmentTypes";
import { AppConfig } from "../config/AppConfig";
import { SelectedTextResult } from "./SelectedTextService";

export interface AiTransformationConfig {
  enabled: boolean;
  prompt: string;
  baseUrl: string;
  envKey: string;
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
      transformedText = await this.transformWithAi(
        transformedText,
        this.config.ai,
        savedState
      );
    }

    const extractedCode = this.extractCode(transformedText);
    if (extractedCode) {
      return extractedCode;
    }

    return transformedText.trim();
  }

  /**
   * Extract code block content if it's significantly longer than non-code content
   */
  private extractCode(text: string): string | null {
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
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
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
    console.log("AI Config:", aiConfig);
    console.log("Saved state:", savedState);

    const apiKey = process.env[`${aiConfig.envKey}_API_KEY`];
    if (!apiKey) {
      throw new Error(`API key not found for envKey: ${aiConfig.envKey}`);
    }

    // Get active window information
    const selectedTextService = new (
      await import("./SelectedTextService")
    ).SelectedTextService();
    const windowInfo = await selectedTextService.getActiveWindowInfo();

    console.log("Active window info:", windowInfo);

    let messagePrompt = aiConfig.messagePrompt
      .replace(/{text}/g, text)
      .replace(/{selection}/, savedState.text)
      .replace(/{title}/g, windowInfo.title)
      .replace(/{app}/g, windowInfo.appName);

    if (!savedState.hasSelection) {
      messagePrompt = messagePrompt.replace(/<sel>[^<]+<\/sel>/, "");
    }

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
            content: aiConfig.prompt,
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

    const transformed = this.removeThink(data.choices[0].message.content);

    console.log("AI transformed text:", transformed);
    return transformed;
  }
}
