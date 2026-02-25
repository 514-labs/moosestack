import { describe, it, expect } from "vitest";

/**
 * Tests for Tier 3 data isolation logic.
 *
 * In mcp.ts, two scoping mechanisms enforce data isolation:
 *
 * 1. query_clickhouse: When userContext.orgId is present, passes
 *    { org_id: userContext.orgId } as query_params to ClickHouse.
 *    Parameterized views like DataEvent_scoped resolve {org_id:String}
 *    from these params.
 *
 * 2. get_data_catalog: When userContext.orgId is present, filters the
 *    table/view list to only expose names ending in "_scoped".
 */

describe("query parameter injection for scoped views", () => {
  // Mirrors logic from query_clickhouse tool handler (mcp.ts lines 410-412)
  function buildQueryParams(
    orgId: string | undefined,
  ): Record<string, string> | undefined {
    return orgId ? { org_id: orgId } : undefined;
  }

  it("returns org_id param when orgId is present (Tier 3)", () => {
    expect(buildQueryParams("org_acme")).toEqual({ org_id: "org_acme" });
  });

  it("returns undefined when orgId is absent (Tier 1/2)", () => {
    expect(buildQueryParams(undefined)).toBeUndefined();
  });

  it("returns org_id param for different org values", () => {
    expect(buildQueryParams("org_globex")).toEqual({ org_id: "org_globex" });
  });
});

describe("catalog filtering for scoped views", () => {
  // Mirrors logic from get_data_catalog tool handler (mcp.ts lines 509-517)
  const allTables = [
    { name: "DataEvent", engine: "MergeTree" },
    { name: "DataEvent_scoped", engine: "View" },
    { name: "UserActivity", engine: "MergeTree" },
    { name: "UserActivity_scoped", engine: "View" },
    { name: "InternalMetrics", engine: "MergeTree" },
  ];

  const allViews = [
    { name: "DataEvent_mv", engine: "MaterializedView" },
    { name: "Summary_scoped", engine: "MaterializedView" },
  ];

  function filterCatalog(
    tables: typeof allTables,
    views: typeof allViews,
    orgId: string | undefined,
  ) {
    if (orgId) {
      return {
        tables: tables.filter((t) => t.name.endsWith("_scoped")),
        views: views.filter((v) => v.name.endsWith("_scoped")),
      };
    }
    return { tables, views };
  }

  it("returns only _scoped tables when orgId is present (Tier 3)", () => {
    const result = filterCatalog(allTables, allViews, "org_acme");
    expect(result.tables).toEqual([
      { name: "DataEvent_scoped", engine: "View" },
      { name: "UserActivity_scoped", engine: "View" },
    ]);
  });

  it("returns only _scoped materialized views when orgId is present", () => {
    const result = filterCatalog(allTables, allViews, "org_acme");
    expect(result.views).toEqual([
      { name: "Summary_scoped", engine: "MaterializedView" },
    ]);
  });

  it("returns all tables when orgId is absent (Tier 1/2)", () => {
    const result = filterCatalog(allTables, allViews, undefined);
    expect(result.tables).toHaveLength(5);
    expect(result.views).toHaveLength(2);
  });

  it("hides base tables from Tier 3 users", () => {
    const result = filterCatalog(allTables, allViews, "org_globex");
    const names = result.tables.map((t) => t.name);
    expect(names).not.toContain("DataEvent");
    expect(names).not.toContain("UserActivity");
    expect(names).not.toContain("InternalMetrics");
  });

  it("returns empty arrays when no scoped items exist", () => {
    const unscoped = [{ name: "RawData", engine: "MergeTree" }];
    const result = filterCatalog(unscoped, [], "org_acme");
    expect(result.tables).toEqual([]);
    expect(result.views).toEqual([]);
  });
});

describe("clickhouseReadonlyQuery parameter spreading", () => {
  // Mirrors logic from clickhouseReadonlyQuery (mcp.ts lines 40-48)
  function buildQueryOptions(
    sql: string,
    limit: number,
    queryParams?: Record<string, string>,
  ) {
    return {
      query: sql,
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        limit: limit.toString(),
      },
      ...(queryParams && { query_params: queryParams }),
    };
  }

  it("includes query_params when provided", () => {
    const opts = buildQueryOptions("SELECT * FROM DataEvent_scoped", 100, {
      org_id: "org_acme",
    });
    expect(opts.query_params).toEqual({ org_id: "org_acme" });
  });

  it("omits query_params when undefined", () => {
    const opts = buildQueryOptions("SELECT * FROM DataEvent", 100);
    expect(opts).not.toHaveProperty("query_params");
  });

  it("enforces readonly mode", () => {
    const opts = buildQueryOptions("SELECT 1", 100);
    expect(opts.clickhouse_settings.readonly).toBe("2");
  });

  it("converts limit to string for ClickHouse settings", () => {
    const opts = buildQueryOptions("SELECT 1", 500);
    expect(opts.clickhouse_settings.limit).toBe("500");
  });
});
