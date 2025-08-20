import { ActionHandler } from "../types/ActionTypes";

export const DEFAULT_ACTIONS: ActionHandler[] = [
  {
    id: "open-action",
    name: "Open",
    description: "Open applications, URLs, files, or search the web",
    enabled: true,
    order: 1,
    closesTranscription: true,
    skipsTransformation: true,
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
    skipsTransformation: true,
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
    skipsTransformation: true,
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
    skipsTransformation: true,
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
    description: "Delete the last transcribed segment and the current 'undo' segment",
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
        id: "ellipses-conditional-transform",
        type: "segmentAction",
        config: {
          action: "conditionalTransform",
          condition: {
            type: "endsWith",
            value: "...",
          },
          conditionalAction: {
            onCurrentSegment: "removePattern",
            removePattern: "\\.\\.\\.",
            onNextSegment: "lowercase",
          },
        },
        order: 1,
      },
    ],
  },
  {
    id: "delete-previous-action",
    name: "Delete This and Previous",
    description: "Delete current and previous transcription chunks",
    enabled: true,
    order: 9,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "delete-previous-pattern-1",
        type: "regex",
        pattern: "^delete this and the previous.*",
        caseSensitive: false,
      },
      {
        id: "delete-previous-pattern-2",
        type: "regex",
        pattern: "^delete previous.*",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "delete-last-two-segments",
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
    id: "delete-all-action",
    name: "Delete All Transcribed Text",
    description: "Delete all past transcribed text",
    enabled: true,
    order: 10,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "delete-all-pattern-1",
        type: "regex",
        pattern: "^delete all past.*",
        caseSensitive: false,
      },
      {
        id: "delete-all-pattern-2",
        type: "regex",
        pattern: "^delete all transcribed.*",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "clear-all-transcribed-segments",
        type: "segmentAction",
        config: {
          action: "clear",
        },
        order: 1,
      },
    ],
  },
  {
    id: "replace-segment-action",
    name: "Replace This Segment",
    description: "Replace current segment with specified text",
    enabled: true,
    order: 11,
    closesTranscription: false,
    skipsTransformation: false,
    matchPatterns: [
      {
        id: "replace-segment-pattern-1",
        type: "startsWith",
        pattern: "replace this segment with ",
        caseSensitive: false,
      },
      {
        id: "replace-segment-pattern-2",
        type: "startsWith",
        pattern: "replace this with ",
        caseSensitive: false,
      },
      {
        id: "replace-segment-pattern-3",
        type: "startsWith",
        pattern: "change this to ",
        caseSensitive: false,
      },
    ],
    handlers: [
      {
        id: "replace-segment-with-argument",
        type: "segmentAction",
        config: {
          action: "replace",
          replacementText: "{argument}",
        },
        order: 1,
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
    skipsTransformation: true,
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
];

export function getDefaultActionsConfig() {
  return {
    actions: DEFAULT_ACTIONS,
  };
}
