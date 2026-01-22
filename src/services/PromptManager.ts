import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

export class PromptManager {
  private static promptCache: Map<string, string> = new Map();

  static readPromptFile(filename: string): string {
    if (this.promptCache.has(filename)) {
      return this.promptCache.get(filename)!;
    }

    const filePath = resolve(__dirname, `../prompts/${filename}`);
    if (!existsSync(filePath)) {
      console.warn(`Prompt file not found: ${filePath}`);
      return "";
    }

    const content = readFileSync(filePath, "utf-8");
    const processed = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");

    this.promptCache.set(filename, processed);
    return processed;
  }

  static getTranscriptionInstructions(): string {
    return this.readPromptFile("transcription_instructions.txt");
  }

  static getDefaultSystemPrompt(): string {
    return this.readPromptFile("prompt.txt");
  }

  static getDefaultMessagePrompt(): string {
    return this.readPromptFile("message.txt");
  }

  static clearCache(): void {
    this.promptCache.clear();
  }
}
