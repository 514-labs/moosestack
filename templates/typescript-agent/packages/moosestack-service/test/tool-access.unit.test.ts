import { describe, expect, it } from "vitest";

import {
  createToolAccessPolicy,
  type RuntimeTable,
} from "../app/apis/tool-access-core";

const mockTables = [
  {
    config: { engine: "ReplacingMergeTree" },
    generateTableName() {
      return "tenant_knowledge";
    },
    columnArray: [
      {
        name: "tenant_id",
        data_type: "String",
        required: true,
        annotations: [["LowCardinality", true]],
        comment: "Tenant partition key",
      },
      {
        name: "headline",
        data_type: "String",
        required: true,
        annotations: [],
        comment: null,
      },
      {
        name: "timestamp",
        data_type: "DateTime",
        required: true,
        annotations: [],
        comment: null,
      },
    ],
  },
] satisfies RuntimeTable[];

const {
  getExposedDataCatalog,
  formatExposedCatalogSummary,
  formatExposedCatalogDetailed,
  validateExposedReadonlyQuery,
} = createToolAccessPolicy(mockTables);

describe("tool-access", () => {
  it("returns only the allowlisted tenant tables in the catalog", () => {
    const { tables, materializedViews } = getExposedDataCatalog("tables");

    expect(materializedViews).toEqual([]);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe("tenant_knowledge");
    expect(tables[0]?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["tenant_id", "headline", "timestamp"]),
    );
  });

  it("formats summary and detailed catalog output", () => {
    const { tables, materializedViews } = getExposedDataCatalog(
      "tables",
      "knowledge",
    );

    expect(formatExposedCatalogSummary(tables, materializedViews)).toContain(
      "tenant_knowledge",
    );

    const detailedCatalog = JSON.parse(
      formatExposedCatalogDetailed(tables, materializedViews),
    ) as {
      tables: {
        tenant_knowledge: {
          columns: Array<{ name: string; type: string }>;
          name: string;
        };
      };
    };

    expect(detailedCatalog.tables.tenant_knowledge.name).toBe(
      "tenant_knowledge",
    );
    expect(detailedCatalog.tables.tenant_knowledge.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "tenant_id",
          type: "LowCardinality(String)",
        }),
      ]),
    );
  });

  it("allows read-only queries against exposed tables", () => {
    expect(
      validateExposedReadonlyQuery(
        "SELECT tenant_id, headline FROM tenant_knowledge LIMIT 10;",
      ),
    ).toBe("SELECT tenant_id, headline FROM tenant_knowledge LIMIT 10");

    expect(
      validateExposedReadonlyQuery("DESCRIBE TABLE tenant_knowledge"),
    ).toBe("DESCRIBE TABLE tenant_knowledge");

    expect(
      validateExposedReadonlyQuery(
        "EXPLAIN SELECT tenant_id FROM tenant_knowledge",
      ),
    ).toBe("EXPLAIN SELECT tenant_id FROM tenant_knowledge");
  });

  it("rejects system metadata and write queries", () => {
    expect(() =>
      validateExposedReadonlyQuery("SELECT name FROM system.tables"),
    ).toThrow(/System metadata is not exposed by default/);

    expect(() =>
      validateExposedReadonlyQuery("INSERT INTO tenant_knowledge VALUES ()"),
    ).toThrow(
      /Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed by default/,
    );
  });

  it("rejects undeclared tables", () => {
    expect(() =>
      validateExposedReadonlyQuery("SELECT headline FROM secret_table"),
    ).toThrow(/Available tables: tenant_knowledge/);
  });
});
