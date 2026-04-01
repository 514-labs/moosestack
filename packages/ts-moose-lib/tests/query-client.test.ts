import { expect } from "chai";
import { QueryClient } from "../src/consumption-apis/query-client";

describe("QueryClient", () => {
  it("preserves row policy options when enabling readonly mode", () => {
    const client = {
      query: async () => {
        return {
          json: async () => [],
        };
      },
    } as never;

    const scopedClient = new QueryClient(
      client,
      "test-prefix",
      {
        role: "moose_rls_role",
        clickhouse_settings: {
          SQL_moose_rls_org_id: "org_a",
        },
      },
      false,
    );

    const readonlyClient = scopedClient.withReadonly();

    expect(readonlyClient).to.not.equal(scopedClient);
    expect(
      (readonlyClient as unknown as { rowPolicyOptions?: unknown })
        .rowPolicyOptions,
    ).to.deep.equal({
      role: "moose_rls_role",
      clickhouse_settings: {
        SQL_moose_rls_org_id: "org_a",
      },
    });
    expect(
      (readonlyClient as unknown as { readonlyMode?: unknown }).readonlyMode,
    ).to.equal(true);
  });

  it("returns the same instance when readonly mode is already enabled", () => {
    const client = {
      query: async () => {
        return {
          json: async () => [],
        };
      },
    } as never;

    const readonlyClient = new QueryClient(
      client,
      "test-prefix",
      undefined,
      true,
    );

    expect(readonlyClient.withReadonly()).to.equal(readonlyClient);
  });
});
