import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("VerticalProgressSteps", () => {
  it("centers numbered badges", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "vertical-progress-steps.tsx"),
      "utf8",
    );

    expect(source).toMatch(/<Badge[\s\S]*className="[^"]*justify-center[^"]*"/);
  });

  it("suppresses native list markers to avoid duplicate bullets", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "vertical-progress-steps.tsx"),
      "utf8",
    );

    expect(source).toMatch(/<ListTag className="[^"]*list-none[^"]*"/);
  });
});
