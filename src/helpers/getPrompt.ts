import { resolve } from "path";
import { readFileSync } from "fs";

/**
 * @param name - Prompt file name (without extension)
 * @returns File contents with hashtag lines removed
 */
export function readPrompt(name: string): string {
  const filePath = resolve(__dirname, `../prompts/${name}.txt`);
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/**
 * @param template - Prompt template string with {{PLACEHOLDER}} tokens
 * @param vars - Key/value pairs to substitute
 * @returns Filled prompt string
 */
export function fillPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => vars[key] ?? "",
  );
}
