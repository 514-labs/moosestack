import { describe, expect, it } from "vitest";

import { extractJsonRowsFromOutput, stripAnsiSequences } from "../scripts/seed-output.mjs";

describe("seed output parsing", () => {
  it("strips ANSI escape sequences from CLI output", () => {
    expect(stripAnsiSequences("\u001b[32mhello\u001b[0m")).toBe("hello");
  });

  it("extracts JSON rows and ignores bracketed log lines that are not JSON", () => {
    const output = [
      '\u001b[32m{"org_id":"org_a","total":2}\u001b[0m',
      "[INFO] warming query cache",
      '[{"org_id":"org_b","total":3}]',
      "plain text log line",
    ].join("\n");

    expect(extractJsonRowsFromOutput(output)).toEqual([
      { org_id: "org_a", total: 2 },
      { org_id: "org_b", total: 3 },
    ]);
  });
});
