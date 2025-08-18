import { EventEmitter } from "events";
import { shell } from "electron";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
export interface ActionHandler {
  keyword: string;
  description: string;
  execute: (argument: string) => Promise<void> | void;
}

export interface ActionMatch {
  keyword: string;
  argument: string;
  handler: ActionHandler;
}

export class ActionsHandlerService extends EventEmitter {
  private actionHandlers: Map<string, ActionHandler> = new Map();
  private installedApps: Set<string> = new Set();
  private appNameMap: Map<string, string> = new Map();

  constructor() {
    super();
    this.initializeInstalledApps();
    this.registerDefaultActions();
  }

  /**
   * Register a new action handler
   */
  registerAction(handler: ActionHandler): void {
    const normalizedKeyword = this.normalizeText(handler.keyword);
    this.actionHandlers.set(normalizedKeyword, handler);
    console.log(`[ActionsHandler] Registered action: "${handler.keyword}"`);
  }

  /**
   * Check if text contains an action and return match if found
   */
  detectAction(text: string): ActionMatch | null {
    const normalizedText = this.normalizeText(text);

    for (const [keyword, handler] of this.actionHandlers) {
      const pattern = new RegExp(`^${this.escapeRegex(keyword)}\\s+(.+)$`, "i");
      const match = normalizedText.match(pattern);

      if (match) {
        const argument = match[1].trim();
        console.log(
          `[ActionsHandler] Detected action: "${handler.keyword}" with argument: "${argument}"`
        );
        return {
          keyword: handler.keyword,
          argument,
          handler,
        };
      }
    }

    return null;
  }

  /**
   * Execute an action match
   */
  executeAction(match: ActionMatch): void {
    console.log(
      `[ActionsHandler] Executing action: "${match.keyword}" with argument: "${match.argument}"`
    );

    // Fire and forget - don't wait for completion
    const result = match.handler.execute(match.argument);

    if (result instanceof Promise) {
      result
        .then(() => {
          this.emit("action-executed", match);
        })
        .catch((error) => {
          console.error(
            `[ActionsHandler] Error executing action "${match.keyword}":`,
            error
          );
          this.emit("action-error", { match, error });
        });
    } else {
      // Synchronous execution completed immediately
      this.emit("action-executed", match);
    }
  }

  /**
   * Get all registered actions
   */
  getRegisteredActions(): ActionHandler[] {
    return Array.from(this.actionHandlers.values());
  }

  /**
   * Get list of installed applications (for debugging)
   */
  getInstalledApps(): string[] {
    return Array.from(this.installedApps);
  }

  /**
   * Initialize list of installed applications
   */
  private async initializeInstalledApps(): Promise<void> {
    try {
      console.log("[ActionsHandler] Initializing installed apps list...");

      const execAsync = promisify(exec);
      const appDirectories = [
        "/Applications",
        "/System/Applications",
        "/System/Library/CoreServices/Applications",
        join(homedir(), "Applications"),
      ];

      let allApps: string[] = [];

      for (const directory of appDirectories) {
        try {
          const { stdout } = await execAsync(`ls "${directory}"`);
          const apps = stdout
            .split("\n")
            .filter((app) => app.trim() && app.endsWith(".app"))
            .map((app) => app.replace(".app", ""));
          allApps = allApps.concat(apps);
        } catch (error) {
          console.warn(
            `[ActionsHandler] Could not read directory ${directory}:`,
            error
          );
        }
      }

      this.installedApps = new Set(allApps.map((app) => app.toLowerCase()));

      // Build mapping from normalized names to original names
      allApps.forEach((app) => {
        this.appNameMap.set(app.toLowerCase(), app);
      });

      console.log(
        `[ActionsHandler] Found ${this.installedApps.size} installed applications`
      );
    } catch (error) {
      console.warn(
        "[ActionsHandler] Failed to initialize installed apps list:",
        error
      );
      this.installedApps = new Set();
    }
  }

  /**
   * Check if an application is installed
   */
  private isAppInstalled(appName: string): boolean {
    const normalizedAppName = this.normalizeText(appName);
    return this.installedApps.has(normalizedAppName);
  }

  /**
   * Open an application by name
   */
  private async openApplication(appName: string): Promise<void> {
    const normalizedAppName = this.normalizeText(appName);
    const actualAppName = this.appNameMap.get(normalizedAppName);

    if (!actualAppName) {
      throw new Error(`Application "${appName}" not found`);
    }

    const execAsync = promisify(exec);
    await execAsync(`open -a "${actualAppName}"`);
  }

  /**
   * Quit an application by name
   */
  private async quitApplication(appName: string): Promise<void> {
    const normalizedAppName = this.normalizeText(appName);
    const actualAppName = this.appNameMap.get(normalizedAppName);

    if (!actualAppName) {
      throw new Error(`Application "${appName}" not found`);
    }

    const execAsync = promisify(exec);
    await execAsync(`pkill -f "${actualAppName}"`);
  }

  /**
   * Search Google and open first result
   */
  private async searchAndOpenFirstResult(query: string): Promise<void> {
    console.log(`[ActionsHandler] Searching Google for: "${query}"`);
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query
    )}&btnI=I%27m+Feeling+Lucky`;
    await shell.openExternal(searchUrl);
  }

  /**
   * Normalize text for comparison (lowercase and trim)
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "");
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Register default action handlers
   */
  private registerDefaultActions(): void {
    // Open action - opens applications or searches web
    this.registerAction({
      keyword: "open",
      description: "Open an application or search for something",
      execute: async (argument: string) => {
        console.log(
          `[ActionsHandler] Processing open action for "${argument}"`
        );

        // Check if it's a URL
        if (argument.match(/^https?:\/\//i) || argument.match(/^www\./i)) {
          const url = argument.startsWith("www.")
            ? `https://${argument}`
            : argument;
          await shell.openExternal(url);
          return;
        }
        console.log(this.installedApps);
        // Check if it's an installed application
        if (this.isAppInstalled(argument)) {
          console.log(
            `[ActionsHandler] Opening installed application: "${argument}"`
          );
          await this.openApplication(argument);
          return;
        }

        // Fallback: search Google for the argument
        console.log(
          `[ActionsHandler] Application not found, searching for: "${argument}"`
        );
        await this.searchAndOpenFirstResult(argument);
      },
    });

    // Search action - opens web search
    this.registerAction({
      keyword: "search",
      description: "Search for something on the web",
      execute: async (argument: string) => {
        console.log(`[ActionsHandler] Searching for "${argument}"`);
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
          argument
        )}`;
        await shell.openExternal(searchUrl);
      },
    });

    // Quit action - quits applications
    this.registerAction({
      keyword: "quit",
      description: "Quit an application",
      execute: async (argument: string) => {
        console.log(
          `[ActionsHandler] Processing quit action for "${argument}"`
        );

        // Check if it's an installed application
        if (await this.isAppInstalled(argument)) {
          console.log(
            `[ActionsHandler] Quitting installed application: "${argument}"`
          );
          await this.quitApplication(argument);
          return;
        }

        // If app not found, throw error
        throw new Error(`Application "${argument}" not found`);
      },
    });
  }
}
