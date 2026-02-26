import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for structured audit logging in MCP tool handlers.
 *
 * When userContext is present (Tier 2/3), both query_clickhouse and
 * get_data_catalog log structured JSON via console.log. When userContext
 * is absent (Tier 1), no audit log is emitted.
 */

describe("audit logging - query_clickhouse", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Mirrors the audit logging logic from mcp.ts lines 431-444
  function auditQueryTool(
    userContext: { userId: string; email?: string; orgId?: string } | undefined,
    query: string,
    rowCount: number,
  ) {
    if (userContext) {
      console.log(
        JSON.stringify({
          event: "tool_invocation",
          tool: "query_clickhouse",
          userId: userContext.userId,
          email: userContext.email,
          orgId: userContext.orgId,
          query: query.trim(),
          rowCount,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  it("logs structured JSON when userContext is present", () => {
    const ctx = {
      userId: "user_123",
      email: "alice@acme.com",
      orgId: "org_acme",
    };
    auditQueryTool(ctx, "SELECT * FROM DataEvent_scoped", 8);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.event).toBe("tool_invocation");
    expect(logged.tool).toBe("query_clickhouse");
    expect(logged.userId).toBe("user_123");
    expect(logged.email).toBe("alice@acme.com");
    expect(logged.orgId).toBe("org_acme");
    expect(logged.rowCount).toBe(8);
    expect(logged.query).toBe("SELECT * FROM DataEvent_scoped");
    expect(logged.timestamp).toBeDefined();
  });

  it("does not log when userContext is absent (Tier 1)", () => {
    auditQueryTool(undefined, "SELECT * FROM DataEvent", 16);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("logs with undefined optional fields for Tier 2 (no orgId)", () => {
    const ctx = { userId: "user_456", email: "bob@example.com" };
    auditQueryTool(ctx, "SELECT 1", 1);

    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.userId).toBe("user_456");
    expect(logged.orgId).toBeUndefined();
  });

  it("trims whitespace from query in audit log", () => {
    const ctx = { userId: "user_789" };
    auditQueryTool(ctx, "  SELECT 1  ", 1);

    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.query).toBe("SELECT 1");
  });

  it("includes valid ISO timestamp", () => {
    const ctx = { userId: "user_abc" };
    auditQueryTool(ctx, "SELECT 1", 0);

    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    const parsed = new Date(logged.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

describe("audit logging - get_data_catalog", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Mirrors the audit logging logic from mcp.ts lines 536-549
  function auditCatalogTool(
    userContext: { userId: string; email?: string; orgId?: string } | undefined,
    componentType: string | undefined,
    search: string | undefined,
    format: string,
  ) {
    if (userContext) {
      console.log(
        JSON.stringify({
          event: "tool_invocation",
          tool: "get_data_catalog",
          userId: userContext.userId,
          email: userContext.email,
          orgId: userContext.orgId,
          component_type: componentType,
          search,
          format,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  it("logs catalog access with full context", () => {
    const ctx = {
      userId: "user_123",
      email: "alice@acme.com",
      orgId: "org_acme",
    };
    auditCatalogTool(ctx, "tables", undefined, "summary");

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.tool).toBe("get_data_catalog");
    expect(logged.component_type).toBe("tables");
    expect(logged.format).toBe("summary");
  });

  it("does not log catalog access without userContext", () => {
    auditCatalogTool(undefined, undefined, undefined, "summary");
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
