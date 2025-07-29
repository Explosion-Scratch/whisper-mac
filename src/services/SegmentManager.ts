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
import { SelectedTextService } from "./SelectedTextService";

export class SegmentManager extends EventEmitter {
  private segments: Segment[] = [];
  private initialSelectedText: string | null = null; // Store selected text here
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
   * Stores the initially selected text for the dictation session.
   */
  setInitialSelectedText(text: string): void {
    this.initialSelectedText = text.trim();
    console.log(
      `[SegmentManager] Set initial selected text: "${this.initialSelectedText}"`
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
    console.log(
      `[SegmentManager] Attempting to add segment: "${text}" (completed: ${completed})`
    );

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
      if (!existingSegment.completed && completed) {
        console.log(
          `[SegmentManager] Updating in-progress segment to completed: "${text}"`
        );
        existingSegment.completed = completed;
        existingSegment.confidence = confidence;
        this.emit("segment-updated", existingSegment);
        return existingSegment;
      }
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
   * Processes segments and injects them.
   * On a partial flush (includeInProgress=false), it only processes completed segments.
   * On a final flush (includeInProgress=true), it includes the initial selected text and all transcribed segments.
   */
  async flushSegments(
    includeInProgress: boolean = false
  ): Promise<FlushResult> {
    try {
      console.log(
        `[SegmentManager] Starting flush operation (includeInProgress: ${includeInProgress})`
      );

      let segmentsToProcess: TranscribedSegment[] = [];
      let prefixText: string | undefined = undefined;

      if (includeInProgress) {
        // FINAL FLUSH: Process all transcribed segments and use the initial selected text.
        segmentsToProcess = this.segments.filter(
          (s) => s.type === "transcribed"
        ) as TranscribedSegment[];
        prefixText = this.initialSelectedText ?? undefined;
      } else {
        // PARTIAL FLUSH: Process only completed transcribed segments. Do not use prefix.
        segmentsToProcess = this.getCompletedTranscribedSegments();
      }

      if (segmentsToProcess.length === 0 && !prefixText) {
        console.log("[SegmentManager] No new segments to flush");
        return { transformedText: "", segmentsProcessed: 0, success: true };
      }

      console.log(
        `[SegmentManager] Flushing ${
          segmentsToProcess.length
        } segments with prefix: "${prefixText || ""}"`
      );

      // Transform all segments
      const transformResult =
        await this.transformationService.transformSegments(segmentsToProcess, {
          prefixText,
        });

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
        await this.textInjectionService.insertText(transformedText + " ");
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
