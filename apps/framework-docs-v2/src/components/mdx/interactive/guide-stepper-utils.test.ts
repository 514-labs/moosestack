import { describe, expect, it } from "vitest";
import { createElement } from "react";
import {
  buildGuideStepPromptMarkdown,
  calculateProgress,
  getOpenStepIdsAfterCompletionToggle,
  getSanitizedOpenStepIds,
  getDefaultExpandedValues,
  isGuideStepperAtAGlanceElement,
  isGuideStepperCheckpointElement,
  isGuideStepperStepElement,
  sanitizeStepIds,
  sanitizeCompletedStepIds,
} from "./guide-stepper-utils";

describe("guide-stepper utils", () => {
  it("calculates progress counts and percentage", () => {
    expect(calculateProgress(["s1", "s2", "s3"], ["s1", "s3"])).toEqual({
      completed: 2,
      total: 3,
      percentage: 67,
    });
  });

  it("uses explicit default expanded values when provided", () => {
    expect(
      getDefaultExpandedValues({
        stepIds: ["s1", "s2", "s3"],
        completedStepIds: ["s1"],
        defaultExpanded: ["s3"],
      }),
    ).toEqual(["s3"]);
  });

  it("falls back to first incomplete step when explicit default has no valid IDs", () => {
    expect(
      getDefaultExpandedValues({
        stepIds: ["s1", "s2", "s3"],
        completedStepIds: ["s1"],
        defaultExpanded: ["unknown-step"],
      }),
    ).toEqual(["s2"]);
  });

  it("defaults to first incomplete step when defaultExpanded is omitted", () => {
    expect(
      getDefaultExpandedValues({
        stepIds: ["s1", "s2", "s3"],
        completedStepIds: ["s1"],
      }),
    ).toEqual(["s2"]);
  });

  it("falls back to first step when all steps are complete", () => {
    expect(
      getDefaultExpandedValues({
        stepIds: ["s1", "s2"],
        completedStepIds: ["s1", "s2"],
      }),
    ).toEqual(["s1"]);
  });

  it("sanitizes completion list by removing duplicates and unknown IDs", () => {
    expect(
      sanitizeCompletedStepIds(["s1", "s1", "x", "s3"], ["s1", "s2", "s3"]),
    ).toEqual(["s1", "s3"]);
  });

  it("sanitizes arbitrary step IDs while preserving order", () => {
    expect(
      sanitizeStepIds(
        ["phase-2", "phase-1", "phase-2", "unknown", "phase-3"],
        ["phase-1", "phase-2", "phase-3"],
      ),
    ).toEqual(["phase-2", "phase-1", "phase-3"]);
  });

  it("recognizes step elements by required props instead of component identity", () => {
    const node = createElement(
      "div",
      { id: "phase-1", number: 1, title: "Parity" },
      "content",
    );

    expect(isGuideStepperStepElement(node)).toBe(true);
  });

  it("recognizes checkpoint elements by required props", () => {
    const node = createElement(
      "div",
      { id: "checkpoint-1", title: "Prepare context" },
      "content",
    );

    expect(isGuideStepperCheckpointElement(node)).toBe(true);
  });

  it("does not classify non-step content as step/checkpoint", () => {
    const node = createElement("div", { title: "Callout title" });

    expect(isGuideStepperStepElement(node)).toBe(false);
    expect(isGuideStepperCheckpointElement(node)).toBe(false);
    expect(isGuideStepperAtAGlanceElement(node)).toBe(false);
  });

  it("recognizes at-a-glance blocks by rawContent prop", () => {
    const node = createElement(
      "div",
      { rawContent: "Attach these files first" },
      "Attach these files first",
    );

    expect(isGuideStepperAtAGlanceElement(node)).toBe(true);
  });

  it("recognizes at-a-glance blocks with custom title prop", () => {
    const node = createElement(
      "div",
      {
        title: "Before you run checkpoints",
        rawContent: "Attach these files first",
      },
      "Attach these files first",
    );

    expect(isGuideStepperAtAGlanceElement(node)).toBe(true);
  });

  it("collapses the matching open step when toggled complete", () => {
    expect(
      getOpenStepIdsAfterCompletionToggle(["phase-1", "phase-2"], {
        stepId: "phase-1",
        checked: true,
      }),
    ).toEqual(["phase-2"]);
  });

  it("does not auto-open steps when toggled back to incomplete", () => {
    expect(
      getOpenStepIdsAfterCompletionToggle(["phase-2"], {
        stepId: "phase-1",
        checked: false,
      }),
    ).toEqual(["phase-2"]);
  });

  it("sanitizes open step IDs against currently available steps", () => {
    expect(
      getSanitizedOpenStepIds(
        ["phase-1", "unknown", "phase-1"],
        ["phase-1", "phase-2"],
      ),
    ).toEqual(["phase-1"]);
  });

  it("builds prompt markdown by concatenating pre-checkpoint instructions and checkpoint content", () => {
    expect(
      buildGuideStepPromptMarkdown({
        atAGlanceRawContent:
          "Attach `context-map.md` before running checkpoints.",
        checkpointRawContents: [
          "### Checkpoint 1\n\nDo thing 1.",
          "### Checkpoint 2\n\nDo thing 2.",
        ],
      }),
    ).toBe(
      [
        "Attach `context-map.md` before running checkpoints.",
        "### Checkpoint 1\n\nDo thing 1.",
        "### Checkpoint 2\n\nDo thing 2.",
      ].join("\n\n"),
    );
  });
});
