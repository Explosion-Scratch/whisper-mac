export interface ActionHandler {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  order: number;
  closesTranscription?: boolean; // Whether this action should stop listening after execution
  skipsTransformation?: boolean; // Whether this action should skip AI transformation
  skipsAllTransforms?: boolean; // Whether this action should skip all transformations (AI + default actions)
  applyToAllSegments?: boolean; // Whether this action should run on all segments after transcription is complete
  timingMode?: "before_ai" | "after_ai"; // When to run the action relative to AI transformation (default: before_ai)
  matchPatterns: MatchPattern[];
  handlers: ActionHandlerConfig[];
}

export interface MatchPattern {
  id: string;
  type: "startsWith" | "endsWith" | "regex" | "exact";
  pattern: string;
  caseSensitive: boolean;
}

export interface ActionHandlerConfig {
  id: string;
  type:
    | "openUrl"
    | "openApplication"
    | "quitApplication"
    | "executeShell"
    | "segmentAction"
    | "transformText";
  config: HandlerConfig;
  order: number;
  applyToNextSegment?: boolean; // If true, queue this handler for next segment
}

export type HandlerConfig =
  | OpenUrlConfig
  | OpenApplicationConfig
  | QuitApplicationConfig
  | ExecuteShellConfig
  | SegmentActionConfig
  | TransformTextConfig;

export interface OpenUrlConfig {
  urlTemplate: string; // Can use {match}, {argument}, etc.
  openInBackground?: boolean;
}

export interface OpenApplicationConfig {
  applicationName?: string; // If empty, uses the matched text
  arguments?: string[];
  waitForExit?: boolean;
}

export interface QuitApplicationConfig {
  applicationName?: string; // If empty, uses the matched text
  forceQuit?: boolean;
  confirmBeforeQuit?: boolean;
}

export interface ExecuteShellConfig {
  command: string; // Can use {match}, {argument}, etc.
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeout?: number;
  runInBackground?: boolean;
}

export interface SegmentActionConfig {
  action:
    | "clear"
    | "undo"
    | "replace"
    | "deleteLastN"
    | "lowercaseFirstChar"
    | "uppercaseFirstChar"
    | "capitalizeFirstWord"
    | "removePattern";
  // For 'replace' action
  replacementText?: string; // Can use {match}, {argument}, etc.
  // For 'deleteLastN' action
  count?: number;
  // For 'removePattern' action
  pattern?: string; // Pattern to remove (e.g., "..." for ellipses)
}

export interface TransformTextConfig {
  // Match conditions
  matchPattern?: string; // Regex pattern to match text
  matchFlags?: string; // Regex flags for match pattern
  
  // Replace operation
  replacePattern: string; // Pattern to find and replace
  replaceFlags?: string; // Regex flags for replace
  replacement?: string; // Replacement text (if mode is literal)
  replacementMode?: "literal" | "lowercase" | "uppercase";
  
  // Conditions
  maxLength?: number; // Only apply if text is shorter than this
  minLength?: number; // Only apply if text is longer than this
}

export interface ActionMatch {
  actionId: string;
  matchedPattern: MatchPattern;
  originalText: string;
  extractedArgument?: string;
  handlers: ActionHandlerConfig[];
}

export interface ActionResult {
  success: boolean;
  shouldEndTranscription?: boolean;
  queuedHandlers?: ActionHandlerConfig[];
  error?: string;
}

export interface DefaultActionsConfig {
  actions: ActionHandler[];
}
