import { resolve } from "path";
import { readFileSync } from "fs";

/**
 * Reads a prompt file and filters out lines that start with a hashtag (#)
 * @param name - The name of the prompt file (without extension)
 * @returns The file contents with hashtag lines removed
 */
export function readPrompt(name: string): string {
  const filePath = resolve(__dirname, `../prompts/${name}.txt`);
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}
