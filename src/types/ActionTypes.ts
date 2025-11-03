export interface ActionHandler {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  order: number;
  closesTranscription?: boolean; // Whether this action should stop listening after execution
  skipsTransformation?: boolean; // Whether this action should skip AI transformation
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
    | "segmentAction";
  config: HandlerConfig;
  order: number;
  applyToNextSegment?: boolean; // If true, queue this handler for next segment
}

export type HandlerConfig =
  | OpenUrlConfig
  | OpenApplicationConfig
  | QuitApplicationConfig
  | ExecuteShellConfig
  | SegmentActionConfig;

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
