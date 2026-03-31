import { describe, expect, it } from "vitest";

import { formatSemanticToolError } from "../app/mcp/errors/semantic-tool-errors";

describe("semantic-tool-errors", () => {
  it("preserves safe semantic validation messages", () => {
    expect(
      formatSemanticToolError(
        new Error("Field 'unknownMetric' is not sortable"),
        "Query Tenant Knowledge Metrics",
      ),
    ).toBe("Field 'unknownMetric' is not sortable");
  });

  it("returns actionable guidance for invalid timestamp filters", () => {
    expect(
      formatSemanticToolError(
        new Error(
          "Cannot parse DateTime: while converting 'not-a-date' for query parameter 'p0'",
        ),
        "List Tenant Knowledge Records",
      ),
    ).toBe(
      "One of the timestamp filters is invalid. Use ISO-8601 date/time strings and try again.",
    );
  });

  it("returns schema drift guidance for storage/model mismatches", () => {
    expect(
      formatSemanticToolError(
        new Error("Unknown expression identifier 'priority_level'"),
        "Query Tenant Knowledge Metrics",
      ),
    ).toBe(
      "Query Tenant Knowledge Metrics is out of sync with the backing schema. Check the Moose service build/deployment or use get_data_catalog to inspect the exposed data surface.",
    );
  });

  it("returns backend availability guidance for temporary failures", () => {
    expect(
      formatSemanticToolError(
        new Error("socket hang up"),
        "List Tenant Knowledge Records",
      ),
    ).toBe(
      "List Tenant Knowledge Records is temporarily unavailable because the Moose service or ClickHouse backend is unreachable. Try again in a moment.",
    );
  });

  it("sanitizes unexpected failures", () => {
    expect(
      formatSemanticToolError(
        new Error("division by zero"),
        "Query Tenant Knowledge Metrics",
      ),
    ).toBe(
      "Unable to execute Query Tenant Knowledge Metrics right now. Try again, or inspect the Moose service logs for details.",
    );
  });
});
