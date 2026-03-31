import { type QueryModelBase, sql } from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { registerSemanticModelTools } from "../app/mcp/tools/register-semantic-model-tools";

describe("registerSemanticModelTools", () => {
  it("returns structured content for semantic tool results", async () => {
    const handlers: Record<
      string,
      (params: Record<string, unknown>) => Promise<unknown>
    > = {};
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: unknown,
          _metadata: unknown,
          handler: (params: Record<string, unknown>) => Promise<unknown>,
        ) => {
          handlers[name] = handler;
        },
      ),
    } as unknown as McpServer;

    const queryClient = {
      client: {
        query: vi.fn(async () => ({
          json: async () => [{ category: "incident", totalRecords: 3 }],
        })),
      },
    };
    const fakeModel: QueryModelBase = {
      name: "query_test_metrics",
      description: "Test semantic metrics tool",
      defaults: {
        metrics: ["totalRecords"],
        limit: 25,
      },
      filters: {},
      sortable: [],
      metrics: {
        totalRecords: {
          description: "Total rows",
        },
      },
      columnNames: [],
      toSql: () => sql`SELECT 1 AS total_records`,
    };

    registerSemanticModelTools(server, [fakeModel], {
      queryClient: queryClient as never,
      rowPolicyOptions: {
        clickhouse_settings: {
          readonly: "1",
        },
      },
    });

    const result = (await handlers.query_test_metrics?.({
      metrics: ["totalRecords"],
    })) as {
      content: Array<{ text: string }>;
      structuredContent?: {
        kind: string;
        rowCount: number;
        rows: Array<Record<string, unknown>>;
      };
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      toolName: "query_test_metrics",
      title: "Query Test Metrics",
      kind: "metrics",
      rowCount: 1,
      rows: [{ category: "incident", totalRecords: 3 }],
    });
    expect(result.content[0]?.text).toContain('"rowCount": 1');
  });

  it("returns sanitized backend errors for semantic tools", async () => {
    const handlers: Record<
      string,
      (params: Record<string, unknown>) => Promise<unknown>
    > = {};
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: unknown,
          _metadata: unknown,
          handler: (params: Record<string, unknown>) => Promise<unknown>,
        ) => {
          handlers[name] = handler;
        },
      ),
    } as unknown as McpServer;

    const queryClient = {
      client: {
        query: vi.fn(async () => {
          throw new Error("socket hang up");
        }),
      },
    };
    const fakeModel: QueryModelBase = {
      name: "query_test_metrics",
      description: "Test semantic metrics tool",
      defaults: {
        metrics: ["totalRecords"],
        limit: 25,
      },
      filters: {},
      sortable: [],
      metrics: {
        totalRecords: {
          description: "Total rows",
        },
      },
      columnNames: [],
      toSql: () => sql`SELECT 1 AS total_records`,
    };

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    registerSemanticModelTools(server, [fakeModel], {
      queryClient: queryClient as never,
      rowPolicyOptions: {
        clickhouse_settings: {
          readonly: "1",
        },
      },
    });

    const result = (await handlers.query_test_metrics?.({
      metrics: ["totalRecords"],
    })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Query Test Metrics is temporarily unavailable because the Moose service or ClickHouse backend is unreachable. Try again in a moment.",
    );
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("falls back to the model default limit when params.limit is NaN", async () => {
    const handlers: Record<
      string,
      (params: Record<string, unknown>) => Promise<unknown>
    > = {};
    const querySpy = vi.fn(async () => ({
      json: async () => [{ category: "incident", totalRecords: 3 }],
    }));
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: unknown,
          _metadata: unknown,
          handler: (params: Record<string, unknown>) => Promise<unknown>,
        ) => {
          handlers[name] = handler;
        },
      ),
    } as unknown as McpServer;

    const queryClient = {
      client: {
        query: querySpy,
      },
    };
    const fakeModel: QueryModelBase = {
      name: "query_test_metrics",
      description: "Test semantic metrics tool",
      defaults: {
        metrics: ["totalRecords"],
        limit: 25,
      },
      filters: {},
      sortable: [],
      metrics: {
        totalRecords: {
          description: "Total rows",
        },
      },
      columnNames: [],
      toSql: () => sql`SELECT 1 AS total_records`,
    };

    registerSemanticModelTools(server, [fakeModel], {
      queryClient: queryClient as never,
      rowPolicyOptions: {
        clickhouse_settings: {
          readonly: "1",
        },
      },
    });

    await handlers.query_test_metrics?.({
      metrics: ["totalRecords"],
      limit: Number.NaN,
    });

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT 1 AS total_records",
        clickhouse_settings: expect.objectContaining({
          max_result_rows: "25",
          readonly: "2",
          result_overflow_mode: "break",
        }),
      }),
    );
  });
});
