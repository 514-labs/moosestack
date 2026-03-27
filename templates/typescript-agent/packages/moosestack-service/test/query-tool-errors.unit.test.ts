import { describe, expect, it } from "vitest";

import { formatQueryToolError } from "../app/mcp/errors/query-tool-errors";

describe("query-tool-errors", () => {
  it("adds catalog guidance for allowlist failures", () => {
    const formatted = formatQueryToolError(
      new Error("Table 'secret_table' is not exposed by default."),
      ["tenant_knowledge"],
    );

    expect(formatted).toContain("Use get_data_catalog before writing queries.");
  });

  it("formats unknown-table errors with available table names", () => {
    const formatted = formatQueryToolError(
      new Error("Unknown table expression identifier 'missing_table'"),
      ["tenant_knowledge", "tenant_metrics"],
    );

    expect(formatted).toBe(
      "Table 'missing_table' not found. Available tables: tenant_knowledge, tenant_metrics. Use get_data_catalog before writing queries.",
    );
  });

  it("falls back to a generic execution message", () => {
    expect(formatQueryToolError(new Error("socket hang up"), [])).toBe(
      "Error executing query: socket hang up",
    );
  });
});
