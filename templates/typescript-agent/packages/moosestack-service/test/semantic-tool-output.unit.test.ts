import { type QueryModelBase, sql } from "@514labs/moose-lib";
import { describe, expect, it } from "vitest";

import { createSemanticToolSuccessResult } from "../app/mcp/tools/semantic-tool-output";

describe("semantic-tool-output", () => {
  it("returns structured content for metrics tools", () => {
    const model: QueryModelBase = {
      name: "query_tenant_knowledge_metrics",
      description: "Knowledge metrics",
      defaults: {
        metrics: ["totalRecords"],
        limit: 50,
      },
      filters: {},
      sortable: [],
      metrics: {
        totalRecords: {
          description: "Total records",
        },
      },
      columnNames: [],
      toSql: () => sql`SELECT 1 AS total_records`,
    };

    const result = createSemanticToolSuccessResult(
      "query_tenant_knowledge_metrics",
      "Query Tenant Knowledge Metrics",
      model,
      [{ category: "incident", totalRecords: 3 }],
    );

    expect(result.structuredContent).toEqual({
      toolName: "query_tenant_knowledge_metrics",
      title: "Query Tenant Knowledge Metrics",
      kind: "metrics",
      rowCount: 1,
      rows: [{ category: "incident", totalRecords: 3 }],
    });
    expect(result.content[0]?.text).toContain('"kind": "metrics"');
  });

  it("returns structured content for record tools", () => {
    const model: QueryModelBase = {
      name: "list_tenant_knowledge_records",
      description: "Knowledge records",
      defaults: {
        columns: ["headline"],
        limit: 5,
      },
      filters: {},
      sortable: [],
      columnNames: ["headline", "timestamp"],
      toSql: () => sql`SELECT 1 AS headline`,
    };

    const result = createSemanticToolSuccessResult(
      "list_tenant_knowledge_records",
      "List Tenant Knowledge Records",
      model,
      [{ headline: "Shipment delayed", timestamp: "2026-03-31T12:00:00Z" }],
    );

    expect(result.structuredContent.kind).toBe("records");
    expect(result.structuredContent.rowCount).toBe(1);
  });
});
