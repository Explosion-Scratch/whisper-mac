import { EventEmitter } from "events";
import { exec } from "child_process";
import { shell } from "electron";
import {
  ActionHandler,
  ActionMatch,
  MatchPattern,
  ActionHandlerConfig,
  HandlerConfig,
  SegmentActionConfig,
  TransformTextConfig,
  ActionResult,
} from "../types/ActionTypes";
import { TranscribedSegment } from "../types/SegmentTypes";

export class ConfigurableActionsService extends EventEmitter {
  private actions: ActionHandler[] = [];
  private installedApps: Set<string> = new Set();
  private segmentManager: any = null;
  private queuedHandlers: ActionHandlerConfig[] = [];

  constructor() {
    super();
    this.initializeInstalledApps();
  }

  setSegmentManager(segmentManager: any): void {
    this.segmentManager = segmentManager;

    // Listen to segment-added events to process queued handlers
    if (segmentManager) {
      segmentManager.on("segment-added", (segment: any) => {
        if (segment.completed && this.queuedHandlers.length > 0) {
          this.processQueuedHandlers(segment);
        }
      });
    }
  }

  private async initializeInstalledApps(): Promise<void> {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const { stdout } = await execAsync("ls /Applications");
      const apps = stdout
        .split("\n")
        .filter((app) => app.endsWith(".app"))
        .map((app) => app.replace(".app", "").toLowerCase());

      this.installedApps = new Set(apps);
      console.log(
        `[ConfigurableActions] Discovered ${apps.length} installed applications`,
      );
    } catch (error) {
      console.error(
        "[ConfigurableActions] Failed to discover installed applications:",
        error,
      );
    }
  }

  setActions(actions: ActionHandler[]): void {
    this.actions = actions
      .filter((action) => action.enabled)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    console.log(
      `[ConfigurableActions] Loaded ${this.actions.length} enabled actions`,
    );
  }

  detectActions(text: string): ActionMatch[] {
    const normalizedText = this.normalizeText(text);
    const matches: ActionMatch[] = [];

    for (const action of this.actions) {
      for (const pattern of action.matchPatterns) {
        const match = this.testPattern(normalizedText, pattern);
        if (match) {
          matches.push({
            actionId: action.id,
            matchedPattern: pattern,
            originalText: text,
            extractedArgument: match.argument,
            handlers: action.handlers.sort((a, b) => a.order - b.order),
          });
          break;
        }
      }
    }

    return matches;
  }

  detectAction(text: string): ActionMatch | null {
    const matches = this.detectActions(text);
    return matches.length > 0 ? matches[0] : null;
  }

  async executeAction(match: ActionMatch): Promise<void> {
    console.log(
      `[ConfigurableActions] Executing action: ${match.actionId} with argument: "${match.extractedArgument}"`,
    );

    for (const handler of match.handlers) {
      try {
        // Check if this handler should be queued for next segment
        if (handler.applyToNextSegment) {
          this.queuedHandlers.push(handler);
          console.log(
            `[ConfigurableActions] Queued handler ${handler.id} for next segment`,
          );
          continue;
        }

        const result = await this.runHandler(handler, match);
        
        // Queue any handlers returned by the action
        if (result.queuedHandlers && result.queuedHandlers.length > 0) {
          this.queuedHandlers.push(...result.queuedHandlers);
          console.log(
            `[ConfigurableActions] Queued ${result.queuedHandlers.length} handler(s) for next segment`,
          );
        }

        if (result.success) {
          this.emit("action-executed", match);
          // Don't return here - continue processing all handlers
        }
      } catch (error) {
        console.warn(
          `[ConfigurableActions] Handler ${handler.id} failed:`,
          error,
        );
        continue;
      }
    }
  }

  /**
   * Run a handler and return the result
   */
  private async runHandler(
    handler: ActionHandlerConfig,
    match: ActionMatch,
  ): Promise<ActionResult> {
    const config = this.interpolateConfig(handler.config, match);

    let success = false;
    const queuedHandlers: ActionHandlerConfig[] = [];

    switch (handler.type) {
      case "openUrl":
        success = await this.executeOpenUrl(config);
        break;
      case "openApplication":
        success = await this.executeOpenApplication(config);
        break;
      case "quitApplication":
        success = await this.executeQuitApplication(config);
        break;
      case "executeShell":
        success = await this.executeShell(config);
        break;
      case "segmentAction":
        const segmentResult = await this.executeSegmentAction(
          config as SegmentActionConfig,
          match,
        );
        success = segmentResult.success;
        if (segmentResult.queuedHandlers) {
          queuedHandlers.push(...segmentResult.queuedHandlers);
        }
        break;
      case "transformText":
        const transformResult = await this.executeTransformText(
          config as TransformTextConfig,
          match,
        );
        success = transformResult.success;
        if (transformResult.queuedHandlers) {
          queuedHandlers.push(...transformResult.queuedHandlers);
        }
        break;
      default:
        console.warn(
          `[ConfigurableActions] Unknown handler type: ${handler.type}`,
        );
        return { success: false };
    }

    return { success, queuedHandlers };
  }

  private async executeOpenUrl(config: any): Promise<boolean> {
    try {
      try {
        const url = new URL(config.urlTemplate).toString();
        await shell.openExternal(url);
        return true;
      } catch (error) {
        // Do nothing
      }
      // Through this magic "H.T.P.S., colon/slash, github.com/explosion-scratch." -> https://github.com/explosion-scratch.
      let url = this._removeTrailingPunctuation(config.urlTemplate || "");
      url = url.replace(/^[,\.\s]+/i, "");
      url = url.replace(/\W*(?:colon|:|cologne)\W*/gi, ":");
      url = url.replace(/\W*(?:slash)\W*/gi, "/");
      url = url.replace(/\W*(?:dot)\W*/gi, ".");
      url = url.replace(/^h(\W?t|b|e|p)+(\W?t|b|e|p)+(\W?s)?/i, "https://");
      url = url.replace(/(\:\/\/)+/gi, "://");
      url = url.replace(/^h[a-z]{1,7}\:?\//i, "https://");
      url = url.replace(/\/+/gi, "/");
      url = url.trim();
      // Validate URL
      if (!url || typeof url !== "string") {
        return false;
      }

      // Check if it's a valid URL or needs protocol
      let finalUrl = url;
      if (
        !url.startsWith("http://") &&
        !url.startsWith("https://") &&
        !url.startsWith("file://")
      ) {
        if (url.startsWith("www.") || url.includes(".")) {
          finalUrl = `https://${url}`;
        } else {
          return false;
        }
      }

      await shell.openExternal(finalUrl);
      return true;
    } catch (error) {
      console.error("[ConfigurableActions] Failed to open URL:", error);
      return false;
    }
  }

  private async executeOpenApplication(config: any): Promise<boolean> {
    try {
      const appName = this._removeTrailingPunctuation(config.applicationName || "").toLowerCase();
      if (!appName) {
        return false;
      }

      // Check if app is installed
      if (!this.installedApps.has(appName)) {
        return false;
      }

      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const command = `open -a "${appName}"`;
      await execAsync(command);
      return true;
    } catch (error) {
      console.error("[ConfigurableActions] Failed to open application:", error);
      return false;
    }
  }

  private async executeQuitApplication(config: any): Promise<boolean> {
    try {
      const appName = config.applicationName;
      const forceQuit = config.forceQuit || false;

      if (!appName) {
        // Quit WhisperMac itself
        const { app } = await import("electron");
        app.quit();
        return true;
      }

      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const command = forceQuit
        ? `pkill -f "${appName}"`
        : `osascript -e 'tell application "${appName}" to quit'`;

      await execAsync(command);
      return true;
    } catch (error) {
      console.error("[ConfigurableActions] Failed to quit application:", error);
      return false;
    }
  }

  private async executeShell(config: any): Promise<boolean> {
    try {
      const command = config.command;
      const workingDirectory = config.workingDirectory || process.cwd();
      const timeout = config.timeout || 10000;
      const runInBackground = config.runInBackground || false;

      if (!command) {
        return false;
      }

      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const execOptions = {
        cwd: workingDirectory,
        timeout,
        env: { ...process.env, ...config.environment },
      };

      if (runInBackground) {
        exec(command, execOptions);
        return true;
      } else {
        await execAsync(command, execOptions);
        return true;
      }
    } catch (error) {
      console.error(
        "[ConfigurableActions] Failed to execute shell command:",
        error,
      );
      return false;
    }
  }

  private async executeSegmentAction(
    config: SegmentActionConfig,
    match: ActionMatch,
  ): Promise<ActionResult> {
    if (!this.segmentManager) {
      console.error(
        "[ConfigurableActions] SegmentManager not available for segment action",
      );
      return { success: false };
    }

    try {
      console.log(
        `[ConfigurableActions] Executing segment action: ${config.action}`,
      );

      switch (config.action) {
        case "clear":
          this.segmentManager.clearAllSegments();
          return { success: true };

        case "undo":
          return { success: this.segmentManager.deleteLastSegment() };

        case "replace": {
          if (!config.replacementText) {
            console.warn(
              "[ConfigurableActions] No replacement text provided for replace action",
            );
            return { success: false };
          }
          // config.replacementText is already interpolated
          return { success: this.segmentManager.replaceLastSegmentContent(config.replacementText) };
        }

        case "deleteLastN": {
          const count = config.count || 1;
          const deletedCount = this.segmentManager.deleteLastNSegments(count);
          return { success: deletedCount > 0 };
        }

        case "lowercaseFirstChar":
          return { success: this.lowercaseFirstChar() };

        case "uppercaseFirstChar":
          return { success: this.uppercaseFirstChar() };

        case "capitalizeFirstWord":
          return { success: this.capitalizeFirstWord() };

        case "removePattern": {
          if (!config.pattern) {
            console.warn("[ConfigurableActions] No pattern provided");
            return { success: false };
          }
          return { success: this.removePattern(config.pattern) };
        }

        default:
          console.warn(
            `[ConfigurableActions] Unknown segment action: ${config.action}`,
          );
          return { success: false };
      }
    } catch (error) {
      console.error(
        "[ConfigurableActions] Failed to execute segment action:",
        error,
      );
      return { success: false };
    }
  }

  /**
   * Execute text transformation action
   */
  private async executeTransformText(
    config: TransformTextConfig,
    match: ActionMatch,
  ): Promise<ActionResult> {
    if (!this.segmentManager) {
      console.error(
        "[ConfigurableActions] SegmentManager not available for transform action",
      );
      return { success: false };
    }

    try {
      const lastSegment = this.segmentManager.getLastSegment();
      if (!lastSegment || !lastSegment.text) {
        console.warn("[ConfigurableActions] No segment text to transform");
        return { success: false };
      }

      let text = lastSegment.text;

      // Check length conditions if specified
      if (config.maxLength && text.length > config.maxLength) {
        console.log(
          `[ConfigurableActions] Text too long for transform (${text.length} > ${config.maxLength})`,
        );
        return { success: false };
      }

      if (config.minLength && text.length < config.minLength) {
        console.log(
          `[ConfigurableActions] Text too short for transform (${text.length} < ${config.minLength})`,
        );
        return { success: false };
      }

      // Check match pattern if specified
      if (config.matchPattern) {
        const matchRegex = new RegExp(config.matchPattern, config.matchFlags || "");
        if (!matchRegex.test(text)) {
          console.log(
            `[ConfigurableActions] Text doesn't match pattern: ${config.matchPattern}`,
          );
          return { success: false };
        }
      }

      // Apply the replacement
      const replaceRegex = new RegExp(
        config.replacePattern,
        config.replaceFlags || "g"
      );

      let replacedText: string;
      if (config.replacementMode === "lowercase") {
        replacedText = text.replace(replaceRegex, (match: string) => match.toLowerCase());
      } else if (config.replacementMode === "uppercase") {
        replacedText = text.replace(replaceRegex, (match: string) => match.toUpperCase());
      } else {
        // Literal replacement (default)
        replacedText = text.replace(replaceRegex, config.replacement || "");
      }

      // Update the segment with transformed text
      lastSegment.text = replacedText;

      console.log(
        `[ConfigurableActions] Transformed text: "${text}" -> "${replacedText}"`,
      );
      this.emit("segment-transformed", {
        segment: lastSegment,
        originalText: text,
        transformedText: replacedText,
      });

      return { success: true };
    } catch (error) {
      console.error(
        "[ConfigurableActions] Failed to transform text:",
        error,
      );
      return { success: false };
    }
  }

  private interpolateConfig(config: HandlerConfig, match: ActionMatch): any {
    const interpolated = JSON.parse(JSON.stringify(config));
    const replacements = {
      "{match}": match.originalText,
      "{argument}": match.extractedArgument || "",
      "{pattern}": match.matchedPattern.pattern,
    };

    const interpolateValue = (value: any): any => {
      if (typeof value === "string") {
        let result = value;
        Object.entries(replacements).forEach(([key, replacement]) => {
          result = result.replace(
            new RegExp(key.replace(/[{}]/g, "\\$&"), "g"),
            replacement,
          );
        });
        return result;
      } else if (Array.isArray(value)) {
        return value.map(interpolateValue);
      } else if (typeof value === "object" && value !== null) {
        const result: any = {};
        Object.entries(value).forEach(([key, val]) => {
          result[key] = interpolateValue(val);
        });
        return result;
      }
      return value;
    };

    return interpolateValue(interpolated);
  }

  private testPattern(
    text: string,
    pattern: MatchPattern,
  ): { argument?: string } | null {
    const testText = pattern.caseSensitive ? text : text.toLowerCase();
    const testPattern = pattern.caseSensitive
      ? pattern.pattern
      : pattern.pattern.toLowerCase();

    switch (pattern.type) {
      case "exact":
        return testText === testPattern ? {} : null;

      case "startsWith":
        if (testText.startsWith(testPattern)) {
          const argument = text.substring(pattern.pattern.length).trim();
          return { argument };
        }
        return null;

      case "endsWith":
        if (testText.endsWith(testPattern)) {
          const argument = text
            .substring(0, text.length - pattern.pattern.length)
            .trim();
          return { argument };
        }
        return null;

      case "regex":
        try {
          const flags = pattern.caseSensitive ? "g" : "gi";
          const regex = new RegExp(testPattern, flags);
          const match = regex.exec(testText);
          if (match) {
            const argument = match[1] || match[0];
            return { argument };
          }
        } catch (error) {
          console.error(
            `[ConfigurableActions] Invalid regex pattern: ${pattern.pattern}`,
            error,
          );
        }
        return null;

      default:
        return null;
    }
  }

  private normalizeText(text: string): string {
    return text.trim().replace(/[^\w\s.]/g, "");
  }

  /**
   * Remove trailing punctuation from text (commonly needed for voice recognition)
   */
  private _removeTrailingPunctuation(text: string): string {
    return text.trim().replace(/[,\.\s]+$/i, "");
  }

  getActions(): ActionHandler[] {
    return [...this.actions].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /**
   * Process queued handlers on a new segment
   */
  private async processQueuedHandlers(segment: any): Promise<void> {
    if (this.queuedHandlers.length === 0) {
      return;
    }

    console.log(
      `[ConfigurableActions] Processing ${this.queuedHandlers.length} queued handler(s) on new segment`,
    );

    const handlersToProcess = [...this.queuedHandlers];
    this.queuedHandlers = [];

    for (const handler of handlersToProcess) {
      try {
        // Create a mock match for interpolation
        const mockMatch: ActionMatch = {
          actionId: "queued-action",
          matchedPattern: {
            id: "queued",
            type: "exact",
            pattern: "",
            caseSensitive: false,
          },
          originalText: segment.text,
          extractedArgument: "",
          handlers: [handler],
        };

        await this.runHandler(handler, mockMatch);
      } catch (error) {
        console.error(
          `[ConfigurableActions] Failed to process queued handler:`,
          error,
        );
      }
    }
  }

  /**
   * Simple segment manipulation methods
   */
  private lowercaseFirstChar(): boolean {
    const lastSegment = this.segmentManager?.getLastSegment();
    if (!lastSegment || !lastSegment.text) return false;

    const newText =
      lastSegment.text.charAt(0).toLowerCase() + lastSegment.text.slice(1);
    lastSegment.text = newText;
    console.log(`[ConfigurableActions] Lowercased first char: "${newText}"`);
    return true;
  }

  private uppercaseFirstChar(): boolean {
    const lastSegment = this.segmentManager?.getLastSegment();
    if (!lastSegment || !lastSegment.text) return false;

    const newText =
      lastSegment.text.charAt(0).toUpperCase() + lastSegment.text.slice(1);
    lastSegment.text = newText;
    console.log(`[ConfigurableActions] Uppercased first char: "${newText}"`);
    return true;
  }

  private capitalizeFirstWord(): boolean {
    const lastSegment = this.segmentManager?.getLastSegment();
    if (!lastSegment || !lastSegment.text) return false;

    const words = lastSegment.text.split(" ");
    if (words.length > 0) {
      words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
      const newText = words.join(" ");
      lastSegment.text = newText;
      console.log(`[ConfigurableActions] Capitalized first word: "${newText}"`);
      return true;
    }
    return false;
  }

  private removePattern(pattern: string): boolean {
    const lastSegment = this.segmentManager?.getLastSegment();
    if (!lastSegment || !lastSegment.text) return false;

    // For patterns that should match literal dots (like ellipses),
    // we need to handle them specially since we want to match "..." not "\.\.\."
    let regexPattern: string;
    if (pattern === "\\.\\.\\.") {
      // Special case for ellipses - match actual dots, not escaped dots
      regexPattern = "\\.{3,}$";
    } else {
      // Escape special regex characters for other patterns
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regexPattern = escapedPattern + "+$";
    }

    const newText = lastSegment.text
      .replace(new RegExp(regexPattern), "")
      .trim();

    // Pattern removal might produce empty text, but we keep the segment
    // so subsequent actions can still operate or it can serve as a spacer
    lastSegment.text = newText;
    console.log(
      `[ConfigurableActions] Removed pattern "${pattern}": "${newText}"`,
    );
    return true;
  }

  /**
   * Clear queued handlers
   */
  clearQueuedHandlers(): void {
    const count = this.queuedHandlers.length;
    this.queuedHandlers = [];
    if (count > 0) {
      console.log(`[ConfigurableActions] Cleared ${count} queued handler(s)`);
    }
  }

  /**
   * Get queued handlers count
   */
  getQueuedHandlersCount(): number {
    return this.queuedHandlers.length;
  }

  /**
   * Execute all-segments actions before AI transformation
   */
  async executeAllSegmentsActionsBeforeAI(segments: TranscribedSegment[]): Promise<void> {
    await this.executeGlobalActionsOnSegments(segments, "before_ai");
  }

  /**
   * Execute all-segments actions after AI transformation
   */
  async executeAllSegmentsActionsAfterAI(segments: TranscribedSegment[]): Promise<void> {
    await this.executeGlobalActionsOnSegments(segments, "after_ai");
  }

  /**
   * Execute global actions on segments based on timing mode
   */
  private async executeGlobalActionsOnSegments(
    segments: TranscribedSegment[],
    timingMode: "before_ai" | "after_ai"
  ): Promise<void> {
    const globalActions = this.actions.filter(
      (action) => action.applyToAllSegments && action.timingMode === timingMode
    );

    if (globalActions.length === 0) {
      return;
    }

    console.log(
      `[ConfigurableActions] Found ${globalActions.length} ${timingMode} global actions to execute on ${segments.length} segments`
    );

    // Create a virtual segment with combined text from all segments
    const combinedText = segments
      .map((s) => s.text.trim())
      .filter((text) => text.length > 0)
      .join(" ");

    const virtualSegment: TranscribedSegment = {
      id: "virtual-combined-segment",
      type: "transcribed",
      text: combinedText,
      completed: true,
      timestamp: Date.now(),
    };

    console.log(
      `[ConfigurableActions] Created virtual segment with combined text: "${combinedText}"`
    );

    // For each global action, test if it matches the combined text and apply transformation
    for (const action of globalActions) {
      for (const pattern of action.matchPatterns) {
        // Test pattern against the combined text
        const match = this.testPattern(virtualSegment.text.trim(), pattern);
        if (match) {
          console.log(
            `[ConfigurableActions] Executing ${timingMode} global action: ${action.id} on combined text: "${virtualSegment.text}"`
          );

          // Create action match and execute handlers
          const actionMatch: ActionMatch = {
            actionId: action.id,
            matchedPattern: pattern,
            originalText: virtualSegment.text,
            extractedArgument: match.argument,
            handlers: action.handlers.sort((a, b) => a.order - b.order),
          };

          // Execute each handler on the virtual segment
          for (const handler of actionMatch.handlers) {
            if (handler.type === "transformText") {
              await this.executeTransformTextOnSegment(handler, virtualSegment, actionMatch);
            }
          }

          // Update all original segments with the transformed combined text
          // Put all transformed text in the first segment and clear the others
          if (segments.length > 0 && virtualSegment.text !== combinedText) {
            segments[0].text = virtualSegment.text;
            for (let i = 1; i < segments.length; i++) {
              segments[i].text = "";
            }
            console.log(
              `[ConfigurableActions] Updated segments with transformed text: "${virtualSegment.text}"`
            );
          }

          break; // Only match first pattern that succeeds
        }
      }
    }
  }

  /**
   * Execute transformText handler on a single segment
   */
  private async executeTransformTextOnSegment(
    handler: ActionHandlerConfig,
    segment: TranscribedSegment,
    match: ActionMatch
  ): Promise<void> {
    const config = this.interpolateConfig(handler.config, match);
    let text = segment.text;

    // Check length conditions if specified
    if (config.maxLength && text.length > config.maxLength) {
      console.log(
        `[ConfigurableActions] Text too long for transform (${text.length} > ${config.maxLength})`
      );
      return;
    }

    if (config.minLength && text.length < config.minLength) {
      console.log(
        `[ConfigurableActions] Text too short for transform (${text.length} < ${config.minLength})`
      );
      return;
    }

    // Check match pattern if specified
    if (config.matchPattern) {
      const matchRegex = new RegExp(config.matchPattern, config.matchFlags || "");
      if (!matchRegex.test(text)) {
        console.log(
          `[ConfigurableActions] Text doesn't match pattern: ${config.matchPattern}`
        );
        return;
      }
    }

    // Apply the replacement
    const replaceRegex = new RegExp(
      config.replacePattern,
      config.replaceFlags || "g"
    );

    let replacedText: string;
    if (config.replacementMode === "lowercase") {
      replacedText = text.replace(replaceRegex, (match: string) => match.toLowerCase());
    } else if (config.replacementMode === "uppercase") {
      replacedText = text.replace(replaceRegex, (match: string) => match.toUpperCase());
    } else {
      // Literal replacement (default)
      replacedText = text.replace(replaceRegex, config.replacement || "");
    }

    // Update the segment with transformed text
    if (replacedText !== text) {
      const originalText = segment.text;
      segment.text = replacedText;

      console.log(
        `[ConfigurableActions] Transformed segment text: "${originalText}" -> "${replacedText}"`
      );
      this.emit("segment-transformed", {
        segment,
        originalText,
        transformedText: replacedText,
      });
    }
  }
}
