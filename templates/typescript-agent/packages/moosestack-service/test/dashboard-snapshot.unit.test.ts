import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/ingest/models", () => ({
  TenantKnowledgeTable: {
    kind: "OlapTable",
    config: {},
    generateTableName: () => "tenant_knowledge",
    columns: {
      org_id: { name: "org_id", annotations: [] },
      headline: { name: "headline", annotations: [] },
      category: { name: "category", annotations: [] },
      priority: { name: "priority", annotations: [] },
      source: { name: "source", annotations: [] },
      timestamp: { name: "timestamp", annotations: [] },
    },
  },
}));

describe("getDashboardSnapshot", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("formats dashboard metric time bounds as ClickHouse DateTime strings", async () => {
    const { getDashboardSnapshot } = await import("../app/semantic/dashboard-snapshot");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => [{ totalRecords: 2, highPriorityRecords: 1 }],
      })
      .mockResolvedValueOnce({
        json: async () => [
          {
            orgId: "org_a",
            headline: "Brake alerts increased by 14% this week",
            category: "operations",
            priority: "high",
            source: "seed",
            timestamp: "2026-03-31 12:00:00",
          },
        ],
      });

    const snapshot = await getDashboardSnapshot({
      execute,
    } as never);

    expect(snapshot.knowledgeMetrics).toEqual({
      totalRecords: 2,
      highPriorityRecords: 1,
    });
    expect(snapshot.recentKnowledge).toHaveLength(1);

    const metricsQuery = execute.mock.calls[0]?.[0];
    expect(metricsQuery?.strings.join("?")).toContain("toDateTime(");
    expect(metricsQuery?.values).toHaveLength(2);
    expect(metricsQuery?.values.every((value: unknown) => typeof value === "string")).toBe(true);
  });
});
