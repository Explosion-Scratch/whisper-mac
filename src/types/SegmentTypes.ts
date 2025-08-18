export type SegmentType = "inprogress" | "transcribed";

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
}

export interface TranscribedSegment extends BaseSegment {
  type: "transcribed";
  confidence?: number;
  completed: boolean;
}

export type Segment = InProgressSegment | TranscribedSegment;

export interface SegmentUpdate {
  segments: Segment[];
  status?: "listening" | "transforming";
  sessionUid?: string;
}

export interface FlushResult {
  transformedText: string;
  segmentsProcessed: number;
  success: boolean;
  error?: string;
}
