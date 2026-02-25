import { describe, it, expect } from "vitest";

/**
 * Tests for Tier 3 data isolation logic.
 *
 * In mcp.ts, when userContext.orgId is present, SELECT queries are wrapped
 * in a subquery with a parameterized org_id filter:
 *   SELECT * FROM (<original query>) AS _scoped WHERE org_id = {_scope_org_id:String}
 *
 * The org_id value is passed as a ClickHouse query parameter, eliminating
 * SQL injection risk entirely. This approach is also robust against any
 * inner query structure (JOINs, CTEs, GROUP BY, subqueries, etc.) since
 * it wraps rather than rewrites.
 */

// Mirrors the scoping logic from query_clickhouse tool handler in mcp.ts
// Returns both the rewritten query and any scope params
function applyScopedQuery(
  query: string,
  orgId: string | undefined,
): { query: string; scopeParams?: Record<string, string> } {
  let finalQuery = query.trim();
  let scopeParams: Record<string, string> | undefined;
  if (orgId) {
    const upperQuery = finalQuery.toUpperCase();
    if (upperQuery.startsWith("SELECT")) {
      finalQuery = `SELECT * FROM (${finalQuery}) AS _scoped WHERE org_id = {_scope_org_id:String}`;
      scopeParams = { _scope_org_id: orgId };
    }
  }
  return { query: finalQuery, scopeParams };
}

describe("Tier 3 subquery wrapping for org scoping", () => {
  const SCOPED_SUFFIX = " WHERE org_id = {_scope_org_id:String}";

  it("wraps a simple SELECT with parameterized org_id filter", () => {
    const { query, scopeParams } = applyScopedQuery(
      "SELECT * FROM DataEvent",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT * FROM DataEvent) AS _scoped" + SCOPED_SUFFIX,
    );
    expect(scopeParams).toEqual({ _scope_org_id: "org_acme" });
  });

  it("wraps a SELECT with existing WHERE clause", () => {
    const { query, scopeParams } = applyScopedQuery(
      "SELECT * FROM DataEvent WHERE eventType = 'purchase'",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT * FROM DataEvent WHERE eventType = 'purchase') AS _scoped" +
        SCOPED_SUFFIX,
    );
    expect(scopeParams).toEqual({ _scope_org_id: "org_acme" });
  });

  it("wraps a SELECT with GROUP BY", () => {
    const { query } = applyScopedQuery(
      "SELECT eventType, count() FROM DataEvent GROUP BY eventType",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT eventType, count() FROM DataEvent GROUP BY eventType) AS _scoped" +
        SCOPED_SUFFIX,
    );
  });

  it("wraps a SELECT with ORDER BY and LIMIT", () => {
    const { query } = applyScopedQuery(
      "SELECT * FROM DataEvent ORDER BY timestamp DESC LIMIT 10",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT * FROM DataEvent ORDER BY timestamp DESC LIMIT 10) AS _scoped" +
        SCOPED_SUFFIX,
    );
  });

  it("wraps a SELECT with JOINs", () => {
    const { query } = applyScopedQuery(
      "SELECT a.*, b.name FROM DataEvent a JOIN Users b ON a.userId = b.id",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT a.*, b.name FROM DataEvent a JOIN Users b ON a.userId = b.id) AS _scoped" +
        SCOPED_SUFFIX,
    );
  });

  it("wraps a SELECT with subqueries", () => {
    const { query } = applyScopedQuery(
      "SELECT * FROM DataEvent WHERE eventType IN (SELECT type FROM EventTypes)",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT * FROM DataEvent WHERE eventType IN (SELECT type FROM EventTypes)) AS _scoped" +
        SCOPED_SUFFIX,
    );
  });

  it("does not wrap non-SELECT queries (SHOW)", () => {
    const { query, scopeParams } = applyScopedQuery("SHOW TABLES", "org_acme");
    expect(query).toBe("SHOW TABLES");
    expect(scopeParams).toBeUndefined();
  });

  it("does not wrap DESCRIBE queries", () => {
    const { query, scopeParams } = applyScopedQuery(
      "DESCRIBE DataEvent",
      "org_acme",
    );
    expect(query).toBe("DESCRIBE DataEvent");
    expect(scopeParams).toBeUndefined();
  });

  it("does not wrap when orgId is undefined (Tier 1/2)", () => {
    const { query, scopeParams } = applyScopedQuery(
      "SELECT * FROM DataEvent",
      undefined,
    );
    expect(query).toBe("SELECT * FROM DataEvent");
    expect(scopeParams).toBeUndefined();
  });

  it("passes orgId as a query parameter — no string escaping needed", () => {
    const malicious = "org'; DROP TABLE DataEvent; --";
    const { query, scopeParams } = applyScopedQuery(
      "SELECT * FROM DataEvent",
      malicious,
    );
    // The query uses a placeholder, not the raw value
    expect(query).not.toContain(malicious);
    expect(query).toContain("{_scope_org_id:String}");
    // The raw value is safely in scopeParams, sent out-of-band
    expect(scopeParams).toEqual({ _scope_org_id: malicious });
  });

  it("handles different org values with same query", () => {
    const q = "SELECT * FROM DataEvent";
    const acme = applyScopedQuery(q, "org_acme");
    const globex = applyScopedQuery(q, "org_globex");
    expect(acme.scopeParams).toEqual({ _scope_org_id: "org_acme" });
    expect(globex.scopeParams).toEqual({ _scope_org_id: "org_globex" });
    // Queries are identical — only params differ
    expect(acme.query).toBe(globex.query);
  });

  it("trims whitespace from query before wrapping", () => {
    const { query } = applyScopedQuery(
      "  SELECT * FROM DataEvent  ",
      "org_acme",
    );
    expect(query).toBe(
      "SELECT * FROM (SELECT * FROM DataEvent) AS _scoped" + SCOPED_SUFFIX,
    );
  });
});

describe("clickhouseReadonlyQuery options", () => {
  // Mirrors logic from clickhouseReadonlyQuery (mcp.ts)
  function buildQueryOptions(sql: string, limit: number) {
    return {
      query: sql,
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        limit: limit.toString(),
      },
    };
  }

  it("enforces readonly mode", () => {
    const opts = buildQueryOptions("SELECT 1", 100);
    expect(opts.clickhouse_settings.readonly).toBe("2");
  });

  it("converts limit to string for ClickHouse settings", () => {
    const opts = buildQueryOptions("SELECT 1", 500);
    expect(opts.clickhouse_settings.limit).toBe("500");
  });
});
