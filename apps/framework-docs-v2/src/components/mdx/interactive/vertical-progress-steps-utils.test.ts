import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  getProgressStepsVariant,
  isVerticalProgressStepItemElement,
} from "./vertical-progress-steps-utils";

describe("vertical-progress-steps utils", () => {
  it("defaults to numbered variant", () => {
    expect(getProgressStepsVariant()).toBe("numbered");
  });

  it("accepts bulleted variant", () => {
    expect(getProgressStepsVariant("bulleted")).toBe("bulleted");
  });

  it("falls back to numbered for unsupported variants", () => {
    expect(getProgressStepsVariant("foo")).toBe("numbered");
  });

  it("recognizes progress-step item elements by title prop", () => {
    const node = createElement("div", {
      id: "checkpoint-1",
      title: "Collect context files",
      children: "content",
    });

    expect(isVerticalProgressStepItemElement(node)).toBe(true);
  });

  it("does not classify non-item content as progress-step item", () => {
    const node = createElement("div", { children: "content only" });

    expect(isVerticalProgressStepItemElement(node)).toBe(false);
  });
});
