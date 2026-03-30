import { describe, expect, it } from "vitest";

import {
  getReasoningText,
  hasOutputError,
  isReasoningPart,
  isToolTimingEvent,
} from "../src/features/chat/types/message-parts";

describe("message-parts guards", () => {
  it("accepts only well-formed reasoning parts", () => {
    expect(
      isReasoningPart({
        type: "reasoning",
        details: [{ type: "text", text: "hello" }, { type: "redacted" }],
      }),
    ).toBe(true);

    expect(
      isReasoningPart({
        type: "reasoning",
        details: [{ type: 123 }],
      }),
    ).toBe(false);
  });

  it("rejects invalid tool timing payloads", () => {
    expect(
      isToolTimingEvent({
        type: "data-tool-timing",
        data: {
          duration: 42,
          stepNumber: 1,
          toolCallId: "call-1",
          toolName: "query_clickhouse",
        },
      }),
    ).toBe(true);

    expect(
      isToolTimingEvent({
        type: "data-tool-timing",
        data: {
          duration: Number.NaN,
          stepNumber: 1,
          toolCallId: "call-1",
          toolName: "query_clickhouse",
        },
      }),
    ).toBe(false);

    expect(
      isToolTimingEvent({
        type: "data-tool-timing",
        data: {
          duration: 10,
          stepNumber: -1,
          toolCallId: "call-1",
          toolName: "query_clickhouse",
        },
      }),
    ).toBe(false);
  });

  it("only reports output errors when isError is strictly true", () => {
    expect(hasOutputError({ isError: true, message: "boom" })).toBe(true);
    expect(hasOutputError({ isError: false, message: "ok" })).toBe(false);
  });

  it("normalizes reasoning text consistently for transcript and section renderers", () => {
    expect(
      getReasoningText({
        type: "reasoning",
        details: [
          { type: "text", text: "hello" },
          { type: "redacted" },
          { type: "text" },
        ],
      }),
    ).toBe("hello<redacted>");
  });
});
