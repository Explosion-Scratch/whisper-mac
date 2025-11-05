import { ActionHandler } from "../types/ActionTypes";

export const DEFAULT_ACTIONS: ActionHandler[] = [
  {
    id: "open-action",
    name: "Open",
    description: "Open applications, URLs, files, or search the web",
    enabled: true,
    order: 1,
    closesTranscription: true,
    skipsAllTransforms: true,
    matchPatterns: [
      {
        id: "open-pattern-1",
        type: "startsWith",
        pattern: "open ",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "check-url",
        type: "openUrl",
        config: {
          urlTemplate: "{argument}",
          openInBackground: false,
        },
        order: 1,
      },
      {
        id: "check-application",
        type: "openApplication",
        config: {
          applicationName: "{argument}",
        },
        order: 2,
      },
      {
        id: "fallback-search",
        type: "openUrl",
        config: {
          urlTemplate:
            "https://www.google.com/search?q={argument}&btnI=I%27m+Feeling+Lucky",
          openInBackground: false,
        },
        order: 3,
      },
    ],
  },
  {
    id: "search-action",
    name: "Search",
    description: "Search the web using Google",
    enabled: true,
    order: 2,
    closesTranscription: true,
    skipsAllTransforms: true,
    matchPatterns: [
      {
        id: "search-pattern-1",
        type: "startsWith",
        pattern: "search ",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "google-search",
        type: "openUrl",
        config: {
          urlTemplate: "https://www.google.com/search?q={argument}",
          openInBackground: false,
        },
        order: 1,
      },
    ],
  },
  {
    id: "quit-action",
    name: "Quit Application",
    description: "Quit a specific application",
    enabled: true,
    order: 3,
    closesTranscription: true,
    skipsAllTransforms: true,
    matchPatterns: [
      {
        id: "quit-pattern-1",
        type: "startsWith",
        pattern: "quit ",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "quit-specific-app",
        type: "quitApplication",
        config: {
          applicationName: "{argument}",
          forceQuit: false,
          confirmBeforeQuit: false,
        },
        order: 1,
      },
    ],
  },

  {
    id: "launch-action",
    name: "Launch",
    description: "Launch applications",
    enabled: true,
    order: 4,
    closesTranscription: true,
    skipsAllTransforms: true,
    matchPatterns: [
      {
        id: "launch-pattern-1",
        type: "startsWith",
        pattern: "launch ",
        caseSensitive: false,
      },
      {
        id: "launch-pattern-2",
        type: "startsWith",
        pattern: "start ",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "launch-application",
        type: "openApplication",
        config: {
          applicationName: "{argument}",
        },
        order: 1,
      },
    ],
  },
  {
    id: "clear-action",
    name: "Clear Segments",
    description: "Clear all transcribed segments",
    enabled: true,
    order: 5,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "clear-pattern-1",
        type: "regex",
        pattern: "^clear\\.?$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "clear-all-segments",
        type: "segmentAction",
        config: {
          action: "clear",
        },
        order: 1,
      },
    ],
  },
  {
    id: "undo-action",
    name: "Undo Last Segment",
    description:
      "Delete the last transcribed segment and the current 'undo' segment",
    enabled: true,
    order: 6,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "undo-pattern-1",
        type: "regex",
        pattern: "^undo\\.?$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "undo-last-segment",
        type: "segmentAction",
        config: {
          action: "deleteLastN",
          count: 2,
        },
        order: 1,
      },
    ],
  },
  {
    id: "shell-replace-action",
    name: "Shell Command Helper",
    description:
      "Transform 'shell [task]' into 'Write a shell command to [task]' for AI assistance",
    enabled: true,
    order: 7,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "shell-pattern-1",
        type: "regex",
        pattern: "^shell\\.?$",
        caseSensitive: false,
      },
      {
        id: "shell-pattern-2",
        type: "startsWith",
        pattern: "shell ",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "replace-with-shell-prompt",
        type: "segmentAction",
        config: {
          action: "replace",
          replacementText: "Write a shell command to {argument}",
        },
        order: 1,
      },
    ],
  },
  {
    id: "ellipses-transform-action",
    name: "Transform Ellipses",
    description:
      "Remove trailing ellipses and lowercase the first letter of the next segment",
    enabled: true,
    order: 8,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "ellipses-pattern-1",
        type: "regex",
        pattern: ".*\\.\\.\\.$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "remove-ellipses",
        type: "segmentAction",
        config: {
          action: "removePattern",
          pattern: "\\.\\.\\.",
        },
        order: 1,
      },
      {
        id: "lowercase-next",
        type: "segmentAction",
        config: {
          action: "lowercaseFirstChar",
        },
        order: 2,
        applyToNextSegment: true,
      },
    ],
  },
  {
    id: "no-punctuation-lowercase-next-action",
    name: "Lowercase Next After No Punctuation",
    description: "When a segment doesn't end with punctuation, lowercase the first character of the next segment",
    enabled: true,
    order: 9,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "no-punctuation-pattern",
        type: "regex",
        pattern: ".*[^\\.\\!?;:,\\-]$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "lowercase-next-segment",
        type: "segmentAction",
        config: {
          action: "lowercaseFirstChar",
        },
        order: 1,
        applyToNextSegment: true,
      },
    ],
  },
  {
    id: "close-action",
    name: "Close",
    description: "Close the current application or window",
    enabled: true,
    order: 12,
    closesTranscription: true,
    skipsAllTransforms: true,
    matchPatterns: [
      {
        id: "close-pattern-1",
        type: "regex",
        pattern: "^close\\.?$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "close-app",
        type: "executeShell",
        config: {
          command:
            'osascript -e \'tell application "System Events" to keystroke "w" using command down\'',
        },
        order: 1,
      },
    ],
  },
  
  // --- TEXT TRANSFORMATION ACTIONS ---
  // These run automatically on text matching patterns
  {
    id: "trim-punctuation-action",
    name: "Auto-Trim Punctuation",
    description: "Automatically remove trailing punctuation from short phrases (≤ 50 characters)",
    enabled: true,
    order: 20,
    closesTranscription: false,
    skipsTransformation: false,
    applyToAllSegments: true,
    timingMode: "after_ai",
    matchPatterns: [
      {
        id: "short-phrase-pattern",
        type: "regex",
        pattern: "^.{0,50}[\\.!?]+$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "trim-punctuation-handler",
        type: "transformText",
        config: {
          matchPattern: "^.{0,50}$",
          matchFlags: "",
          replacePattern: "[\\.!?]+$",
          replaceFlags: "g",
          replacement: "",
          replacementMode: "literal",
          maxLength: 50,
        },
        order: 1,
        applyToNextSegment: false,
      },
    ],
  },
  {
    id: "lowercase-short-response-action",
    name: "Auto-Lowercase Short",
    description: "Automatically lowercase the first letter for very short responses (≤ 20 characters)",
    enabled: true,
    order: 21,
    closesTranscription: false,
    skipsTransformation: false,
    applyToAllSegments: true,
    timingMode: "after_ai",
    matchPatterns: [
      {
        id: "short-response-pattern",
        type: "regex",
        pattern: "^[A-Z].{0,19}$",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "lowercase-first-handler",
        type: "transformText",
        config: {
          matchPattern: "^.{0,20}$",
          matchFlags: "",
          replacePattern: "^[\\p{Lu}]",
          replaceFlags: "u",
          replacementMode: "lowercase",
          maxLength: 20,
        },
        order: 1,
        applyToNextSegment: false,
      },
    ],
  },
  {
    id: "clean-urls-action",
    name: "Auto-Clean URLs",
    description: "Clean up URL dictation by removing spaces and fixing common patterns",
    enabled: false,
    order: 22,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "url-pattern",
        type: "regex",
        pattern: "(https?|www\\.)",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "clean-url-handler",
        type: "transformText",
        config: {
          replacePattern: "\\s+(?=[\\w\\.\\-/])",
          replaceFlags: "g",
          replacement: "",
          replacementMode: "literal",
        },
        order: 1,
        applyToNextSegment: false,
      },
    ],
  },
  {
    id: "capitalize-sentences-action",
    name: "Auto-Capitalize Sentences",
    description: "Ensure sentences start with capital letters",
    enabled: false,
    order: 23,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "sentence-pattern",
        type: "regex",
        pattern: "[\\.!?]\\s+[a-z]",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "capitalize-sentence-handler",
        type: "transformText",
        config: {
          replacePattern: "([\\.!?]\\s+)([a-z])",
          replaceFlags: "g",
          replacementMode: "uppercase",
        },
        order: 1,
        applyToNextSegment: false,
      },
    ],
  },
];

export function getDefaultActionsConfig() {
  return {
    actions: DEFAULT_ACTIONS,
  };
}
