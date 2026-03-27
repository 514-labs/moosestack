import { sql } from "@514labs/moose-lib";
import { describe, expect, it, vi } from "vitest";

import {
  executeReadonlySql,
  executeReadonlyStatement,
} from "../app/data/clickhouse/readonly-query";

describe("executeReadonlyStatement", () => {
  it("uses max_result_rows instead of the legacy limit setting", async () => {
    const querySpy = vi.fn(async () => {
      return {
        json: async () => [{ tenant_id: "acme" }],
      };
    });
    const queryClient = {
      client: {
        query: querySpy,
      },
      rowPolicyOptions: {
        role: "tenant_reader",
        clickhouse_settings: {
          readonly: "0",
          max_result_rows: "9999",
          result_overflow_mode: "throw",
          output_format_json_quote_64bit_integers: "0",
        },
      },
    };

    const rows = await executeReadonlyStatement<{ tenant_id: string }>(
      queryClient as never,
      "SELECT tenant_id FROM tenant_knowledge LIMIT 1",
      100,
    );

    expect(rows).toEqual([{ tenant_id: "acme" }]);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT tenant_id FROM tenant_knowledge LIMIT 1",
        role: "tenant_reader",
        clickhouse_settings: expect.objectContaining({
          readonly: "2",
          max_result_rows: "100",
          result_overflow_mode: "break",
          output_format_json_quote_64bit_integers: "0",
        }),
      }),
    );
    expect(querySpy.mock.calls[0]?.[0]?.clickhouse_settings).not.toHaveProperty(
      "limit",
    );
  });

  it("preserves full ISO timestamps for Date query parameters", async () => {
    const querySpy = vi.fn(async () => {
      return {
        json: async () => [],
      };
    });
    const queryClient = {
      client: {
        query: querySpy,
      },
    };
    const timestamp = new Date("2026-03-27T12:34:56.789-04:00");

    await executeReadonlySql(
      queryClient as never,
      sql`SELECT ${timestamp} AS observed_at`,
      25,
    );

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: {
          p0: timestamp.toISOString(),
        },
        clickhouse_settings: expect.objectContaining({
          readonly: "2",
          max_result_rows: "25",
        }),
      }),
    );
  });
});
