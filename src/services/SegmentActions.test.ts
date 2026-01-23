import { describe, it, expect, beforeEach } from "bun:test";
import { ConfigurableActionsService } from "./ConfigurableActionsService";
import { SegmentManager } from "./SegmentManager";
import { TranscribedSegment } from "../types/SegmentTypes";
import { ActionHandler } from "../types/ActionTypes";
import { DEFAULT_ACTIONS } from "../config/DefaultActions";
import { v4 as uuidv4 } from "uuid";

// Mock dependencies
const mockTransformationService = {
  transformSegments: async (segments: any[]) => ({
    success: true,
    transformedText: segments.map((s) => s.text).join(" "),
    segmentsProcessed: segments.length,
  }),
  finalizeText: (text: string) => text,
} as any;

const mockTextInjectionService = {
  insertText: async () => {},
} as any;

const mockSelectedTextService = {
  getSelectedText: async () => "",
} as any;

describe("Segment Actions Integration", () => {
  let actionsService: ConfigurableActionsService;
  let segmentManager: SegmentManager;

  beforeEach(() => {
    actionsService = new ConfigurableActionsService();
    segmentManager = new SegmentManager(
      mockTransformationService,
      mockTextInjectionService,
      mockSelectedTextService,
      actionsService,
    );
    segmentManager.setAccumulatingMode(true);
  });

  const createSegment = (
    text: string,
    completed = true,
  ): TranscribedSegment => ({
    id: uuidv4(),
    type: "transcribed",
    text,
    completed,
    timestamp: Date.now(),
  });

  const runPipeline = async (texts: string[], actions: ActionHandler[]) => {
    actionsService.setActions(actions);

    for (const text of texts) {
      segmentManager.addTranscribedSegment(text, true);
    }

    const result = await segmentManager.transformAndInjectAllSegmentsInternal({
      skipTransformation: true, // Skip AI, rely on our actions
    });
    return result.transformedText;
  };

  it("should handle standard joining", async () => {
    const result = await runPipeline(["Hello.", "How are you?"], []);
    expect(result).toBe("Hello. How are you?");
  });

  it("should remove trailing ellipses and lowercase next segment", async () => {
    const result = await runPipeline(
      ["This is...", "A test."],
      DEFAULT_ACTIONS,
    );
    expect(result).toBe("this is a test.");
  });

  it("should lowercase short transcriptions without internal punctuation", async () => {
    const result = await runPipeline(["Big thanks."], DEFAULT_ACTIONS);
    expect(result).toBe("big thanks.");
  });

  it("should merge short segments ending with period", async () => {
    const actions: ActionHandler[] = [
      {
        id: "merge-short-sentences",
        name: "Merge Short Sentences",
        enabled: true,
        order: 1,
        matchPatterns: [
          {
            id: "p1",
            type: "regex",
            pattern: "^.{0,20}\\.$",
            caseSensitive: false,
          },
        ],
        handlers: [
          {
            id: "h2",
            type: "segmentAction",
            config: { action: "lowercaseFirstChar" },
            order: 1,
            conditions: {
              previousSegmentMatchPattern: "^.{0,20}\\.$",
            },
          },
          {
            id: "h1",
            type: "segmentAction",
            config: {
              action: "mergeWithPrevious",
              joiner: " ",
              trimPreviousPunctuation: true,
            },
            order: 2,
            conditions: {
              previousSegmentMatchPattern: "^.{0,20}\\.$",
            },
          },
        ],
      },
    ];

    const result = await runPipeline(
      ["This is a.", "Test of whisper."],
      actions,
    );
    expect(result).toBe("This is a test of whisper.");
  });

  it("should not merge if punctuation is not period", async () => {
    const actions: ActionHandler[] = [
      {
        id: "merge-short-sentences",
        name: "Merge Short Sentences",
        enabled: true,
        order: 1,
        matchPatterns: [
          {
            id: "p1",
            type: "regex",
            pattern: "^.{0,20}\\.$",
            caseSensitive: false,
          },
        ],
        handlers: [
          {
            id: "h1",
            type: "segmentAction",
            config: {
              action: "mergeWithPrevious",
              joiner: " ",
              trimPreviousPunctuation: true,
            },
            order: 1,
            conditions: {
              previousSegmentMatchPattern: "^.{0,20}\\.$",
            },
          },
        ],
      },
    ];

    const result = await runPipeline(["Yay!", "Exciting!"], actions);
    expect(result).toBe("Yay! Exciting!");
  });

  it("should fix URLs", async () => {
    const result = await runPipeline(
      ["https/github.com/explosion-scratch"],
      DEFAULT_ACTIONS,
    );
    expect(result).toBe("https://github.com/explosion-scratch");
  });

  it("should handle question mark replacement and merge", async () => {
    const result = await runPipeline(
      ["Is this us.", "Question mark."],
      DEFAULT_ACTIONS,
    );
    expect(result).toBe("Is this us?");
  });

  it("should keep internal punctuation and single segment", async () => {
    const result = await runPipeline(["Hello world, this is a test."], []);
    expect(result).toBe("Hello world, this is a test.");
  });

  it("should merge single word segments ending with period", async () => {
    const result = await runPipeline(
      ["Hello.", "World.", "This is a test."],
      DEFAULT_ACTIONS,
    );
    // Note: "Hello." gets lowercased by "Smart Lowercase Short" global action before merging
    expect(result).toBe("hello world. This is a test.");
  });

  it("should stop on success when configured", async () => {
    const actions: ActionHandler[] = [
      {
        id: "stop-action",
        name: "Stop Action",
        enabled: true,
        order: 1,
        matchPatterns: [
          {
            id: "p1",
            type: "regex",
            pattern: "test",
            caseSensitive: false,
          },
        ],
        handlers: [
          {
            id: "h1",
            type: "segmentAction",
            config: { action: "replace", replacementText: "stopped" },
            order: 1,
            stopOnSuccess: true,
          },
          {
            id: "h2",
            type: "segmentAction",
            config: { action: "replace", replacementText: "failed" },
            order: 2,
          },
        ],
      },
    ];

    const result = await runPipeline(["test"], actions);
    expect(result).toBe("stopped");
  });
});
