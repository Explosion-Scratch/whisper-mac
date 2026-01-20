import { EventEmitter } from "events";
import {
  ActionHandler,
  ActionMatch,
  MatchPattern,
  ActionHandlerConfig,
  HandlerConfig,
  SegmentActionConfig,
  TransformTextConfig,
  ActionResult,
  SegmentActionResult,
  CleanUrlConfig,
} from "../types/ActionTypes";
import { TranscribedSegment } from "../types/SegmentTypes";
import cleanSpokenUrl, { URL_FINDER_REGEX } from "../utils/cleanSpokenUrl";

export class ConfigurableActionsService extends EventEmitter {
  private actions: ActionHandler[] = [];
  private installedApps: Set<string> = new Set();

  constructor() {
    super();
    this.initializeInstalledApps();
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
      if (action.applyToAllSegments) continue;

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

  /**
   * Execute matched actions on the current list of segments.
   * Returns updated segments and control flags.
   */
  executeActions(
    segments: TranscribedSegment[],
    actionMatches: ActionMatch[],
  ): SegmentActionResult {
    // Work on a copy of segments to maintain immutability during processing steps
    let currentSegments = [...segments];
    let closesTranscription = false;
    let skipsTransformation = false;
    let skipsAllTransforms = false;
    const queuedHandlers: ActionHandlerConfig[] = [];

    const actions = this.getActions();

    for (const actionMatch of actionMatches) {
      const action = actions.find((a) => a.id === actionMatch.actionId);
      if (!action) continue;

      if (action.closesTranscription) {
        closesTranscription = true;
      }
      if (action.skipsTransformation) {
        skipsTransformation = true;
      }
      if (action.skipsAllTransforms) {
        skipsAllTransforms = true;
      }

      for (const handler of actionMatch.handlers) {
        // Queue handlers for next segment if requested
        if (handler.applyToNextSegment) {
          queuedHandlers.push(handler);
          continue;
        }

        // Execute handler on current segments
        const result = this.runHandler(handler, actionMatch, currentSegments);

        if (result.success && result.segments) {
          currentSegments = result.segments;
          
          if (handler.stopOnSuccess) {
            console.log(`[ConfigurableActions] Stopping action ${action.name} after successful handler ${handler.id}`);
            break;
          }
        }

        if (result.queuedHandlers) {
          queuedHandlers.push(...result.queuedHandlers);
        }
      }
    }

    return {
      segments: currentSegments,
      closesTranscription,
      skipsTransformation,
      skipsAllTransforms,
      queuedHandlers,
    };
  }

  /**
   * Run a single handler on segments.
   * Pure function: takes segments and returns modified segments.
   */
  runHandler(
    handler: ActionHandlerConfig,
    match: ActionMatch,
    segments: TranscribedSegment[],
  ): { success: boolean; segments: TranscribedSegment[]; queuedHandlers?: ActionHandlerConfig[] } {
    if (handler.conditions && !this.checkConditions(handler.conditions, segments)) {
      return { success: false, segments };
    }

    const escapeFn = handler.type === "executeShell" ? shellEscape : undefined;
    const config = interpolateConfig(handler.config, match, escapeFn);

    let success = false;
    let updatedSegments = [...segments];
    const queuedHandlers: ActionHandlerConfig[] = [];

    switch (handler.type) {
      case "segmentAction":
        const segmentResult = executeSegmentAction(
          config as SegmentActionConfig,
          updatedSegments,
        );
        success = segmentResult.success;
        updatedSegments = segmentResult.segments;
        if (segmentResult.queuedHandlers) {
          queuedHandlers.push(...segmentResult.queuedHandlers);
        }
        break;
      case "transformText":
        const transformResult = executeTransformText(
          config as TransformTextConfig,
          updatedSegments,
        );
        success = transformResult.success;
        updatedSegments = transformResult.segments;
        if (transformResult.queuedHandlers) {
          queuedHandlers.push(...transformResult.queuedHandlers);
        }
        if (transformResult.event) {
          this.emit(transformResult.event.name, transformResult.event.data);
        }
        break;

      case "cleanUrl": {
        const cleanResult = executeCleanUrl(
          config as CleanUrlConfig,
          updatedSegments
        );
        success = cleanResult.success;
        updatedSegments = cleanResult.segments;
        break;
      }
      case "openUrl":
        this.executeOpenUrl(config);
        success = true;
        break;
      case "openApplication":
        this.executeOpenApplication(config);
        success = true;
        break;
      case "quitApplication":
        this.executeQuitApplication(config);
        success = true;
        break;
      case "executeShell":
        this.executeShell(config);
        success = true;
        break;
      default:
        console.warn(
          `[ConfigurableActions] Unknown handler type: ${handler.type}`,
        );
        return { success: false, segments };
    }

    return { success, segments: updatedSegments, queuedHandlers };
  }

  private async executeOpenUrl(config: any): Promise<boolean> {
    try {
      const { shell } = await import("electron");
      const urlTemplate = config.urlTemplate;
      
      // If we have a direct argument injection, let's clean it first if it looks like a URL
      // This allows "Open [spoken url]" to work better
      let cleanedUrl = urlTemplate;
      if (urlTemplate.includes("{argument}")) {
        // The argument might be a spoken URL
        // We can't easily detect if it IS a URL before interpolation, 
        // but we can try to clean the result effectively.
        // Actually, let's just clean the result of interpolation in runHandler logic, 
        // or - cleaner - apply cleanSpokenUrl logic here on the final URL.
      }
      
      try {
        // First try as-is (e.g. if it's already a valid URL or interpolated valid URL)
        const urlObj = new URL(cleanedUrl);
        await shell.openExternal(urlObj.toString());
        return true;
      } catch (error) {
        // Continue to cleanup logic
      }

    // Clean URL if possible
    const finalUrl = cleanSpokenUrl(cleanedUrl);

    if (!finalUrl) return false;

    // Open URL
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
      if (!appName) return false;

      if (!this.installedApps.has(appName)) return false;

      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      await execAsync(`open -a "${appName}"`);
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

      if (!command) return false;

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
      console.error("[ConfigurableActions] Failed to execute shell command:", error);
      return false;
    }
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
    // Allow word characters, whitespace, and common punctuation
    return text.trim().replace(/[^\w\s\.\?!:;,\-]/g, "");
  }

  private _removeTrailingPunctuation(text: string): string {
    return text.trim().replace(/[,\.\s]+$/i, "");
  }

  getActions(): ActionHandler[] {
    return [...this.actions].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  private checkConditions(conditions: any, segments: TranscribedSegment[]): boolean {
    if (segments.length === 0) return false;

    // Check previous segment conditions
    if (conditions.previousSegmentMatchPattern) {
      if (segments.length < 2) return false;
      const previousSegment = segments[segments.length - 2];
      const regex = new RegExp(
        conditions.previousSegmentMatchPattern,
        conditions.previousSegmentMatchFlags || ""
      );
      if (!regex.test(previousSegment.text)) {
        return false;
      }
    }

    return true;
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

    // For each global action, test if it matches the combined text and apply transformation
    for (const action of globalActions) {
      for (const pattern of action.matchPatterns) {
        const match = this.testPattern(virtualSegment.text.trim(), pattern);
        if (match) {
          const actionMatch: ActionMatch = {
            actionId: action.id,
            matchedPattern: pattern,
            originalText: virtualSegment.text,
            extractedArgument: match.argument,
            handlers: action.handlers.sort((a, b) => a.order - b.order),
          };

          // Helper array for executeTransformText
          const virtualSegmentsArray = [virtualSegment];

          for (const handler of actionMatch.handlers) {
            if (handler.type === "transformText") {
              const result = executeTransformText(
                handler.config as TransformTextConfig,
                virtualSegmentsArray
              );
              if (result.success && result.segments.length > 0) {
                virtualSegment.text = result.segments[0].text;
              }
            } else if (handler.type === "cleanUrl") {
              const result = executeCleanUrl(
                handler.config as CleanUrlConfig,
                virtualSegmentsArray
              );
              if (result.success && result.segments.length > 0) {
                virtualSegment.text = result.segments[0].text;
              }
            }
          }

          // Update all original segments with the transformed combined text
          if (segments.length > 0 && virtualSegment.text !== combinedText) {
            segments[0].text = virtualSegment.text;
            for (let i = 1; i < segments.length; i++) {
              segments[i].text = "";
            }
          }
          break;
        }
      }
    }
  }
}

// --- Pure Helper Functions ---

function shellEscape(arg: string): string {
  // Basic shell escaping: wrap in single quotes and escape single quotes inside
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function interpolateConfig(config: HandlerConfig, match: ActionMatch, escapeFn?: (s: string) => string): any {
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
        const finalReplacement = escapeFn ? escapeFn(replacement) : replacement;
        result = result.replace(
          new RegExp(key.replace(/[{}]/g, "\\$&"), "g"),
          finalReplacement,
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

function executeSegmentAction(
  config: SegmentActionConfig,
  segments: TranscribedSegment[],
): { success: boolean; segments: TranscribedSegment[]; queuedHandlers?: ActionHandlerConfig[] } {
  const updatedSegments = [...segments];
  console.log(`[ConfigurableActions] Executing segment action: ${config.action} on ${segments.length} segments`);

  try {
    switch (config.action) {
      case "clear":
        console.log("[ConfigurableActions] Clearing all segments");
        return { success: true, segments: [] };

      case "undo":
        if (updatedSegments.length > 0) {
          updatedSegments.pop();
          console.log("[ConfigurableActions] Undoing last segment");
          return { success: true, segments: updatedSegments };
        }
        return { success: false, segments };

      case "replace":
        if (updatedSegments.length > 0) {
          if (!config.replacementText) {
            console.warn("[ConfigurableActions] No replacement text provided");
            return { success: false, segments };
          }
          updatedSegments[updatedSegments.length - 1].text = config.replacementText;
          return { success: true, segments: updatedSegments };
        }
        return { success: false, segments };

      case "deleteLastN":
        const count = config.count || 1;
        if (updatedSegments.length > 0) {
          const actualCount = Math.min(count, updatedSegments.length);
          updatedSegments.splice(-actualCount, actualCount);
          console.log(`[ConfigurableActions] Deleted last ${actualCount} segments`);
          return { success: true, segments: updatedSegments };
        }
        return { success: false, segments };

      case "lowercaseFirstChar":
        if (updatedSegments.length > 0) {
          const last = updatedSegments[updatedSegments.length - 1];
          if (last.text) {
            last.text = last.text.charAt(0).toLowerCase() + last.text.slice(1);
            return { success: true, segments: updatedSegments };
          }
        }
        return { success: false, segments };

      case "uppercaseFirstChar":
        if (updatedSegments.length > 0) {
          const last = updatedSegments[updatedSegments.length - 1];
          if (last.text) {
            last.text = last.text.charAt(0).toUpperCase() + last.text.slice(1);
            return { success: true, segments: updatedSegments };
          }
        }
        return { success: false, segments };

      case "capitalizeFirstWord":
        if (updatedSegments.length > 0) {
          const last = updatedSegments[updatedSegments.length - 1];
          if (last.text) {
            const words = last.text.split(" ");
            if (words.length > 0 && words[0].length > 0) {
              words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
              last.text = words.join(" ");
              return { success: true, segments: updatedSegments };
            }
          }
        }
        return { success: false, segments };

      case "removePattern":
        if (updatedSegments.length > 0) {
          const last = updatedSegments[updatedSegments.length - 1];
          if (!config.pattern || !last.text) {
            return { success: false, segments };
          }
          let regexPattern: string;
          if (config.pattern === "\\.\\.\\.") {
            regexPattern = "\\.{3,}$";
          } else {
            const escapedPattern = config.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            regexPattern = escapedPattern + "+$";
          }
          last.text = last.text.replace(new RegExp(regexPattern), "").trim();
          return { success: true, segments: updatedSegments };
        }
        return { success: false, segments };

      case "mergeWithPrevious":
        if (updatedSegments.length >= 2) {
          const current = updatedSegments.pop(); // Remove last
          const previous = updatedSegments[updatedSegments.length - 1]; // New last

          if (current && previous) {
            if (config.trimPreviousPunctuation) {
              previous.text = previous.text.replace(/[.,?!]+$/, "").trim();
            }

            const joiner = config.joiner !== undefined ? config.joiner : " ";
            previous.text = previous.text + joiner + current.text;

            console.log(`[ConfigurableActions] Merged segment into previous: "${previous.text}"`);
            return { success: true, segments: updatedSegments };
          }
        }
        return { success: false, segments };

      default:
        console.warn(`[ConfigurableActions] Unknown segment action: ${config.action}`);
        return { success: false, segments };
    }
  } catch (error) {
    console.error("[ConfigurableActions] Failed to execute segment action:", error);
    return { success: false, segments };
  }
}

function executeTransformText(
  config: TransformTextConfig,
  segments: TranscribedSegment[],
): { success: boolean; segments: TranscribedSegment[]; queuedHandlers?: ActionHandlerConfig[]; event?: { name: string; data: any } } {
  const updatedSegments = [...segments];
  if (updatedSegments.length === 0) {
    return { success: false, segments };
  }

  try {
    const lastSegment = updatedSegments[updatedSegments.length - 1];
    if (!lastSegment || !lastSegment.text) {
      return { success: false, segments };
    }

    let text = lastSegment.text;

    // Check length conditions if specified
    if (config.maxLength && text.length > config.maxLength) {
      return { success: false, segments };
    }

    if (config.minLength && text.length < config.minLength) {
      return { success: false, segments };
    }

    // Check match pattern if specified
    if (config.matchPattern) {
      const matchRegex = new RegExp(config.matchPattern, config.matchFlags || "");
      if (!matchRegex.test(text)) {
        return { success: false, segments };
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

    return {
      success: true,
      segments: updatedSegments,
      event: {
        name: "segment-transformed",
        data: {
          segment: lastSegment,
          originalText: text,
          transformedText: replacedText,
        }
      }
    };
  } catch (error) {
    console.error(
      "[ConfigurableActions] Failed to transform text:",
      error,
    );
    return { success: false, segments };
  }
}

// Helper to execute cleanUrl action
function executeCleanUrl(
  config: CleanUrlConfig,
  segments: TranscribedSegment[]
): { success: boolean; segments: TranscribedSegment[] } {
  const updatedSegments = [...segments];
  if (updatedSegments.length === 0) {
    return { success: false, segments };
  }

  try {
    const lastSegment = updatedSegments[updatedSegments.length - 1];
    if (!lastSegment || !lastSegment.text) {
      return { success: false, segments };
    }

    let text = lastSegment.text;
    let replacedText = text;

    // Always use the robust URL finder regex to clean all URLs in the input
    // The user has specified that this handler should NOT be configurable and should just work.
    const matchRegex = new RegExp(URL_FINDER_REGEX); // Ensure it's a new instance with global flag from definition
    replacedText = text.replace(matchRegex, (match) => {
      const cleaned = cleanSpokenUrl(match);
      return cleaned || match;
    });

    if (replacedText !== text) {
      lastSegment.text = replacedText;
      return { success: true, segments: updatedSegments };
    }

    return { success: false, segments };
  } catch (error) {
    console.error("[ConfigurableActions] Error in executeCleanUrl:", error);
    return { success: false, segments };
  }
}
