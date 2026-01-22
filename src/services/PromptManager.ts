import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

const DEFAULT_TRANSCRIPTION_INSTRUCTIONS = `You are receiving audio input. First, accurately transcribe the spoken content, then apply the following instructions to transform and enhance the text.

When transcribing:
- Listen carefully to the audio and capture all spoken words accurately
- Be aware that some words may sound similar to others - use context to disambiguate
- Handle repetitions as self-corrections
- Technical terms and proper nouns should be resolved using context clues
- Don't make mindless changes, preserve the user's intent`;

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
    const content = this.readPromptFile("transcription_instructions.txt");
    return content || DEFAULT_TRANSCRIPTION_INSTRUCTIONS;
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
