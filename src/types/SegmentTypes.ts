export type SegmentType = "inprogress" | "transcribed" | "selected";

export interface BaseSegment {
  id: string;
  type: SegmentType;
  text: string;
  timestamp: number;
  start?: number;
  end?: number;
}

export interface InProgressSegment extends BaseSegment {
  type: "inprogress";
  confidence?: number;
  completed: boolean;
}

export interface TranscribedSegment extends BaseSegment {
  type: "transcribed";
  confidence?: number;
  completed: boolean;
}

export interface SelectedSegment extends BaseSegment {
  type: "selected";
  originalText: string;
  hasSelection: boolean;
}

export type Segment = InProgressSegment | TranscribedSegment | SelectedSegment;

export interface SegmentUpdate {
  segments: Segment[];
  status: "listening" | "transforming";
}

export interface FlushResult {
  transformedText: string;
  segmentsProcessed: number;
  success: boolean;
  error?: string;
}
