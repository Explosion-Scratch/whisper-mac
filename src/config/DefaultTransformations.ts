import { NonAiTransformationConfig } from "../types/TransformationRuleTypes";

const DEFAULT_NON_AI_TRANSFORMATIONS: NonAiTransformationConfig = {
  rules: [
    {
      id: "default_trailing_punctuation",
      name: "Trim trailing punctuation",
      description:
        "Remove trailing punctuation from short phrases (≤ 50 characters).",
      order: 1,
      enabledForTranscription: true,
      enabledForActions: true,
      matchPattern: "^.{0,50}$",
      matchFlags: "",
      replacePattern: "[\\.!?]+$",
      replaceFlags: "g",
      replacement: "",
      replacementMode: "literal",
    },
    {
      id: "default_lowercase_short_openers",
      name: "Lowercase short responses",
      description:
        "Lowercase the first letter for very short responses (≤ 20 characters).",
      order: 2,
      enabledForTranscription: true,
      enabledForActions: false,
      matchPattern: "^.{0,20}$",
      matchFlags: "",
      replacePattern: "^[\\p{Lu}]",
      replaceFlags: "u",
      replacementMode: "lowercase",
    },
  ],
};

export function getDefaultNonAiTransformationsConfig(): NonAiTransformationConfig {
  return JSON.parse(JSON.stringify(DEFAULT_NON_AI_TRANSFORMATIONS));
}
