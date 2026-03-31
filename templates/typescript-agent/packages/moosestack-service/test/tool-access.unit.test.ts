import { describe, expect, it } from "vitest";

import {
  createToolAccessPolicy,
  type RuntimeTable,
} from "../app/mcp/tool-access/policy";

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

  it("allows EXISTS subqueries against exposed tables", () => {
    expect(
      validateExposedReadonlyQuery(
        "SELECT EXISTS(SELECT 1 FROM tenant_knowledge WHERE tenant_id = 'acme')",
      ),
    ).toBe(
      "SELECT EXISTS(SELECT 1 FROM tenant_knowledge WHERE tenant_id = 'acme')",
    );
  });

  it("ignores SQL-looking text inside string literals", () => {
    expect(
      validateExposedReadonlyQuery(
        "SELECT headline FROM tenant_knowledge WHERE headline = 'system.tables JOIN secret_table'",
      ),
    ).toBe(
      "SELECT headline FROM tenant_knowledge WHERE headline = 'system.tables JOIN secret_table'",
    );
  });

  it("rejects qualified table names", () => {
    expect(() =>
      validateExposedReadonlyQuery(
        "SELECT headline FROM other_db.tenant_knowledge",
      ),
    ).toThrow(/Qualified table names are not allowed/);
  });

  it("rejects comma-separated FROM lists", () => {
    expect(() =>
      validateExposedReadonlyQuery(
        "SELECT * FROM tenant_knowledge AS tk, tenant_knowledge AS other_tk",
      ),
    ).toThrow(/Comma-separated FROM and JOIN target lists are not allowed/);
  });

  it("rejects joined tables that are not exposed", () => {
    expect(() =>
      validateExposedReadonlyQuery(
        "SELECT * FROM tenant_knowledge AS tk JOIN secret_table AS s ON s.tenant_id = tk.tenant_id",
      ),
    ).toThrow(/Available tables: tenant_knowledge/);
  });

  it("rejects bare JOIN targets that are not exposed", () => {
    expect(() =>
      validateExposedReadonlyQuery(
        "SELECT * FROM tenant_knowledge JOIN secret_table ON secret_table.tenant_id = tenant_knowledge.tenant_id",
      ),
    ).toThrow(/Available tables: tenant_knowledge/);
  });

  it("allows ARRAY JOIN without treating the joined array as a table reference", () => {
    expect(
      validateExposedReadonlyQuery(
        "SELECT tenant_id, tag FROM tenant_knowledge ARRAY JOIN tags AS tag",
      ),
    ).toBe(
      "SELECT tenant_id, tag FROM tenant_knowledge ARRAY JOIN tags AS tag",
    );
  });

  it("falls back safely for oversized search patterns", () => {
    expect(() =>
      getExposedDataCatalog("tables", "(a+)+$".repeat(200)),
    ).not.toThrow();
  });

  it("falls back safely for suspicious regex features in catalog search", () => {
    expect(() =>
      getExposedDataCatalog("tables", "(?=tenant_knowledge)tenant_knowledge"),
    ).not.toThrow();
    expect(
      getExposedDataCatalog("tables", "(?=tenant_knowledge)tenant_knowledge")
        .tables,
    ).toEqual([]);
  });
});
