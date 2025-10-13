import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import {
  Segment,
  SegmentType,
  TranscribedSegment,
  FlushResult,
} from "../types/SegmentTypes";
import { TransformationService } from "./TransformationService";
import { TextInjectionService } from "./TextInjectionService";
import { SelectedTextResult, SelectedTextService } from "./SelectedTextService";
import { ConfigurableActionsService } from "./ConfigurableActionsService";

export class SegmentManager extends EventEmitter {
  private segments: Segment[] = [];
  private initialSelectedText: string | null = null; // Store selected text here
  private transformationService: TransformationService;
  private textInjectionService: TextInjectionService;
  private selectedTextService: SelectedTextService;
  private configurableActionsService: ConfigurableActionsService | null = null;
  private isAccumulatingMode: boolean = false; // New: track if we're in accumulate-only mode
  private ignoreNextCompleted: boolean = false;
  private lastExecutedAction: {
    actionId: string;
    skipsTransformation?: boolean;
  } | null = null;

  constructor(
    transformationService: TransformationService,
    textInjectionService: TextInjectionService,
    selectedTextService: SelectedTextService,
    configurableActionsService?: ConfigurableActionsService,
  ) {
    super();
    this.transformationService = transformationService;
    this.textInjectionService = textInjectionService;
    this.selectedTextService = selectedTextService;
    this.configurableActionsService = configurableActionsService || null;
  }

  setAccumulatingMode(enabled: boolean): void {
    this.isAccumulatingMode = enabled;
    console.log(`[SegmentManager] Accumulating mode set to: ${enabled}`);
  }

  isInAccumulatingMode(): boolean {
    return this.isAccumulatingMode;
  }

  /**
   * Stores the initially selected text for the dictation session.
   */
  setInitialSelectedText(text: string): void {
    this.initialSelectedText = text.trim();
    console.log(
      `[SegmentManager] Set initial selected text: "${this.initialSelectedText}"`,
    );
  }

  /**
   * Deduplicate segments based on start, end times and trimmed text
   */
  private deduplicateSegments(): void {
    const seen = new Set<string>();
    const uniqueSegments: Segment[] = [];

    for (const segment of this.segments) {
      if (segment.type === "transcribed") {
        const transcribedSegment = segment as TranscribedSegment;
        const key = `${transcribedSegment.start}-${transcribedSegment.end
          }-${transcribedSegment.text.trim()}`;

        if (!seen.has(key)) {
          seen.add(key);
          uniqueSegments.push(segment);
        } else {
          console.log(
            `[SegmentManager] Removed duplicate segment: "${transcribedSegment.text}" (${transcribedSegment.start}-${transcribedSegment.end})`,
          );
        }
      } else {
        // Keep non-transcribed segments as-is
        uniqueSegments.push(segment);
      }
    }

    this.segments = uniqueSegments;
  }

  /**
   * Add a transcribed segment from transcription plugins
   */
  addTranscribedSegment(
    text: string,
    completed: boolean,
    start?: number,
    end?: number,
    confidence?: number,
  ): TranscribedSegment {
    const trimmedText = text.trim();
    console.log(
      `[SegmentManager] Attempting to add segment: "${trimmedText}" (completed: ${completed})`,
    );

    // Check for actions in completed segments before processing
    if (completed && this.configurableActionsService) {
      const actionMatch =
        this.configurableActionsService.detectAction(trimmedText);
      if (actionMatch) {
        console.log(
          `[SegmentManager] Action detected: "${actionMatch.actionId
          }" with argument: "${actionMatch.extractedArgument || "none"}"`,
        );

        // Store action information for potential transformation skipping
        const actions = this.configurableActionsService.getActions();
        const action = actions.find((a) => a.id === actionMatch.actionId);
        this.lastExecutedAction = {
          actionId: actionMatch.actionId,
          skipsTransformation: action?.skipsTransformation,
        };

        // Emit action detected event
        this.emit("action-detected", actionMatch);

        // Return a segment but mark it as action-triggered
        return {
          id: uuidv4(),
          type: "transcribed",
          text: trimmedText,
          completed,
          start,
          end,
          confidence,
          timestamp: Date.now(),
        };
      }
    }

    // One-shot ignore for the next completed segment after a flush
    if (completed && this.ignoreNextCompleted) {
      console.log(
        "[SegmentManager] Ignoring next completed segment post-flush",
      );
      this.ignoreNextCompleted = false;
      return {
        id: uuidv4(),
        type: "transcribed",
        text: trimmedText,
        completed,
        start,
        end,
        confidence,
        timestamp: Date.now(),
      };
    }

    // If a completed segment arrives, delete all in-progress segments.
    if (completed) {
      this.segments = this.segments.filter(
        (s) => s.type === "transcribed" && s.completed,
      );
      this.segments.push({
        id: uuidv4(),
        type: "transcribed",
        text: trimmedText,
        completed,
        start,
        end,
        confidence,
        timestamp: Date.now(),
      });
    }

    // If it's a new in-progress segment, clear out all other old ones first.
    if (!completed) {
      this.segments = this.segments.filter(
        (s) => s.type !== "transcribed" || s.completed,
      );
    }

    const segment: TranscribedSegment = {
      id: uuidv4(),
      type: "transcribed",
      text: trimmedText,
      completed,
      start,
      end,
      confidence,
      timestamp: Date.now(),
    };

    this.segments.push(segment);

    // Deduplicate segments after adding the new one
    this.deduplicateSegments();

    this.emit("segment-added", segment);
    console.log(
      `[SegmentManager] Added transcribed segment: "${trimmedText}" (completed: ${completed})`,
    );
    return segment;
  }

  /**
   * Transform and inject all accumulated segments regardless of completion status
   * Used when manually triggering the transform+inject flow
   */
  async transformAndInjectAllSegments(): Promise<FlushResult> {
    return this.transformAndInjectAllSegmentsInternal({
      skipTransformation: false,
    });
  }

  async transformAndInjectAllSegmentsInternal(options: {
    skipTransformation?: boolean;
    onInjecting?: () => void;
  }): Promise<FlushResult> {
    console.log("[SegmentManager] Transform and inject all segments");

    const segmentsToProcess = this.segments.filter(
      (s) => s.type === "transcribed" && (s as TranscribedSegment).completed,
    ) as TranscribedSegment[];

    if (segmentsToProcess.length === 0) {
      console.log("[SegmentManager] No segments to transform and inject");
      return { transformedText: "", segmentsProcessed: 0, success: true };
    }

    console.log(
      `[SegmentManager] Transforming and injecting ${segmentsToProcess.length} segments`,
    );

    try {
      // Check if transformation should be skipped due to plugin criteria or last executed action
      const shouldSkipTransformation =
        options?.skipTransformation ||
        this.lastExecutedAction?.skipsTransformation;

      if (shouldSkipTransformation) {
        // Bypass transformation and inject original text combined
        const originalText = segmentsToProcess
          .map((segment) => segment.text.trim())
          .filter((text) => text.length > 0)
          .join(" ");

        if (originalText) {
          options.onInjecting?.();
          await this.textInjectionService.insertText(originalText);
          console.log(
            `[SegmentManager] Direct-injected text without transformation: "${originalText}"`,
          );
          this.emit("transformed", { transformedText: originalText });
        }

        this.clearAllSegments();
        this.lastExecutedAction = null; // Reset after use
        return {
          transformedText: originalText,
          segmentsProcessed: segmentsToProcess.length,
          success: true,
        };
      }

      // Transform all segments
      const transformResult =
        await this.transformationService.transformSegments(
          segmentsToProcess,
          await this.selectedTextService.getSelectedText(),
        );

      if (!transformResult.success) {
        console.error(
          "[SegmentManager] Transformation failed:",
          transformResult.error,
        );
        return await this.handleTransformationFallback(
          segmentsToProcess,
          transformResult.error || "Transformation failed",
          options.onInjecting,
        );
      }

      const transformedText = transformResult.transformedText;
      if (transformedText) {
        options.onInjecting?.();
        await this.textInjectionService.insertText(transformedText);
        console.log(`[SegmentManager] Injected text: "${transformedText}"`);

        // Emit transformed event for hotkey last result tracking
        this.emit("transformed", { transformedText });
      }

      // Clear all segments after successful transform+inject
      this.clearAllSegments();
      this.lastExecutedAction = null; // Reset after use

      console.log(
        `[SegmentManager] Transform and inject completed successfully`,
      );

      return {
        transformedText,
        segmentsProcessed: transformResult.segmentsProcessed,
        success: true,
      };
    } catch (error) {
      console.error("[SegmentManager] Transform and inject failed:", error);
      return await this.handleTransformationFallback(
        segmentsToProcess,
        error instanceof Error ? error.message : "Unknown error",
        options.onInjecting,
      );
    }
  }

  /** Inject raw text directly, bypassing transformation */
  async injectDirectText(text: string): Promise<void> {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    await this.textInjectionService.insertText(trimmed);
    this.clearAllSegments();
  }

  /**
   * Handle fallback to original text when transformation fails
   */
  private async handleTransformationFallback(
    segmentsToProcess: TranscribedSegment[],
    error: string,
    onInjecting?: () => void,
  ): Promise<FlushResult> {
    const originalText = segmentsToProcess
      .map((segment) => segment.text.trim())
      .filter((text) => text.length > 0)
      .join(" ");

    if (originalText) {
      console.log(
        `[SegmentManager] Falling back to injecting original text: "${originalText}"`,
      );
      onInjecting?.();
      await this.textInjectionService.insertText(originalText);
    }

    // Clear all segments after fallback injection
    this.clearAllSegments();

    return {
      transformedText: originalText,
      segmentsProcessed: segmentsToProcess.length,
      success: true,
      error,
    };
  }

  /**
   * Clear all segments and stored selected text
   */
  clearAllSegments(): void {
    console.log(
      `[SegmentManager] Clearing all ${this.segments.length} segments and selected text`,
    );
    this.segments = [];
    this.initialSelectedText = null;
    this.isAccumulatingMode = false; // Reset accumulating mode when clearing
    this.emit("segments-cleared");
  }

  /**
   * Delete only the last segment (undo functionality)
   */
  deleteLastSegment(): boolean {
    if (this.segments.length === 0) {
      console.log("[SegmentManager] No segments to delete");
      return false;
    }

    const lastSegment = this.segments.pop();
    console.log(
      `[SegmentManager] Deleted last segment: "${lastSegment?.text}" (${lastSegment?.id})`,
    );
    this.emit("segment-deleted", lastSegment);
    return true;
  }

  /**
   * Replace the content of the last segment
   */
  replaceLastSegmentContent(newContent: string): boolean {
    if (this.segments.length === 0) {
      console.log("[SegmentManager] No segments to replace");
      return false;
    }

    const lastSegment = this.segments[this.segments.length - 1];
    const oldContent = lastSegment.text;
    lastSegment.text = newContent.trim();

    console.log(
      `[SegmentManager] Replaced segment content: "${oldContent}" -> "${newContent}"`,
    );
    this.emit("segment-content-replaced", {
      segment: lastSegment,
      oldContent,
      newContent,
    });
    return true;
  }

  /**
   * Delete the last N segments
   */
  deleteLastNSegments(count: number): number {
    if (count <= 0 || this.segments.length === 0) {
      return 0;
    }

    const actualCount = Math.min(count, this.segments.length);
    const deletedSegments = this.segments.splice(-actualCount, actualCount);

    console.log(
      `[SegmentManager] Deleted ${actualCount} segments: ${deletedSegments
        .map((s) => `"${s.text}"`)
        .join(", ")}`,
    );
    this.emit("segments-deleted", deletedSegments);
    return actualCount;
  }

  /**
   * Transform last segment by removing trailing ellipses and queue action for next segment
   */
  transformLastSegmentEllipses(): { success: boolean; hadEllipses: boolean } {
    if (this.segments.length === 0) {
      return { success: false, hadEllipses: false };
    }

    const lastSegment = this.segments[this.segments.length - 1];
    const originalText = lastSegment.text;
    const hasEllipses = originalText.endsWith("...");

    if (hasEllipses) {
      lastSegment.text = originalText.replace(/\.\.\.+$/, "").trim();
      console.log(
        `[SegmentManager] Removed ellipses from segment: "${originalText}" -> "${lastSegment.text}"`,
      );
      this.emit("segment-ellipses-removed", {
        segment: lastSegment,
        originalText,
      });
    }

    return { success: true, hadEllipses: hasEllipses };
  }

  /**
   * Apply lowercase transformation to the first word of the last segment
   */
  lowercaseFirstWordOfLastSegment(): boolean {
    if (this.segments.length === 0) {
      return false;
    }

    const lastSegment = this.segments[this.segments.length - 1];
    const originalText = lastSegment.text;

    if (!originalText) {
      return false;
    }

    // Make first letter lowercase
    const transformedText =
      originalText.charAt(0).toLowerCase() + originalText.slice(1);
    lastSegment.text = transformedText;

    console.log(
      `[SegmentManager] Lowercased first word: "${originalText}" -> "${transformedText}"`,
    );
    this.emit("segment-first-word-lowercased", {
      segment: lastSegment,
      originalText,
    });

    return true;
  }

  /**
   * Get the last segment
   */
  getLastSegment(): Segment | null {
    return this.segments.length > 0
      ? this.segments[this.segments.length - 1]
      : null;
  }

  /**
   * Get all segments
   */
  getAllSegments(): Segment[] {
    return [...this.segments];
  }

  /**
   * Get segments by type
   */
  getSegmentsByType(type: SegmentType): Segment[] {
    return this.segments.filter((s) => s.type === type);
  }

  /**
   * Get completed transcribed segments
   */
  getCompletedTranscribedSegments(): TranscribedSegment[] {
    return this.segments.filter(
      (s) => s.type === "transcribed" && s.completed,
    ) as TranscribedSegment[];
  }

  /**
   * Get in-progress transcribed segments
   */
  getInProgressTranscribedSegments(): TranscribedSegment[] {
    return this.segments.filter(
      (s) => s.type === "transcribed" && !s.completed,
    ) as TranscribedSegment[];
  }

  /**
   * Update an existing segment (typically for in-progress segments)
   */
  updateSegment(id: string, updates: Partial<Segment>): boolean {
    const index = this.segments.findIndex((s) => s.id === id);
    if (index === -1) {
      console.warn(`[SegmentManager] Segment not found for update: ${id}`);
      return false;
    }

    const originalSegment = this.segments[index];
    const updatedSegment = { ...originalSegment, ...updates } as Segment;
    this.segments[index] = updatedSegment;

    this.emit("segment-updated", updatedSegment);
    console.log(`[SegmentManager] Updated segment: ${id}`);

    return true;
  }

  /**
   * Get segment statistics
   */
  getStats(): {
    total: number;
    transcribed: number;
    completed: number;
    inProgress: number;
  } {
    const transcribed = this.segments.filter(
      (s) => s.type === "transcribed",
    ).length;
    const completed = this.segments.filter(
      (s) => s.type === "transcribed" && s.completed,
    ).length;
    const inProgress = this.segments.filter(
      (s) => s.type === "transcribed" && !s.completed,
    ).length;

    return {
      total: this.segments.length,
      transcribed,
      completed,
      inProgress,
    };
  }

  /** Instruct manager to ignore the next completed segment delivered. */
  ignoreNextCompletedSegment(): void {
    this.ignoreNextCompleted = true;
    console.log("[SegmentManager] Will ignore next completed segment");
  }

  /** Reset the one-shot ignore flag (e.g., when starting a new session). */
  resetIgnoreNextCompleted(): void {
    this.ignoreNextCompleted = false;
    console.log("[SegmentManager] Ignore-next-completed reset");
  }
}
