import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  GUIDE_STEPPER_CHECKPOINT_MARKER,
  GUIDE_TYPE_PROP,
} from "./remark-guide-stepper-markers";
import { parseGuideStepperStepChildren } from "./guide-stepper-step-children-parser";

describe("parseGuideStepperStepChildren", () => {
  it("treats conditional-wrapped checkpoints as workflow checkpoints", () => {
    const checkpoint = createElement(
      "div",
      {
        [GUIDE_TYPE_PROP]: GUIDE_STEPPER_CHECKPOINT_MARKER,
        id: "checkpoint-1",
        title: "Wrapped checkpoint",
        rawContent: "Run this command.",
      },
      "Run this command.",
    );
    const wrappedCheckpoint = createElement(
      "div",
      { whenId: "source-database", whenValue: "postgres" },
      checkpoint,
    );

    const parsed = parseGuideStepperStepChildren([wrappedCheckpoint]);

    expect(parsed.checkpoints).toHaveLength(1);
    expect(parsed.checkpoints[0]?.visibility).toEqual({
      whenId: "source-database",
      whenValue: "postgres",
      match: undefined,
      fallback: undefined,
    });
    expect(parsed.bodyChildren).toHaveLength(0);
  });
});
