export type NonAiReplacementMode = "literal" | "lowercase" | "uppercase";

export interface NonAiTransformationRule {
  id: string;
  name: string;
  description?: string;
  order?: number;
  enabledForTranscription: boolean;
  enabledForActions: boolean;
  matchPattern: string;
  matchFlags?: string;
  replacePattern: string;
  replaceFlags?: string;
  replacement?: string;
  replacementMode?: NonAiReplacementMode;
}

export interface NonAiTransformationConfig {
  rules: NonAiTransformationRule[];
}
