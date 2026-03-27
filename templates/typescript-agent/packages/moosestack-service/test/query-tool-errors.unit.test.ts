import { describe, expect, it } from "vitest";

import { formatQueryToolError } from "../app/mcp/errors/query-tool-errors";

describe("query-tool-errors", () => {
  it("adds catalog guidance for allowlist failures", () => {
    const formatted = formatQueryToolError(
      new Error(
        "Table 'secret_table' is not exposed by default. Update app/mcp/tool-access/exposed-surface.ts if you want to allow it.",
      ),
      ["tenant_knowledge"],
    );

    expect(formatted).toBe(
      "Table 'secret_table' is not exposed to this tool. Available tables: tenant_knowledge. Use get_data_catalog before writing queries.",
    );
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

  it("sanitizes generic execution failures", () => {
    expect(formatQueryToolError(new Error("socket hang up"), [])).toBe(
      "Unable to execute the query. Verify that it is a read-only statement against exposed tables and try again.",
    );
  });

  it("returns safe guidance for validation errors", () => {
    expect(
      formatQueryToolError(
        new Error(
          "Qualified table names are not allowed. Query exposed components without a database prefix.",
        ),
        [],
      ),
    ).toBe(
      "Qualified table names are not allowed. Query exposed tables without a database prefix.",
    );
  });
});
