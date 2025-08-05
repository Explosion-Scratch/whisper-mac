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
import { clipboard } from "electron";

export class SegmentManager extends EventEmitter {
  private segments: Segment[] = [];
  private initialSelectedText: string | null = null; // Store selected text here
  private originalClipboard: string | null = null; // Store original clipboard content
  private selectedTextResult: SelectedTextResult | null = null; // Store the full selected text result
  private transformationService: TransformationService;
  private textInjectionService: TextInjectionService;
  private selectedTextService: SelectedTextService;

  constructor(
    transformationService: TransformationService,
    textInjectionService: TextInjectionService,
    selectedTextService: SelectedTextService
  ) {
    super();
    this.transformationService = transformationService;
    this.textInjectionService = textInjectionService;
    this.selectedTextService = selectedTextService;
  }

  setOriginalClipboard(text: string): void {
    this.originalClipboard = text.trim();
  }

  /**
   * Stores the initially selected text for the dictation session.
   */
  setInitialSelectedText(text: string): void {
    this.initialSelectedText = text.trim();
    console.log(
      `[SegmentManager] Set initial selected text: "${this.initialSelectedText}"`
    );
  }

  /**
   * Stores the selected text result for the dictation session.
   */
  setSelectedTextResult(result: SelectedTextResult): void {
    this.selectedTextResult = result;
    console.log(
      `[SegmentManager] Set selected text result: ${JSON.stringify(result)}`
    );
  }

  /**
   * Add a transcribed segment from WhisperLive
   */
  addTranscribedSegment(
    text: string,
    completed: boolean,
    start?: number,
    end?: number,
    confidence?: number
  ): TranscribedSegment {
    const trimmedText = text.trim();
    console.log(
      `[SegmentManager] Attempting to add segment: "${trimmedText}" (completed: ${completed})`
    );

    // If a completed segment arrives, delete all in-progress segments.
    if (completed) {
      this.segments = this.segments.filter(
        (s) => s.type === "transcribed" && s.completed
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
        (s) => s.type !== "transcribed" || s.completed
      );
    }

    // Check for exact duplicates (e.g., re-processing the same completed segment)
    const segmentKey = `${start}-${end}-${trimmedText}`;
    const isDuplicate = this.segments.some((s) => {
      if (s.type !== "transcribed") return false;
      const existingKey = `${s.start}-${s.end}-${s.text.trim()}`;
      return existingKey === segmentKey && s.completed === completed;
    });

    if (isDuplicate) {
      console.log(
        `[SegmentManager] Skipping duplicate segment: "${trimmedText}"`
      );
      return this.segments.find(
        (s) => s.type === "transcribed" && s.text.trim() === trimmedText
      ) as TranscribedSegment;
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
    this.emit("segment-added", segment);
    console.log(
      `[SegmentManager] Added transcribed segment: "${trimmedText}" (completed: ${completed})`
    );
    return segment;
  }

  private async saveState(): Promise<SelectedTextResult> {
    // Use stored selected text result if available, otherwise get fresh
    if (this.selectedTextResult) {
      console.log("[SegmentManager] Using stored selected text result");
      return this.selectedTextResult;
    }
    console.log("[SegmentManager] Getting fresh selected text");
    return await this.selectedTextService.getSelectedText();
  }

  private async restoreState(state: SelectedTextResult): Promise<void> {
    if (!this.selectedTextService) {
      return;
    }
    if (state.originalClipboard) {
      this.selectedTextService.setClipboardContent(state.originalClipboard);
    }
  }

  /**
   * Processes segments and injects them.
   * On a partial flush (includeInProgress=false), it only processes completed segments.
   * On a final flush (includeInProgress=true), it includes the initial selected text and all transcribed segments.
   */
  async flushSegments(
    includeInProgress: boolean = false
  ): Promise<FlushResult> {
    const SAVED_STATE = await this.saveState();
    const RESTORE_STATE = async () => {
      console.log("Restoring state");
      await this.restoreState(SAVED_STATE);
      console.log("State restored");
    };
    console.log("SAVED_STATE", SAVED_STATE);
    try {
      console.log(
        `[SegmentManager] Starting flush operation (includeInProgress: ${includeInProgress})`
      );

      let segmentsToProcess: TranscribedSegment[] = [];

      if (includeInProgress) {
        // FINAL FLUSH: Process all transcribed segments
        segmentsToProcess = this.segments.filter(
          (s) => s.type === "transcribed"
        ) as TranscribedSegment[];
      } else {
        // PARTIAL FLUSH: Process only completed transcribed segments
        segmentsToProcess = this.getCompletedTranscribedSegments();
      }

      if (segmentsToProcess.length === 0) {
        console.log("[SegmentManager] No new segments to flush");
        return { transformedText: "", segmentsProcessed: 0, success: true };
      }

      console.log(
        `[SegmentManager] Flushing ${segmentsToProcess.length} segments`
      );

      // Transform all segments
      const transformResult =
        await this.transformationService.transformSegments(
          segmentsToProcess,
          SAVED_STATE
        );

      if (!transformResult.success) {
        console.error(
          "[SegmentManager] Transformation failed:",
          transformResult.error
        );
        return {
          transformedText: "",
          segmentsProcessed: 0,
          success: false,
          error: transformResult.error,
        };
      }

      if (!transformResult.success) {
        console.error(
          "[SegmentManager] Transformation failed:",
          transformResult.error
        );
        return {
          transformedText: "",
          segmentsProcessed: 0,
          success: false,
          error: transformResult.error,
        };
      }

      const transformedText = transformResult.transformedText;
      if (transformedText) {
        this.textInjectionService
          .insertText(transformedText + " ")
          .then(RESTORE_STATE);
        console.log(`[SegmentManager] Injected text: "${transformedText}"`);
      }

      // Remove the processed segments from state
      if (includeInProgress) {
        // This is a full, final flush. Clear everything.
        this.clearAllSegments();
      } else {
        // This is a partial flush. Remove only the processed segments.
        this.segments = this.segments.filter(
          (s) => !(s.type === "transcribed" && s.completed)
        );
      }

      console.log(
        `[SegmentManager] Flush completed successfully. Remaining segments: ${this.segments.length}`
      );

      return {
        transformedText,
        segmentsProcessed: transformResult.segmentsProcessed,
        success: true,
      };
    } catch (error) {
      console.error("[SegmentManager] Flush failed:", error);
      return {
        transformedText: "",
        segmentsProcessed: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      RESTORE_STATE();
    }
  }

  /**
   * Flush all segments (including selected and in-progress)
   */
  async flushAllSegments(): Promise<FlushResult> {
    return this.flushSegments(true);
  }

  /**
   * Clear all segments and stored selected text
   */
  clearAllSegments(): void {
    console.log(
      `[SegmentManager] Clearing all ${this.segments.length} segments and selected text`
    );
    this.segments = [];
    this.initialSelectedText = null;
    this.selectedTextResult = null;
    this.emit("segments-cleared");
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
      (s) => s.type === "transcribed" && s.completed
    ) as TranscribedSegment[];
  }

  /**
   * Get in-progress transcribed segments
   */
  getInProgressTranscribedSegments(): TranscribedSegment[] {
    return this.segments.filter(
      (s) => s.type === "transcribed" && !s.completed
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
      (s) => s.type === "transcribed"
    ).length;
    const completed = this.segments.filter(
      (s) => s.type === "transcribed" && s.completed
    ).length;
    const inProgress = this.segments.filter(
      (s) => s.type === "transcribed" && !s.completed
    ).length;

    return {
      total: this.segments.length,
      transcribed,
      completed,
      inProgress,
    };
  }
}
