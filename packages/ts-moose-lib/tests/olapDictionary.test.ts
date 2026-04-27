/**
 * Unit tests for OlapDictionary TypeScript SDK.
 */
import { expect } from "chai";
import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";
import { OlapTable } from "../src/dmv2/sdk/olapTable";
import {
  OlapDictionary,
  OlapDictionaryConfig,
  COMPLEX_KEY_LAYOUTS,
} from "../src/dmv2/sdk/olapDictionary";
import { getOlapDictionaries, getOlapDictionary } from "../src/dmv2/registry";
import { LifeCycle } from "../src/dmv2/sdk/lifeCycle";
import { sql } from "../src/sqlHelpers";
import { ClickHouseInt } from "../src/dataModels/types";

// ─── Test interfaces ──────────────────────────────────────────────────────────

interface ProductLookup {
  ProductId: string;
  ProductName: string;
  Category: string;
  PriceLevel: number & ClickHouseInt<"int32">;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Clear all registry maps before each test to avoid cross-test pollution */
function clearRegistry() {
  const registry = getMooseInternal();
  registry.tables.clear();
  registry.olapDictionaries.clear();
}

/** Create a minimal OlapTable for use as a source */
function makeSourceTable(): OlapTable<ProductLookup> {
  return new OlapTable<ProductLookup>("Products", {
    orderByFields: ["ProductId"],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OlapDictionary", () => {
  beforeEach(clearRegistry);

  // ── Construction and defaults ────────────────────────────────────────────

  describe("construction", () => {
    it("should create a dictionary with sourceTable and register it", () => {
      const source = makeSourceTable();

      const dict = new OlapDictionary<ProductLookup>("dict_products", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(dict.name).to.equal("dict_products");
      expect(dict.kind).to.equal("OlapDictionary");
      expect(getMooseInternal().olapDictionaries.get("dict_products")).to.equal(
        dict,
      );
    });

    it("should leave lifeCycle undefined when not specified (Rust applies FullyManaged default)", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_lc", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "FLAT" },
        lifetime: 0,
      });

      expect(dict.config.lifeCycle).to.be.undefined;
    });

    it("should preserve explicit lifeCycle setting", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_lc2", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      });

      expect(dict.config.lifeCycle).to.equal(LifeCycle.DELETION_PROTECTED);
    });

    it("should create a dictionary with sourceQuery + sourceTables", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_query", {
        sourceQuery: sql`SELECT ProductId, ProductName, Category, PriceLevel FROM ${source}`,
        sourceTables: [source],
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(dict.name).to.equal("dict_query");
      expect(getMooseInternal().olapDictionaries.has("dict_query")).to.be.true;
    });

    it("should create a dictionary with externalSource (http)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_http", {
        externalSource: {
          type: "http",
          url: "https://api.example.com/products",
          format: "JSONEachRow",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(dict.name).to.equal("dict_http");
      expect(getMooseInternal().olapDictionaries.has("dict_http")).to.be.true;
    });

    it("should create a dictionary with externalSource (clickhouse)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_ch", {
        externalSource: {
          type: "clickhouse",
          host: "remote.example.com",
          port: 9000,
          user: "default",
          password: "secret",
          db: "mydb",
          table: "products",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_ch")).to.be.true;
    });

    it("should create a dictionary with externalSource (mysql)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_mysql", {
        externalSource: {
          type: "mysql",
          host: "mysql.example.com",
          port: 3306,
          user: "root",
          password: "pass",
          db: "shop",
          table: "products",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_mysql")).to.be.true;
    });

    it("should create a dictionary with externalSource (postgresql)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_pg", {
        externalSource: {
          type: "postgresql",
          host: "pg.example.com",
          port: 5432,
          user: "postgres",
          password: "pass",
          db: "shop",
          table: "products",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_pg")).to.be.true;
    });

    it("should create a dictionary with externalSource (redis)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_redis", {
        externalSource: {
          type: "redis",
          host: "redis.example.com",
          port: 6379,
          storageType: "simple",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_redis")).to.be.true;
    });

    it("should create a dictionary with externalSource (mongodb)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_mongo", {
        externalSource: {
          type: "mongodb",
          host: "mongo.example.com",
          port: 27017,
          user: "admin",
          password: "pass",
          db: "shop",
          collection: "products",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_mongo")).to.be.true;
    });

    it("should create a dictionary with externalSource (executable)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_exec", {
        externalSource: {
          type: "executable",
          command: "/usr/local/bin/dict-loader",
          format: "TabSeparated",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_exec")).to.be.true;
    });

    it("should create a dictionary with externalSource (s3)", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_s3", {
        externalSource: {
          type: "s3",
          url: "s3://my-bucket/products.csv",
          format: "CSV",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      expect(getMooseInternal().olapDictionaries.has("dict_s3")).to.be.true;
    });

    it("should set columns from compiler-injected schema", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_cols", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(dict.serializedColumns).to.be.an("array");
      expect(dict.serializedColumns.length).to.be.greaterThan(0);
      const nameCol = dict.serializedColumns.find(
        (c) => c.name === "ProductName",
      );
      expect(nameCol).to.exist;
      expect(nameCol!.typeString).to.be.a("string");
    });

    it("should merge per-column attribute overrides", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_attrs", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        columns: {
          ProductName: { defaultValue: "'Unknown'" },
          PriceLevel: { isInjective: true },
        },
      });

      const nameCol = dict.serializedColumns.find(
        (c) => c.name === "ProductName",
      );
      const priceCol = dict.serializedColumns.find(
        (c) => c.name === "PriceLevel",
      );
      expect(nameCol?.defaultValue).to.equal("'Unknown'");
      expect(priceCol?.isInjective).to.equal(true);
    });
  });

  // ── Validation ───────────────────────────────────────────────────────────

  describe("validation", () => {
    it("should throw when no source is provided", () => {
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_nosrc", {
          primaryKey: ["ProductId"],
          layout: { type: "HASHED" },
          lifetime: 3600,
        } as any);
      }).to.throw("exactly one of sourceTable, sourceQuery, or externalSource");
    });

    it("should throw when multiple sources are provided", () => {
      const source = makeSourceTable();
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_multi", {
          sourceTable: source,
          externalSource: {
            type: "http",
            url: "http://example.com",
            format: "CSV",
          },
          primaryKey: ["ProductId"],
          layout: { type: "HASHED" },
          lifetime: 3600,
        });
      }).to.throw("exactly one of sourceTable, sourceQuery, or externalSource");
    });

    it("should throw when sourceQuery is set but sourceTables is missing", () => {
      const source = makeSourceTable();
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_noref", {
          sourceQuery: sql`SELECT * FROM ${source}`,
          // sourceTables NOT set
          primaryKey: ["ProductId"],
          layout: { type: "HASHED" },
          lifetime: 3600,
        });
      }).to.throw("sourceTables");
    });

    it("should throw when sourceQuery is blank", () => {
      const source = makeSourceTable();
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_blankq", {
          sourceQuery: sql``,
          sourceTables: [source],
          primaryKey: ["ProductId"],
          layout: { type: "HASHED" },
          lifetime: 3600,
        });
      }).to.throw("sourceQuery must not be blank");
    });

    it("should throw when primaryKey is empty", () => {
      const source = makeSourceTable();
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_nopk", {
          sourceTable: source,
          primaryKey: [],
          layout: { type: "HASHED" },
          lifetime: 3600,
        });
      }).to.throw("primaryKey must contain at least one column");
    });

    it("should throw when simple layout has more than 1 primary key", () => {
      const source = makeSourceTable();
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_pk_multi", {
          sourceTable: source,
          primaryKey: ["ProductId", "Category"],
          layout: { type: "HASHED" },
          lifetime: 3600,
        });
      }).to.throw("requires exactly 1 primary key column");
    });

    it("should throw when COMPLEX_KEY layout has only 1 primary key", () => {
      const source = makeSourceTable();
      expect(() => {
        new OlapDictionary<ProductLookup>("dict_ck_single", {
          sourceTable: source,
          primaryKey: ["ProductId"],
          layout: { type: "COMPLEX_KEY_HASHED" },
          lifetime: 3600,
        });
      }).to.throw("requires at least 2 primary key columns");
    });

    it("should throw when registering a duplicate name", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_dup", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(() => {
        new OlapDictionary<ProductLookup>("dict_dup", {
          sourceTable: source,
          primaryKey: ["ProductId"],
          layout: { type: "FLAT" },
          lifetime: 0,
        });
      }).to.throw("already exists");
    });
  });

  // ── Serialization ─────────────────────────────────────────────────────────

  describe("serialization", () => {
    it("should serialize TABLE source to Rust-compatible JSON shape", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_serial", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const json = dict.toJson();
      expect(json.name).to.equal("dict_serial");
      expect(json.source).to.include({
        type: "TABLE",
        table: "Products",
      });
      expect(json.primaryKey).to.deep.equal(["ProductId"]);
      expect(json.layout).to.deep.equal({ type: "HASHED" });
      expect(json.lifetime).to.deep.equal({ type: "SINGLE", seconds: 3600 });
    });

    it("should serialize static lifetime (0) correctly", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_static", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "FLAT" },
        lifetime: 0,
      });

      const json = dict.toJson();
      expect(json.lifetime).to.deep.equal({ type: "STATIC" });
    });

    it("should serialize range lifetime correctly", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_range_lt", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: { min: 300, max: 360 },
      });

      const json = dict.toJson();
      expect(json.lifetime).to.deep.equal({
        type: "RANGE",
        min: 300,
        max: 360,
      });
    });

    it("should include lifeCycle in JSON as the enum string value", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_lc_json", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      });

      const json = dict.toJson();
      expect(json.lifeCycle).to.equal(LifeCycle.DELETION_PROTECTED);
    });

    it("should include optional fields when set", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_opts", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        database: "mydb",
        clusterName: "mycluster",
        invalidateQuery: "SELECT max(updated_at) FROM Products",
        comment: "Product lookup dictionary",
        settings: { max_execution_time: "30" },
      });

      const json = dict.toJson();
      expect(json.database).to.equal("mydb");
      expect(json.clusterName).to.equal("mycluster");
      expect(json.invalidateQuery).to.equal(
        "SELECT max(updated_at) FROM Products",
      );
      // invalidateQuery must also be threaded into the source object so that
      // Rust DDL generation can emit INVALIDATE_QUERY inside SOURCE(CLICKHOUSE(...))
      expect((json.source as any).invalidateQuery).to.equal(
        "SELECT max(updated_at) FROM Products",
      );
      expect(json.comment).to.equal("Product lookup dictionary");
      expect(json.settings).to.deep.equal({ max_execution_time: "30" });
    });

    it("should thread invalidateQuery into QUERY source object", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_query_inv", {
        sourceQuery: sql`SELECT ProductId, ProductName FROM ${source}`,
        sourceTables: [source],
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        invalidateQuery: "SELECT max(updated_at) FROM source",
      });

      const json = dict.toJson();
      expect(json.invalidateQuery).to.equal(
        "SELECT max(updated_at) FROM source",
      );
      expect((json.source as any).invalidateQuery).to.equal(
        "SELECT max(updated_at) FROM source",
      );
    });

    it("should serialize EXTERNAL source with nested externalSource key", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_ext_json", {
        externalSource: {
          type: "http",
          url: "https://api.example.com/products",
          format: "JSONEachRow",
          method: "GET",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const json = dict.toJson();
      const source = json.source as any;
      expect(source.type).to.equal("EXTERNAL");
      expect(source.externalSource).to.exist;
      expect(source.externalSource.source_type).to.equal("HTTP");
      expect(source.externalSource.url).to.equal(
        "https://api.example.com/products",
      );
      expect(source.externalSource.format).to.equal("JSONEachRow");
    });

    // Regression: ExternalDictionarySource uses #[serde(tag = "source_type")] in Rust,
    // so the inner discriminant key must be "source_type", not "type".
    // Before the fix, serializeExternalSource() emitted { type: "HTTP" } which would
    // cause Rust deserialization of all external-source dictionaries to fail.
    it("EXTERNAL source inner discriminant must use key 'source_type' not 'type'", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_ext_discriminant", {
        externalSource: {
          type: "http",
          url: "https://api.example.com/data",
          format: "JSONEachRow",
          method: "GET",
        },
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const json = dict.toJson();
      const source = json.source as any;
      expect(source.type).to.equal("EXTERNAL");
      expect(source.externalSource).to.exist;

      // Must use "source_type" (Rust serde tag) — NOT "type"
      expect(source.externalSource).to.have.property("source_type");
      expect(source.externalSource.source_type).to.equal("HTTP");
      // Regression guard: Rust's ExternalDictionarySource uses #[serde(tag = "source_type")],
      // so the inner object must NOT have a "type" property.
      expect(source.externalSource).not.to.have.property("type");
    });

    it("should appear in toInfraMap olapDictionaries", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_infra", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = toInfraMap(getMooseInternal());
      expect(infraMap).to.have.property("olapDictionaries");
      expect(infraMap.olapDictionaries).to.have.property("dict_infra");
      expect((infraMap.olapDictionaries as any)["dict_infra"].name).to.equal(
        "dict_infra",
      );
    });

    it("should use SCREAMING_SNAKE_CASE for layout type", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_layout_case", {
        sourceTable: source,
        primaryKey: ["ProductId", "Category"],
        layout: { type: "COMPLEX_KEY_HASHED" },
        lifetime: 3600,
      });

      const json = dict.toJson();
      expect((json.layout as any).type).to.equal("COMPLEX_KEY_HASHED");
    });

    it("should serialize layout fields as snake_case for Rust", () => {
      const dict = new OlapDictionary<ProductLookup>("dict_snakecase", {
        externalSource: { type: "http", url: "http://x.com", format: "CSV" },
        primaryKey: ["ProductId"],
        layout: { type: "CACHE", sizeInCells: 10000, maxThreadsForUpdates: 4 },
        lifetime: 3600,
      });

      const json = dict.toJson();
      const jsonStr = JSON.stringify(json);
      // Layout fields must be snake_case for Rust deserialization
      expect(jsonStr).to.include("size_in_cells");
      expect(jsonStr).to.include("max_threads_for_updates");
      expect(jsonStr).not.to.include("sizeInCells");
      expect(jsonStr).not.to.include("maxThreadsForUpdates");
      // Top-level dictionary keys remain camelCase
      expect(jsonStr).to.include("primaryKey");
      expect(jsonStr).not.to.include("primary_key");
    });
  });

  // ── Layout types ─────────────────────────────────────────────────────────

  describe("layout types", () => {
    const layouts: OlapDictionaryConfig<ProductLookup>["layout"][] = [
      { type: "FLAT" },
      { type: "HASHED" },
      { type: "HASHED", initialArraySize: 512, maxLoadFactor: 0.9 },
      { type: "SPARSE_HASHED" },
      { type: "HASHED_ARRAY", shards: 4 },
      { type: "RANGE_HASHED" },
      { type: "CACHE", sizeInCells: 10000 },
      { type: "SSD_CACHE", path: "/tmp/dict" },
      { type: "DIRECT" },
      { type: "IP_TRIE" },
      { type: "COMPLEX_KEY_HASHED" },
      { type: "COMPLEX_KEY_SPARSE_HASHED" },
      { type: "COMPLEX_KEY_HASHED_ARRAY" },
      { type: "COMPLEX_KEY_CACHE", sizeInCells: 5000 },
      { type: "COMPLEX_KEY_SSD_CACHE", path: "/tmp/ck_dict" },
      { type: "COMPLEX_KEY_DIRECT" },
    ];

    layouts.forEach((layout, idx) => {
      it(`should serialize layout type ${layout.type}`, () => {
        const source = makeSourceTable();
        const isComplex = COMPLEX_KEY_LAYOUTS.has(layout.type);
        const dict = new OlapDictionary<ProductLookup>(`dict_layout_${idx}`, {
          sourceTable: source,
          primaryKey: isComplex ? ["ProductId", "Category"] : ["ProductId"],
          layout,
          lifetime: 3600,
        });

        const json = dict.toJson();
        expect((json.layout as any).type).to.equal(layout.type);
      });
    });

    it("COMPLEX_KEY_LAYOUTS set should contain all COMPLEX_KEY_* variants", () => {
      const complexLayouts = [
        "COMPLEX_KEY_HASHED",
        "COMPLEX_KEY_SPARSE_HASHED",
        "COMPLEX_KEY_HASHED_ARRAY",
        "COMPLEX_KEY_CACHE",
        "COMPLEX_KEY_SSD_CACHE",
        "COMPLEX_KEY_DIRECT",
      ];
      for (const t of complexLayouts) {
        expect(COMPLEX_KEY_LAYOUTS.has(t as any)).to.be.true;
      }
    });
  });

  // ── get() / getOrDefault() / has() helpers ────────────────────────────────

  describe("SQL helpers", () => {
    it("get() should produce dictGet SQL fragment", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_get", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const fragment = dict.get("ProductName", "ProductId");
      expect(fragment.strings.join("")).to.include("dictGet");
      expect(fragment.strings.join("")).to.include("dict_get");
      expect(fragment.strings.join("")).to.include("ProductName");
    });

    it("get() should use qualified name when database is set", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_get_db", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        database: "catalog",
      });

      const fragment = dict.get("ProductName", "ProductId");
      expect(fragment.strings.join("")).to.include("catalog.dict_get_db");
    });

    it("getOrDefault() should produce dictGetOrDefault SQL fragment", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_getdef", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const fragment = dict.getOrDefault("ProductName", "Unknown", "ProductId");
      expect(fragment.strings.join("")).to.include("dictGetOrDefault");
      expect(fragment.strings.join("")).to.include("Unknown");
    });

    it("getOrDefault() should escape single quotes in string defaults", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_getdef_escape", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const fragment = dict.getOrDefault(
        "ProductName",
        "O'Reilly",
        "ProductId",
      );
      expect(fragment.strings.join("")).to.include("O''Reilly");
    });

    it("has() should produce dictHas SQL fragment", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_has", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const fragment = dict.has("ProductId");
      expect(fragment.strings.join("")).to.include("dictHas");
      expect(fragment.strings.join("")).to.include("dict_has");
    });

    it("get() with composite key should produce tuple-wrapped key", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_composite", {
        sourceTable: source,
        primaryKey: ["ProductId", "Category"],
        layout: { type: "COMPLEX_KEY_HASHED" },
        lifetime: 3600,
      });

      const fragment = dict.get("ProductName", "ProductId", "Category");
      const sqlStr = fragment.strings.join("");
      expect(sqlStr).to.include("(");
      expect(sqlStr).to.include("ProductId");
      expect(sqlStr).to.include("Category");
    });

    it("get() should throw when no key arguments are provided", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_nokeys", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(() => dict.get("ProductName")).to.throw(
        "key argument is required",
      );
    });

    it("has() should throw when no key arguments are provided", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_has_nokeys", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(() => dict.has()).to.throw("key argument is required");
    });

    it("get() should throw when too few keys passed (1 passed, 2 required)", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_arity_few", {
        sourceTable: source,
        primaryKey: ["ProductId", "Category"],
        layout: { type: "COMPLEX_KEY_HASHED" },
        lifetime: 3600,
      });

      expect(() => dict.get("ProductName", "only_one_key")).to.throw(
        "expected 2 key argument(s) but got 1",
      );
    });

    it("get() should throw when too many keys passed (2 passed, 1 required)", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_arity_many", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(() => dict.get("ProductName", "key_one", "extra_key")).to.throw(
        "expected 1 key argument(s) but got 2",
      );
    });

    it("has() should throw when too few keys passed (1 passed, 2 required)", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_has_arity_few", {
        sourceTable: source,
        primaryKey: ["ProductId", "Category"],
        layout: { type: "COMPLEX_KEY_HASHED" },
        lifetime: 3600,
      });

      expect(() => dict.has("only_one_key")).to.throw(
        "expected 2 key argument(s) but got 1",
      );
    });

    it("has() should throw when too many keys passed (2 passed, 1 required)", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_has_arity_many", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(() => dict.has("key_one", "extra_key")).to.throw(
        "expected 1 key argument(s) but got 2",
      );
    });

    it("dictionary should be interpolatable in sql template tag", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_interp", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const query = sql`dictGet(${dict}, 'ProductName', product_id)`;
      // The dict renders as 'dict_interp' (string literal)
      expect(query.strings.join("")).to.include("'dict_interp'");
    });

    it("dictionary with database should render qualified name in sql template", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_interp_db", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        database: "mydb",
      });

      const query = sql`dictGet(${dict}, 'ProductName', product_id)`;
      expect(query.strings.join("")).to.include("'mydb.dict_interp_db'");
    });

    // Regression: sql template interpolation of a dictionary must escape single quotes
    // in the qualified name, consistent with get()/getOrDefault()/has() which all call
    // .replace(/'/g, "''"). Without the fix, a dict name containing a single quote
    // produces malformed SQL.
    it("sql template interpolation escapes single quotes in dictionary name", () => {
      const source = makeSourceTable();
      // Construct a dict whose qualified name contains a single quote by setting the
      // database to a string with an apostrophe (e.g. "it's_db").
      const dict = new OlapDictionary<ProductLookup>("dict_escape", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        database: "it's_db",
      });

      const query = sql`dictGet(${dict}, 'ProductName', product_id)`;
      const rendered = query.strings.join("");
      // Single quote in database name must be doubled: it's → it''s
      expect(rendered).to.include("'it''s_db.dict_escape'");
      expect(rendered).not.to.include("'it's_db.dict_escape'");
    });
  });

  // ── getOlapDictionaries / getOlapDictionary ───────────────────────────────

  describe("registry accessors", () => {
    it("getOlapDictionaries should return all registered dictionaries", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_a", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });
      new OlapDictionary<ProductLookup>("dict_b", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "FLAT" },
        lifetime: 0,
      });

      const dicts = getOlapDictionaries();
      expect(dicts.size).to.equal(2);
      expect(dicts.has("dict_a")).to.be.true;
      expect(dicts.has("dict_b")).to.be.true;
    });

    it("getOlapDictionary should return the correct instance by name", () => {
      const source = makeSourceTable();
      const dict = new OlapDictionary<ProductLookup>("dict_get_by_name", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      expect(getOlapDictionary("dict_get_by_name")).to.equal(dict);
      expect(getOlapDictionary("nonexistent")).to.be.undefined;
    });
  });
});
