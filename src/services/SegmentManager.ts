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
   * Get current selected text from the system (for transformation step)
   */
  async getCurrentSelectedText(): Promise<string> {
    try {
      const result = await this.selectedTextService.getSelectedText();
      return result.text.trim();
    } catch (error) {
      console.error(
        "[SegmentManager] Failed to get current selected text:",
        error
      );
      return "";
    }
  }

  /**
   * Unified flush method that gets selected text during transformation
   */
  async flushSegments(
    includeInProgress: boolean = false
  ): Promise<FlushResult> {
    try {
      console.log("[SegmentManager] Starting unified flush operation...");

      // Get segments to process
      let segmentsToProcess: Segment[] = [];

      if (includeInProgress) {
        // Include all transcribed segments (completed and in-progress)
        segmentsToProcess = this.segments.filter(
          (s) => s.type === "transcribed"
        );
      } else {
        // Only completed transcribed segments
        segmentsToProcess = this.getCompletedTranscribedSegments();
      }

      if (segmentsToProcess.length === 0) {
        console.log("[SegmentManager] No segments to flush");
        return {
          transformedText: "",
          segmentsProcessed: 0,
          success: true,
        };
      }

      console.log(
        `[SegmentManager] Flushing ${segmentsToProcess.length} segments`
      );

      // Get current selected text and add it as a segment for transformation
      const currentSelectedText = await this.getCurrentSelectedText();
      const allSegmentsForTransformation: Segment[] = [];

      // Add selected text segment if there is selected text
      if (currentSelectedText) {
        const selectedSegment: SelectedSegment = {
          id: uuidv4(),
          type: "selected",
          text: currentSelectedText,
          originalText: currentSelectedText,
          hasSelection: true,
          timestamp: Date.now(),
        };
        allSegmentsForTransformation.push(selectedSegment);
        console.log(
          `[SegmentManager] Added current selected text: "${currentSelectedText}"`
        );
      }

      // Add transcribed segments
      allSegmentsForTransformation.push(...segmentsToProcess);

      // Transform all segments using the new unified method
      const transformResult =
        await this.transformationService.transformSegments(
          allSegmentsForTransformation
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

      const transformedText = transformResult.transformedText;

      if (transformedText) {
        // Inject the transformed text
        await this.textInjectionService.insertText(transformedText + " ");
        console.log(`[SegmentManager] Injected text: "${transformedText}"`);
      }

      // Remove the processed segments from state
      if (includeInProgress) {
        // Clear all segments for full flush
        this.segments = [];
      } else {
        // Remove only completed transcribed segments
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
    }
  }

  /**
   * Flush all segments (including selected and in-progress) - now uses unified method
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
