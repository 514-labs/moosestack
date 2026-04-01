import { describe, expect, it } from "vitest";

import {
  getMetricColumns,
  getSemanticToolDetails,
  getSemanticToolTitle,
  isSemanticToolName,
  parseSemanticToolPayload,
} from "../src/features/chat/renderers/tools/semantic-tool-payload";

describe("semantic-tool-payload", () => {
  it("parses structured semantic tool output", () => {
    const payload = parseSemanticToolPayload("query_tenant_knowledge_metrics", {
      structuredContent: {
        toolName: "query_tenant_knowledge_metrics",
        title: "Query Tenant Knowledge Metrics",
        kind: "metrics",
        rows: [{ category: "incident", totalRecords: 3 }],
        rowCount: 1,
      },
    });

    expect(payload).toEqual({
      toolName: "query_tenant_knowledge_metrics",
      title: "Query Tenant Knowledge Metrics",
      kind: "metrics",
      rows: [{ category: "incident", totalRecords: 3 }],
      rowCount: 1,
    });
  });

  it("falls back to text content JSON when structured content is absent", () => {
    const payload = parseSemanticToolPayload("list_tenant_knowledge_records", {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            rows: [{ headline: "Shipment delayed", priority: "high" }],
            rowCount: 1,
          }),
        },
      ],
    });

    expect(payload?.kind).toBe("records");
    expect(payload?.rows[0]?.headline).toBe("Shipment delayed");
  });

  it("recognizes semantic tool names and titles dynamically", () => {
    expect(isSemanticToolName("query_customer_health_rollups")).toBe(true);
    expect(isSemanticToolName("list_recent_support_cases")).toBe(true);
    expect(isSemanticToolName("get_data_catalog")).toBe(false);
    expect(getSemanticToolTitle("query_customer_health_rollups")).toBe(
      "Query Customer Health Rollups",
    );
    expect(getSemanticToolTitle("list_recent_support_cases")).toBe("List Recent Support Cases");
  });

  it("summarizes semantic tool parameters for the UI", () => {
    expect(
      getSemanticToolDetails("query_tenant_knowledge_metrics", {
        metrics: ["totalRecords", "highPriorityRecords"],
        dimensions: ["category"],
        priority_in: ["high", "medium"],
        timestamp_gte: "2026-03-01T00:00:00Z",
        limit: 25,
      }),
    ).toEqual([
      { label: "Metrics", value: "totalRecords, highPriorityRecords" },
      { label: "Group By", value: "category" },
      {
        label: "Filters",
        value: "priority in high, medium • timestamp >= 2026-03-01T00:00:00Z",
      },
      { label: "Limit", value: "25" },
    ]);
  });

  it("keeps metric columns in a stable domain order", () => {
    expect(
      getMetricColumns([
        { totalRecords: 3, category: "incident", source: "jira" },
        { totalRecords: 1, category: "ops", source: "slack" },
      ]),
    ).toEqual(["category", "source", "totalRecords"]);
  });
});
