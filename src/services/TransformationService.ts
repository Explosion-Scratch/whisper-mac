export interface TransformationOptions {
  toUppercase?: boolean;
  toLowercase?: boolean;
  capitalize?: boolean;
  trim?: boolean;
  customTransform?: (text: string) => Promise<string>;
}

export class TransformationService {
  /**
   * Transform text according to the specified options
   */
  async transformText(
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
