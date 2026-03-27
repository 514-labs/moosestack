import { describe, expect, it, vi } from "vitest";

import { executeReadonlyStatement } from "../app/data/clickhouse/readonly-query";

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
        clickhouse_settings: expect.objectContaining({
          readonly: "2",
          max_result_rows: "100",
          result_overflow_mode: "break",
        }),
      }),
    );
    expect(querySpy.mock.calls[0]?.[0]?.clickhouse_settings).not.toHaveProperty(
      "limit",
    );
  });
});
