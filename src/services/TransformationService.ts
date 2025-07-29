import { Segment, TranscribedSegment } from "../types/SegmentTypes";
import { AppConfig } from "../config/AppConfig";

export interface TransformationOptions {
  toUppercase?: boolean;
  toLowercase?: boolean;
  capitalize?: boolean;
  trim?: boolean;
  customTransform?: (text: string) => Promise<string>;
  prefixText?: string; // New option to prepend selected text
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
   * Transform segments, optionally prepending a transformed prefix text (the original selection).
   */
  async transformSegments(
    segments: Segment[],
    options: TransformationOptions = {}
  ): Promise<SegmentTransformationResult> {
    console.log("=== TransformationService.transformSegments ===");
    console.log("Input segments:", segments);
    console.log("Options:", options);

    try {
      // Build transformation options from config, allowing overrides
      const configOptions: TransformationOptions = {
        toUppercase: this.config.transformToUppercase,
        toLowercase: this.config.transformToLowercase,
        capitalize: this.config.transformCapitalize,
        trim: this.config.transformTrim,
        ...options,
      };

      console.log("Using transformation options:", configOptions);

      const transformedTexts: string[] = [];
      let segmentsProcessed = 0;

      // 1. Transform the prefix text (original selection) if it exists
      if (configOptions.prefixText) {
        const transformedPrefix = await this.transformText(
          configOptions.prefixText,
          configOptions
        );
        if (transformedPrefix) {
          transformedTexts.push(transformedPrefix);
        }
      }

      // 2. Transform the transcribed segments
      const transcribedSegments = segments.filter(
        (s) => s.type === "transcribed"
      ) as TranscribedSegment[];

      for (const segment of transcribedSegments) {
        if (segment.text.trim()) {
          const transformed = await this.transformText(
            segment.text,
            configOptions
          );
          transformedTexts.push(transformed);
        }
      }
      segmentsProcessed = transcribedSegments.length;

      // 3. Join all transformed texts
      const combinedText = transformedTexts.join(" ").trim();

      console.log("Combined transformed text:", combinedText);
      console.log("Total segments processed:", segmentsProcessed);

      return {
        transformedText: combinedText,
        segmentsProcessed,
        success: true,
      };
    } catch (error) {
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
    options: TransformationOptions = {}
  ): Promise<string> {
    console.log("=== TransformationService.transformText ===");
    console.log("Input text:", text);
    console.log("Options:", options);

    let transformedText = text;

    // Apply transformations in order
    if (options.trim !== false) {
      transformedText = await this.normalizeWhitespace(transformedText);
    }

    if (options.toUppercase) {
      transformedText = await this.toUppercase(transformedText);
    }

    if (options.toLowercase) {
      transformedText = await this.toLowercase(transformedText);
    }

    if (options.capitalize) {
      transformedText = await this.capitalizeWords(transformedText);
    }

    if (options.customTransform) {
      transformedText = await options.customTransform(transformedText);
    }

    console.log("Transformed text:", transformedText);
    return transformedText;
  }

  /**
   * Transform text to uppercase
   */
  async toUppercase(text: string): Promise<string> {
    console.log("=== TransformationService.toUppercase ===");
    console.log("Input text:", text);
    const transformed = text.toUpperCase();
    console.log("Transformed text:", transformed);
    return transformed;
  }

  /**
   * Transform text to lowercase
   */
  async toLowercase(text: string): Promise<string> {
    console.log("=== TransformationService.toLowercase ===");
    console.log("Input text:", text);
    const transformed = text.toLowerCase();
    console.log("Transformed text:", transformed);
    return transformed;
  }

  /**
   * Capitalize the first letter of each word
   */
  async capitalizeWords(text: string): Promise<string> {
    console.log("=== TransformationService.capitalizeWords ===");
    console.log("Input text:", text);

    const transformed = text
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");

    console.log("Transformed text:", transformed);
    return transformed;
  }

  /**
   * Transform text to sentence case (first letter capitalized, rest lowercase)
   */
  async toSentenceCase(text: string): Promise<string> {
    console.log("=== TransformationService.toSentenceCase ===");
    console.log("Input text:", text);

    if (!text) return text;

    const transformed =
      text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    console.log("Transformed text:", transformed);
    return transformed;
  }

  /**
   * Remove extra whitespace and normalize spacing
   */
  async normalizeWhitespace(text: string): Promise<string> {
    console.log("=== TransformationService.normalizeWhitespace ===");
    console.log("Input text:", text);

    const transformed = text.replace(/\s+/g, " ").trim();
    console.log("Transformed text:", transformed);
    return transformed;
  }

  /**
   * Apply multiple transformations in sequence
   */
  async applyTransformations(
    text: string,
    transformations: ((text: string) => Promise<string>)[]
  ): Promise<string> {
    console.log("=== TransformationService.applyTransformations ===");
    console.log("Input text:", text);
    console.log("Number of transformations:", transformations.length);

    let transformedText = text;

    for (let i = 0; i < transformations.length; i++) {
      const transform = transformations[i];
      transformedText = await transform(transformedText);
      console.log(`After transformation ${i + 1}:`, transformedText);
    }

    console.log("Final transformed text:", transformedText);
    return transformedText;
  }
}
