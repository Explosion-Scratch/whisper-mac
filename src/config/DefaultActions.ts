import { ActionHandler } from "../types/ActionTypes";

export const DEFAULT_ACTIONS: ActionHandler[] = [
  {
    id: "open-action",
    name: "Open",
    description: "Open applications, URLs, files, or search the web",
    enabled: true,
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
];

export function getDefaultActionsConfig() {
  return {
    actions: DEFAULT_ACTIONS,
  };
}
