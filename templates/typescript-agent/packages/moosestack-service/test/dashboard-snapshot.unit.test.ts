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

  it("builds dashboard reads from semantic models and preserves scoped readonly execution", async () => {
    const { getDashboardSnapshot } = await import(
      "../app/semantic/dashboard-snapshot"
    );
    const query = vi
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
      client: {
        query,
      },
      rowPolicyOptions: {
        role: "tenant_reader",
        clickhouse_settings: {
          SQL_moose_rls_org_id: "org_a",
        },
      },
    } as never);

    expect(snapshot.knowledgeMetrics).toEqual({
      totalRecords: 2,
      highPriorityRecords: 1,
    });
    expect(snapshot.recentKnowledge).toHaveLength(1);

    const metricsQuery = query.mock.calls[0]?.[0];
    expect(metricsQuery?.query).toContain("count(*)");
    expect(metricsQuery?.query).toContain("countIf(");
    expect(metricsQuery?.query).toContain("subtractDays(now(), 7)");
    expect(metricsQuery?.query_params).toEqual({ p0: 1 });
    expect(metricsQuery?.clickhouse_settings).toEqual(
      expect.objectContaining({
        SQL_moose_rls_org_id: "org_a",
        readonly: "2",
      }),
    );

    const recentKnowledgeQuery = query.mock.calls[1]?.[0];
    expect(recentKnowledgeQuery?.query).toContain("org_id");
    expect(recentKnowledgeQuery?.query).toContain("ORDER BY");
    expect(recentKnowledgeQuery?.query).toContain("LIMIT {p0:Int}");
    expect(recentKnowledgeQuery?.query_params).toEqual({ p0: 5 });
  });
});
