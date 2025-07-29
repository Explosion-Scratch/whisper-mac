import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import {
  Segment,
  SegmentType,
  TranscribedSegment,
  SelectedSegment,
  FlushResult,
} from "../types/SegmentTypes";
import { TransformationService } from "./TransformationService";
import { TextInjectionService } from "./TextInjectionService";
import { SelectedTextService } from "./SelectedTextService";

export class SegmentManager extends EventEmitter {
  private segments: Segment[] = [];
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

  /**
   * Add a selected text segment at the beginning of dictation
   */
  addSelectedSegment(text: string, hasSelection: boolean): SelectedSegment {
    const segment: SelectedSegment = {
      id: uuidv4(),
      type: "selected",
      text: text.trim(),
      originalText: text,
      hasSelection,
      timestamp: Date.now(),
    };

    this.segments.unshift(segment); // Add at beginning
    this.emit("segment-added", segment);
    console.log(`[SegmentManager] Added selected segment: "${text}"`);

    return segment;
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
    console.log(
      `[SegmentManager] Attempting to add segment: "${text}" (completed: ${completed})`
    );

    // Check for duplicate segments based on content and timing
    const segmentKey = `${start}-${end}-${text.trim()}`;
    const existingSegmentIndex = this.segments.findIndex((s) => {
      if (s.type !== "transcribed") return false;
      const existingKey = `${s.start}-${s.end}-${s.text.trim()}`;
      return existingKey === segmentKey;
    });

    if (existingSegmentIndex !== -1) {
      const existingSegment = this.segments[
        existingSegmentIndex
      ] as TranscribedSegment;

      // If we're updating an in-progress segment to completed, update it
      if (!existingSegment.completed && completed) {
        console.log(
          `[SegmentManager] Updating in-progress segment to completed: "${text}"`
        );
        existingSegment.completed = completed;
        existingSegment.confidence = confidence;
        this.emit("segment-updated", existingSegment);
        return existingSegment;
      }

      // Otherwise, skip duplicate
      console.log(`[SegmentManager] Skipping duplicate segment: "${text}"`);
      return existingSegment;
    }

    const segment: TranscribedSegment = {
      id: uuidv4(),
      type: "transcribed",
      text: text.trim(),
      completed,
      start,
      end,
      confidence,
      timestamp: Date.now(),
    };

    this.segments.push(segment);
    this.emit("segment-added", segment);
    console.log(
      `[SegmentManager] Added transcribed segment: "${text}" (completed: ${completed})`
    );

    return segment;
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
   * Get selected text segment
   */
  getSelectedSegment(): SelectedSegment | null {
    const selected = this.segments.find(
      (s) => s.type === "selected"
    ) as SelectedSegment;
    return selected || null;
  }

  /**
   * Unified flush method that uses the manager's internal state.
   * It no longer fetches selected text.
   */
  async flushSegments(
    includeInProgress: boolean = false
  ): Promise<FlushResult> {
    try {
      console.log("[SegmentManager] Starting flush operation...");

      // Determine which segments to process based on the manager's state
      const selectedSegment = this.getSelectedSegment();
      let transcribedToProcess: TranscribedSegment[];

      if (includeInProgress) {
        // Full flush: get all transcribed segments (completed and in-progress)
        transcribedToProcess = this.segments.filter(
          (s) => s.type === "transcribed"
        ) as TranscribedSegment[];
      } else {
        // Partial flush: get only completed transcribed segments
        transcribedToProcess = this.getCompletedTranscribedSegments();
      }

      const segmentsToTransform: Segment[] = [];
      if (selectedSegment) {
        segmentsToTransform.push(selectedSegment);
      }
      segmentsToTransform.push(...transcribedToProcess);

      if (segmentsToTransform.length === 0) {
        console.log("[SegmentManager] No segments to flush");
        return { transformedText: "", segmentsProcessed: 0, success: true };
      }

      console.log(
        `[SegmentManager] Flushing ${segmentsToTransform.length} segments`
      );

      // Transform all segments using the new unified method
      const transformResult =
        await this.transformationService.transformSegments(segmentsToTransform);

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
        // Inject the transformed text
        await this.textInjectionService.insertText(transformedText + " ");
        console.log(`[SegmentManager] Injected text: "${transformedText}"`);
      }

      // Remove the processed segments from state
      if (includeInProgress) {
        // Full flush, clear everything
        this.segments = [];
      } else {
        // Partial flush, remove only the completed transcribed segments.
        // The selected segment and in-progress segments remain.
        this.segments = this.segments.filter(
          (s) => !(s.type === "transcribed" && s.completed)
        );
      }

      console.log(
        `[SegmentManager] Flush completed. Remaining segments: ${this.segments.length}`
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
    }
  }

  /**
   * Flush all segments (including selected and in-progress)
   */
  async flushAllSegments(): Promise<FlushResult> {
    return this.flushSegments(true);
  }

  /**
   * Clear all segments
   */
  clearAllSegments(): void {
    console.log(
      `[SegmentManager] Clearing all ${this.segments.length} segments`
    );
    this.segments = [];
    this.emit("segments-cleared");
  }

  /**
   * Clear only the in-progress transcribed segments
   */
  clearInProgressSegments(): void {
    const originalCount = this.segments.length;
    // An in-progress segment is stored as type: 'transcribed' with completed: false
    this.segments = this.segments.filter(
      (s) => !(s.type === "transcribed" && s.completed === false)
    );
    if (this.segments.length < originalCount) {
      console.log(
        `[SegmentManager] Cleared ${
          originalCount - this.segments.length
        } old in-progress segments.`
      );
    }
  }

  /**
   * Get segment statistics
   */
  getStats(): {
    total: number;
    selected: number;
    transcribed: number;
    completed: number;
    inProgress: number;
  } {
    const selected = this.segments.filter((s) => s.type === "selected").length;
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
      selected,
      transcribed,
      completed,
      inProgress,
    };
  }
}
