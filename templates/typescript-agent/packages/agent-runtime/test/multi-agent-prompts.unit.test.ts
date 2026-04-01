import { describe, expect, it } from "vitest";

import { parseSpecialistSelection } from "../src/prompts/multi-agent";

describe("parseSpecialistSelection", () => {
  it("returns the single routed specialist label", () => {
    expect(parseSpecialistSelection("metrics-investigator")).toBe("metrics-investigator");
  });

  it("rejects ambiguous supervisor routes", () => {
    expect(() => parseSpecialistSelection("catalog-researcher then metrics-investigator")).toThrow(
      /ambiguous specialist route/i,
    );
  });
});
