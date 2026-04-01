import { describe, expect, it } from "vitest";

import { formatCatalogToolError } from "../app/mcp/errors/catalog-tool-errors";

describe("catalog-tool-errors", () => {
  it("preserves safe validation messages", () => {
    expect(
      formatCatalogToolError(
        new Error("Invalid component_type: widgets. Allowed values: tables, materialized_views."),
      ),
    ).toBe("Invalid component_type: widgets. Allowed values: tables, materialized_views.");
  });

  it("sanitizes unexpected failures", () => {
    expect(formatCatalogToolError(new Error("socket hang up"))).toBe(
      "Unable to retrieve the data catalog right now. Try again in a moment.",
    );
  });
});
