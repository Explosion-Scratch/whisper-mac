import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import {
  Segment,
  SegmentType,
  TranscribedSegment,
  FlushResult,
} from "../types/SegmentTypes";
import { ActionHandler, ActionHandlerConfig, ActionMatch } from "../types/ActionTypes";
import { TransformationService } from "./TransformationService";
import { TextInjectionService } from "./TextInjectionService";
import { SelectedTextResult, SelectedTextService } from "./SelectedTextService";
import { ConfigurableActionsService } from "./ConfigurableActionsService";

export class SegmentManager extends EventEmitter {
  private segments: Segment[] = [];
  private initialSelectedText: string | null = null;
  private transformationService: TransformationService;
  private textInjectionService: TextInjectionService;
  private selectedTextService: SelectedTextService;
  private configurableActionsService: ConfigurableActionsService | null = null;
  private isAccumulatingMode: boolean = false;
  private ignoreNextCompleted: boolean = false;
  private lastExecutedAction: {
    actionIds: string[];
    skipsTransformation?: boolean;
    skipsAllTransforms?: boolean;
  } | null = null;
  private queuedHandlers: ActionHandlerConfig[] = [];

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

  setInitialSelectedText(text: string): void {
    this.initialSelectedText = text.trim();
  }

  private deduplicateSegments(): void {
    const seen = new Set<string>();
    const uniqueSegments: Segment[] = [];

    for (const segment of this.segments) {
      if (segment.type === "transcribed") {
        const transcribedSegment = segment as TranscribedSegment;
        if (transcribedSegment.start !== undefined && transcribedSegment.end !== undefined) {
          const key = `${transcribedSegment.start}-${transcribedSegment.end}-${transcribedSegment.text.trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueSegments.push(segment);
          }
        } else {
          uniqueSegments.push(segment);
        }
      } else {
        uniqueSegments.push(segment);
      }
    }
    this.segments = uniqueSegments;
  }

  addTranscribedSegment(
    text: string,
    completed: boolean,
    start?: number,
    end?: number,
    confidence?: number,
  ): { segment: TranscribedSegment; closesTranscription: boolean } {
    const trimmedText = text.trim();
    console.log(
      `[SegmentManager] Attempting to add segment: "${trimmedText}" (completed: ${completed})`,
    );

    if (completed && this.ignoreNextCompleted) {
      console.log("[SegmentManager] Ignoring next completed segment post-flush");
      this.ignoreNextCompleted = false;
      return {
        segment: {
          id: uuidv4(),
          type: "transcribed",
          text: trimmedText,
          completed,
          start,
          end,
          confidence,
          timestamp: Date.now(),
        },
        closesTranscription: false,
      };
    }

    if (completed) {
      this.segments = this.segments.filter(
        (s) => s.type === "transcribed" && s.completed,
      );
    } else {
      this.segments = this.segments.filter(
        (s) => s.type !== "transcribed" || s.completed,
      );
    }

    let segment: TranscribedSegment = {
      id: uuidv4(),
      type: "transcribed",
      text: trimmedText,
      completed,
      start,
      end,
      confidence,
      timestamp: Date.now(),
    };

    // Add the new segment temporarily for processing
    this.segments.push(segment);

    // Deduplicate immediately
    this.deduplicateSegments();

    // Re-find the added segment if it survived deduplication, or use the last one
    const foundSegment = this.segments.find(s => s.id === segment.id);
    if (foundSegment) {
      segment = foundSegment as TranscribedSegment;
      this.emit("segment-added", segment);
    } else if (this.segments.length > 0) {
      segment = this.segments[this.segments.length - 1] as TranscribedSegment;
      // Do not emit segment-added for duplicates
    } else {
      // If segment was removed (e.g. duplicate), just return the original object but it won't be in list
      return { segment, closesTranscription: false };
    }

    // === Process Queued Handlers First ===
    if (completed && this.queuedHandlers.length > 0 && this.configurableActionsService) {
      console.log(`[SegmentManager] Processing ${this.queuedHandlers.length} queued handlers`);

      // Work on transcribed segments only
      let transcribedSegments = this.getTranscribedSegments();

      const handlersToProcess = [...this.queuedHandlers];
      this.queuedHandlers = [];

      for (const handler of handlersToProcess) {
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

        const result = this.configurableActionsService.runHandler(handler, mockMatch, transcribedSegments);

        if (result.success) {
          transcribedSegments = result.segments;
          this.updateSegmentsFromTranscribed(transcribedSegments);

          // Update reference to current segment for return
          if (transcribedSegments.length > 0) {
            segment = transcribedSegments[transcribedSegments.length - 1];
          }
        }

        if (result.queuedHandlers) {
          this.queuedHandlers.push(...result.queuedHandlers);
        }
      }
    }

    // === Execute Detected Actions ===
    if (completed && this.configurableActionsService) {
      // Detect actions on the *current state* of the text
      const actionMatches = this.configurableActionsService.detectActions(segment.text);

      if (actionMatches.length > 0) {
        const transcribedSegments = this.getTranscribedSegments();

        const result = this.configurableActionsService.executeActions(
          transcribedSegments,
          actionMatches,
        );

        // Update segments with modified version
        this.updateSegmentsFromTranscribed(result.segments);

        if (result.segments.length > 0) {
          segment = result.segments[result.segments.length - 1];
        }

        // Store queued handlers for next segment
        if (result.queuedHandlers.length > 0) {
          this.queuedHandlers.push(...result.queuedHandlers);
        }

        this.lastExecutedAction = {
          actionIds: actionMatches.map((m) => m.actionId),
          skipsTransformation: result.skipsTransformation,
          skipsAllTransforms: result.skipsAllTransforms,
        };

        // Emit event for non-segment actions
        const hasNonSegmentHandlers = actionMatches.some(match =>
          match.handlers.some(h =>
            ["openUrl", "openApplication", "quitApplication", "executeShell"].includes(h.type)
          )
        );

        if (hasNonSegmentHandlers) {
          this.emit("actions-detected", actionMatches);
        }

        return { segment, closesTranscription: result.closesTranscription };
      }
    }

    return { segment, closesTranscription: false };
  }

  // Helper to get only transcribed segments for action processing
  private getTranscribedSegments(): TranscribedSegment[] {
    return this.segments.filter(s => s.type === "transcribed") as TranscribedSegment[];
  }

  // Helper to update main segments list from modified transcribed list
  private updateSegmentsFromTranscribed(transcribed: TranscribedSegment[]): void {
    // Keep non-transcribed segments (like selected text placeholders if any)
    const nonTranscribed = this.segments.filter(s => s.type !== "transcribed");
    this.segments = [...nonTranscribed, ...transcribed];
  }

  // ... (Rest of methods: transformAndInjectAllSegments, etc.) ...
  // Keeping existing implementations for transformation methods as they rely on other services
  // but ConfigurableActionsService is now used purely via executeActions/runHandler

  async transformAndInjectAllSegments(): Promise<FlushResult> {
    return this.transformAndInjectAllSegmentsInternal({
      skipTransformation: false,
    });
  }

  async transformAndInjectAllSegmentsInternal(options: {
    skipTransformation?: boolean;
    skipAllTransforms?: boolean;
    onInjecting?: () => void;
  }): Promise<FlushResult> {
    const segmentsToProcess = this.getCompletedTranscribedSegments();

    if (segmentsToProcess.length === 0) {
      return { transformedText: "", segmentsProcessed: 0, success: true };
    }

    try {
      const shouldSkipAllTransforms = options?.skipAllTransforms || this.lastExecutedAction?.skipsAllTransforms;
      const shouldSkipTransformation = options?.skipTransformation || this.lastExecutedAction?.skipsTransformation;

      if (shouldSkipAllTransforms) {
        const originalText = segmentsToProcess.map(s => s.text.trim()).filter(t => t.length).join(" ");
        if (originalText) {
          options.onInjecting?.();
          await this.textInjectionService.insertText(originalText);
          this.emit("raw", { rawText: originalText });
          this.emit("transformed", { transformedText: originalText });
        }
        this.clearAllSegments();
        this.lastExecutedAction = null;
        return { transformedText: originalText, segmentsProcessed: segmentsToProcess.length, success: true };
      }

      if (shouldSkipTransformation) {
        if (this.configurableActionsService) {
          await this.configurableActionsService.executeAllSegmentsActionsBeforeAI(segmentsToProcess);
        }
        let currentText = segmentsToProcess.map(s => s.text.trim()).filter(t => t.length).join(" ");

        // Execute after_ai actions even if skipping AI (e.g. auto-trim punctuation)
        if (this.configurableActionsService && currentText.length > 0) {
          const tempSegment: TranscribedSegment = {
            id: "temp-combined",
            type: "transcribed",
            text: currentText,
            completed: true,
            timestamp: Date.now(),
          };
          await this.configurableActionsService.executeAllSegmentsActionsAfterAI([tempSegment]);
          currentText = tempSegment.text;
        }

        const finalText = currentText ? this.transformationService.finalizeText(currentText) : currentText;

        if (finalText) {
          options.onInjecting?.();
          await this.textInjectionService.insertText(finalText);
          this.emit("raw", { rawText: currentText });
          this.emit("transformed", { transformedText: finalText });
        }
        this.clearAllSegments();
        this.lastExecutedAction = null;
        return { transformedText: finalText, segmentsProcessed: segmentsToProcess.length, success: true };
      }

      if (this.configurableActionsService) {
        await this.configurableActionsService.executeAllSegmentsActionsBeforeAI(segmentsToProcess);
      }

      let originalText = segmentsToProcess.map(s => s.text.trim()).filter(t => t.length).join(" ");

      // Apply after_ai actions to the raw text as well (for injectRawLastResult)
      if (this.configurableActionsService && originalText.length > 0) {
        const tempSegment: TranscribedSegment = {
          id: "temp-raw",
          type: "transcribed",
          text: originalText,
          completed: true,
          timestamp: Date.now(),
        };
        // We use a copy of the actions service logic or just re-run it on this temp segment
        // Note: This might duplicate side effects if actions have them, but typically after_ai actions are pure text transforms
        await this.configurableActionsService.executeAllSegmentsActionsAfterAI([tempSegment]);
        originalText = tempSegment.text;
      }

      const transformResult = await this.transformationService.transformSegments(
        segmentsToProcess,
        await this.selectedTextService.getSelectedText(),
      );

      if (transformResult.success && transformResult.transformedText && this.configurableActionsService) {
        const transformedSegment: TranscribedSegment = {
          id: uuidv4(),
          type: "transcribed",
          text: transformResult.transformedText,
          completed: true,
          timestamp: Date.now(),
        };
        await this.configurableActionsService.executeAllSegmentsActionsAfterAI([transformedSegment]);
        transformResult.transformedText = transformedSegment.text;
      }

      if (!transformResult.success) {
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
        if (originalText) this.emit("raw", { rawText: originalText });
        this.emit("transformed", { transformedText });
      }

      this.clearAllSegments();
      this.lastExecutedAction = null;
      return { transformedText, segmentsProcessed: transformResult.segmentsProcessed, success: true };

    } catch (error) {
      return await this.handleTransformationFallback(
        segmentsToProcess,
        error instanceof Error ? error.message : "Unknown error",
        options.onInjecting,
      );
    }
  }

  async injectDirectText(text: string): Promise<void> {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    await this.textInjectionService.insertText(trimmed);
    this.clearAllSegments();
  }

  private async handleTransformationFallback(
    segmentsToProcess: TranscribedSegment[],
    error: string,
    onInjecting?: () => void,
  ): Promise<FlushResult> {
    if (this.configurableActionsService) {
      await this.configurableActionsService.executeAllSegmentsActionsBeforeAI(segmentsToProcess);
    }
    const originalText = segmentsToProcess.map(s => s.text.trim()).filter(t => t.length).join(" ");
    const finalText = originalText ? this.transformationService.finalizeText(originalText) : originalText;

    if (finalText) {
      onInjecting?.();
      await this.textInjectionService.insertText(finalText);
      if (originalText) this.emit("raw", { rawText: originalText });
      this.emit("transformed", { transformedText: finalText });
    }
    this.clearAllSegments();
    return { transformedText: finalText, segmentsProcessed: segmentsToProcess.length, success: true, error };
  }

  clearAllSegments(): void {
    this.segments = [];
    this.initialSelectedText = null;
    this.isAccumulatingMode = false;
    this.queuedHandlers = []; // Clear queued handlers too
    this.emit("segments-cleared");
  }

  // Legacy segment manipulation methods mostly replaced by executeActions logic,
  // but kept for any direct usage if needed, though executeAction should be preferred.
  deleteLastSegment(): boolean {
    if (this.segments.length === 0) return false;
    const lastSegment = this.segments.pop();
    this.emit("segment-deleted", lastSegment);
    return true;
  }

  replaceLastSegmentContent(newContent: string): boolean {
    if (this.segments.length === 0) return false;
    const lastSegment = this.segments[this.segments.length - 1];
    const oldContent = lastSegment.text;
    lastSegment.text = newContent.trim();
    this.emit("segment-content-replaced", { segment: lastSegment, oldContent, newContent });
    return true;
  }

  deleteLastNSegments(count: number): number {
    if (count <= 0 || this.segments.length === 0) return 0;
    const actualCount = Math.min(count, this.segments.length);
    const deletedSegments = this.segments.splice(-actualCount, actualCount);
    this.emit("segments-deleted", deletedSegments);
    return actualCount;
  }

  getLastSegment(): Segment | null {
    return this.segments.length > 0 ? this.segments[this.segments.length - 1] : null;
  }

  getAllSegments(): Segment[] {
    return [...this.segments];
  }

  getCompletedTranscribedSegments(): TranscribedSegment[] {
    return this.segments.filter(s => s.type === "transcribed" && s.completed) as TranscribedSegment[];
  }

  getInProgressTranscribedSegments(): TranscribedSegment[] {
    return this.segments.filter(s => s.type === "transcribed" && !s.completed) as TranscribedSegment[];
  }

  updateSegment(id: string, updates: Partial<Segment>): boolean {
    const index = this.segments.findIndex((s) => s.id === id);
    if (index === -1) return false;
    const updatedSegment = { ...this.segments[index], ...updates } as Segment;
    this.segments[index] = updatedSegment;
    this.emit("segment-updated", updatedSegment);
    return true;
  }

  getStats() {
    const transcribed = this.segments.filter(s => s.type === "transcribed").length;
    const completed = this.segments.filter(s => s.type === "transcribed" && s.completed).length;
    const inProgress = this.segments.filter(s => s.type === "transcribed" && !s.completed).length;
    return { total: this.segments.length, transcribed, completed, inProgress };
  }

  ignoreNextCompletedSegment(): void {
    this.ignoreNextCompleted = true;
  }

  resetIgnoreNextCompleted(): void {
    this.ignoreNextCompleted = false;
  }
}
