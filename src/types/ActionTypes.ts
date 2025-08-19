export interface ActionHandler {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  matchPatterns: MatchPattern[];
  handlers: ActionHandlerConfig[];
}

export interface MatchPattern {
  id: string;
  type: 'startsWith' | 'endsWith' | 'regex' | 'exact';
  pattern: string;
  caseSensitive: boolean;
}

export interface ActionHandlerConfig {
  id: string;
  type: 'openUrl' | 'openApplication' | 'quitApplication' | 'executeShell';
  config: HandlerConfig;
  order: number;
}

export type HandlerConfig = 
  | OpenUrlConfig 
  | OpenApplicationConfig 
  | QuitApplicationConfig 
  | ExecuteShellConfig;

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

export interface ActionMatch {
  actionId: string;
  matchedPattern: MatchPattern;
  originalText: string;
  extractedArgument?: string;
  handlers: ActionHandlerConfig[];
}

export interface DefaultActionsConfig {
  actions: ActionHandler[];
}
