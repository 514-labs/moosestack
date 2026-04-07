/**
 * Integration tests for OlapDictionary → infra map round-trip.
 *
 * These tests verify that the TypeScript serializer produces JSON that matches
 * what Rust's serde deserializer expects, specifically:
 *
 *   - OlapDictionary fields: #[serde(rename_all = "camelCase")]
 *       Rust field `primary_key`     → JSON key `primaryKey`
 *       Rust field `life_cycle`      → JSON key `lifeCycle`
 *       Rust field `cluster_name`    → JSON key `clusterName`
 *
 *   - DictionarySource: #[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
 *       Variants TABLE, QUERY, EXTERNAL
 *
 *   - DictionaryLayout: #[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
 *       Variant field names are snake_case (Rust default, no rename_all on fields)
 *       e.g. `size_in_cells`, `max_load_factor`, `initial_array_size`
 *
 *   - DictionaryLifetime: #[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
 *       Variants STATIC, SINGLE (with `seconds`), RANGE (with `min` / `max`)
 *
 *   - DictionaryColumn: #[serde(rename_all = "camelCase")]
 *       Rust field `type_string`   → JSON key `typeString`
 *       Rust field `default_value` → JSON key `defaultValue`
 *       Rust field `is_injective`  → JSON key `isInjective`
 *
 * Tests are split into two categories:
 *   1. In-process: use toInfraMap() directly (typia injects schema / columns).
 *   2. Subprocess: spawn `node dist/moose-runner.js dmv2-serializer` against a
 *      pre-written fixture file, simulating what the Rust CLI does.
 */

import { expect } from "chai";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";
import { OlapTable } from "../src/dmv2/sdk/olapTable";
import { OlapDictionary } from "../src/dmv2/sdk/olapDictionary";
import { sql } from "../src/sqlHelpers";
import { ClickHouseInt } from "../src/dataModels/types";

// ─── Schema types ─────────────────────────────────────────────────────────────

interface ProductLookup {
  ProductId: string;
  ProductName: string;
  Category: string;
  PriceLevel: number & ClickHouseInt<"int32">;
}

interface MultiKeyLookup {
  RegionId: string;
  ProductId: string;
  Score: number & ClickHouseInt<"int32">;
}

// ─── In-process helpers ───────────────────────────────────────────────────────

function clearRegistry(): void {
  const r = getMooseInternal();
  r.tables.clear();
  r.olapDictionaries.clear();
}

function makeSourceTable(): OlapTable<ProductLookup> {
  return new OlapTable<ProductLookup>("Products", {
    orderByFields: ["ProductId"],
  });
}

/**
 * Serialize the current registry to a JSON string, then parse it back.
 * This simulates what the Rust CLI does: read the ___MOOSE_STUFF___ output,
 * strip the delimiters, and JSON.parse the payload.
 */
function roundTripInfraMap(): Record<string, any> {
  const map = toInfraMap(getMooseInternal());
  // Simulate the subprocess output format:
  //   console.log("___MOOSE_STUFF___start", JSON.stringify(infraMap), "end___MOOSE_STUFF___")
  // Note: console.log separates args with a space, so the JSON is between the markers.
  const raw = `___MOOSE_STUFF___start ${JSON.stringify(map)} end___MOOSE_STUFF___`;
  return parseDelimitedOutput(raw);
}

// ─── Subprocess helpers ───────────────────────────────────────────────────────

const MOOSE_RUNNER = resolve(__dirname, "../dist/moose-runner.js");
// Absolute path to the built dist — used by fixture scripts to load OlapDictionary
// without needing @514labs/moose-lib in node_modules of the temp directory.
const DIST_INDEX = resolve(__dirname, "../dist/index.js");

interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Create a minimal temp project directory that `moose-runner dmv2-serializer` can run against.
 * Layout mirrors a compiled Moose project:
 *   <tmpDir>/.moose/compiled/app/index.js
 */
function createTempProject(fixtureContent: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "moose-dict-test-"));
  const compiledAppDir = join(tmpDir, ".moose", "compiled", "app");
  mkdirSync(compiledAppDir, { recursive: true });
  writeFileSync(join(compiledAppDir, "index.js"), fixtureContent);
  return tmpDir;
}

/**
 * Run `node dist/moose-runner.js dmv2-serializer` from the given project directory.
 * Env vars mirror what the Rust CLI sets (see bin.rs).
 */
function runSerializer(projectDir: string): SubprocessResult {
  const result = spawnSync("node", [MOOSE_RUNNER, "dmv2-serializer"], {
    cwd: projectDir,
    env: {
      ...process.env,
      MOOSE_SOURCE_DIR: "app",
      MOOSE_USE_COMPILED: "true",
      NODE_NO_WARNINGS: "1",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Extract and JSON-parse the infra map from the moose-runner output.
 * The CLI wraps the JSON in:
 *   ___MOOSE_STUFF___start <JSON> end___MOOSE_STUFF___
 */
function parseDelimitedOutput(output: string): Record<string, any> {
  const START = "___MOOSE_STUFF___start";
  const END = "end___MOOSE_STUFF___";
  const start = output.indexOf(START);
  const end = output.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(
      `Delimiter markers not found in output:\n${output.slice(0, 800)}`,
    );
  }
  const json = output.slice(start + START.length, end).trim();
  return JSON.parse(json);
}

// ─── Subprocess fixture generators ───────────────────────────────────────────

/**
 * Returns CJS JavaScript for a fixture that registers a single TABLE-source
 * OlapDictionary. This simulates what a user's compiled index.js looks like
 * after the typia compiler plugin has injected the schema and column metadata.
 *
 * We pass column data explicitly (the 4th constructor argument) instead of
 * relying on the typia transform, because this file runs in a subprocess that
 * does not have the compiler plugin active.
 */
function tableSourceFixture(): string {
  return `
'use strict';
const { OlapDictionary } = require(${JSON.stringify(DIST_INDEX)});

// Schema placeholder — normally injected by the typia compiler plugin.
const schema = {};

// Columns — normally injected by the typia compiler plugin.
const columns = [
  { name: 'ProductId', data_type: 'String' },
  { name: 'ProductName', data_type: 'String' },
  { name: 'Category', data_type: 'String' },
  { name: 'PriceLevel', data_type: 'Int32' },
];

// Fake View-like source object. The serializer checks (table instanceof OlapTable);
// on failure it falls through to the View branch which just uses table.name.
const sourceView = { name: 'Products' };

new OlapDictionary(
  'dict_products',
  {
    sourceTable: sourceView,
    primaryKey: ['ProductId'],
    layout: { type: 'HASHED', initialArraySize: 1024, maxLoadFactor: 0.9 },
    lifetime: 3600,
    settings: { max_execution_time: '30' },
    comment: 'Product lookup dictionary',
  },
  schema,
  columns
);
`;
}

/**
 * Returns CJS JavaScript for a fixture that registers a single QUERY-source
 * OlapDictionary backed by a SELECT statement.
 */
function querySourceFixture(): string {
  return `
'use strict';
const { OlapDictionary, sql } = require(${JSON.stringify(DIST_INDEX)});

const schema = {};
const columns = [
  { name: 'ProductId', data_type: 'String' },
  { name: 'ProductName', data_type: 'String' },
];

// sql tagged template — same helper users call in their TypeScript code.
const query = sql\`SELECT ProductId, ProductName FROM Products WHERE active = 1\`;

new OlapDictionary(
  'dict_by_query',
  {
    sourceQuery: query,
    sourceTables: [{ name: 'Products' }],
    primaryKey: ['ProductId'],
    layout: { type: 'FLAT' },
    lifetime: 0,
  },
  schema,
  columns
);
`;
}

/**
 * Returns CJS JavaScript that intentionally creates an invalid OlapDictionary
 * (no source set). The constructor throws, causing the process to exit non-zero.
 */
function malformedFixture(): string {
  return `
'use strict';
const { OlapDictionary } = require(${JSON.stringify(DIST_INDEX)});

// This will throw: "exactly one of sourceTable, sourceQuery, or externalSource must be set"
new OlapDictionary(
  'dict_bad',
  {
    primaryKey: ['Id'],
    layout: { type: 'HASHED' },
    lifetime: 3600,
    // No sourceTable / sourceQuery / externalSource — intentionally malformed
  },
  {},
  [{ name: 'Id', data_type: 'String' }]
);
`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OlapDictionary infra map round-trip", () => {
  // ── In-process tests ────────────────────────────────────────────────────────

  describe("in-process: top-level field names match Rust #[serde(rename_all = camelCase)]", () => {
    beforeEach(clearRegistry);

    it("emits primaryKey (camelCase), not primary_key (snake_case)", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_pk", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_pk"];
      expect(dict).to.have.property("primaryKey");
      expect(dict).to.not.have.property("primary_key");
      expect(dict.primaryKey).to.deep.equal(["ProductId"]);
    });

    it("emits lifeCycle (camelCase), not life_cycle (snake_case)", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_lc", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_lc"];
      expect(dict).to.have.property("lifeCycle");
      expect(dict).to.not.have.property("life_cycle");
    });

    it("emits clusterName (camelCase) when set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_cluster", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        clusterName: "my_cluster",
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_cluster"];
      expect(dict).to.have.property("clusterName", "my_cluster");
      expect(dict).to.not.have.property("cluster_name");
    });

    it("emits invalidateQuery (camelCase) when set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_iq", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        invalidateQuery: "SELECT max(updated_at) FROM Products",
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_iq"];
      expect(dict).to.have.property(
        "invalidateQuery",
        "SELECT max(updated_at) FROM Products",
      );
      expect(dict).to.not.have.property("invalidate_query");
    });
  });

  describe("in-process: DictionarySource type discriminants (SCREAMING_SNAKE_CASE)", () => {
    beforeEach(clearRegistry);

    it('TABLE source emits type = "TABLE"', () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_table_src", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_table_src"];
      expect(dict.source.type).to.equal("TABLE");
    });

    it("TABLE source includes table name and optional database", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_table_fields", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_table_fields"];
      expect(dict.source).to.have.property("table");
      // The table name comes from OlapTable.generateTableName()
      expect(dict.source.table).to.be.a("string").and.to.not.be.empty;
    });

    it('QUERY source emits type = "QUERY"', () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_query_src", {
        sourceQuery: sql`SELECT ProductId, ProductName FROM ${source}`,
        sourceTables: [source],
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_query_src"];
      expect(dict.source.type).to.equal("QUERY");
    });

    it("QUERY source includes query string", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_query_str", {
        sourceQuery: sql`SELECT ProductId, ProductName FROM ${source}`,
        sourceTables: [source],
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_query_str"];
      expect(dict.source).to.have.property("query");
      expect(dict.source.query).to.be.a("string").and.to.not.be.empty;
    });
  });

  describe("in-process: DictionaryLayout variant field names are snake_case", () => {
    beforeEach(clearRegistry);

    it("HASHED layout: initialArraySize → initial_array_size, maxLoadFactor → max_load_factor", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_hashed_fields", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED", initialArraySize: 512, maxLoadFactor: 0.75 },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_hashed_fields"].layout;
      expect(layout.type).to.equal("HASHED");
      expect(layout).to.have.property("initial_array_size", 512);
      expect(layout).to.have.property("max_load_factor", 0.75);
      // camelCase variants must NOT appear — Rust expects snake_case
      expect(layout).to.not.have.property("initialArraySize");
      expect(layout).to.not.have.property("maxLoadFactor");
    });

    it("CACHE layout: sizeInCells → size_in_cells, maxThreadsForUpdates → max_threads_for_updates", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_cache_fields", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "CACHE", sizeInCells: 10_000, maxThreadsForUpdates: 4 },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_cache_fields"].layout;
      expect(layout.type).to.equal("CACHE");
      expect(layout).to.have.property("size_in_cells", 10_000);
      expect(layout).to.have.property("max_threads_for_updates", 4);
      expect(layout).to.not.have.property("sizeInCells");
      expect(layout).to.not.have.property("maxThreadsForUpdates");
    });

    it("HASHED_ARRAY layout: shards → shards (unchanged — already lowercase)", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_hashed_array", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED_ARRAY", shards: 8 },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_hashed_array"].layout;
      expect(layout.type).to.equal("HASHED_ARRAY");
      expect(layout).to.have.property("shards", 8);
    });

    it("IP_TRIE layout: accessToKeyFromAttributes → access_to_key_from_attributes", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_ip_trie", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "IP_TRIE", accessToKeyFromAttributes: true },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_ip_trie"].layout;
      expect(layout.type).to.equal("IP_TRIE");
      expect(layout).to.have.property("access_to_key_from_attributes", true);
      expect(layout).to.not.have.property("accessToKeyFromAttributes");
    });

    it("RANGE_HASHED layout: rangeLookupStrategy → range_lookup_strategy", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_range_hashed", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "RANGE_HASHED", rangeLookupStrategy: "min" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_range_hashed"].layout;
      expect(layout.type).to.equal("RANGE_HASHED");
      expect(layout).to.have.property("range_lookup_strategy", "min");
      expect(layout).to.not.have.property("rangeLookupStrategy");
    });

    it("SSD_CACHE layout: all fields are snake_case", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_ssd_cache", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: {
          type: "SSD_CACHE",
          path: "/tmp/dict",
          blockSize: 4096,
          fileSize: 1_073_741_824,
          readBufferSize: 1_048_576,
          writeBufferSize: 1_048_576,
          maxStoredKeys: 1_000_000,
        },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_ssd_cache"].layout;
      expect(layout.type).to.equal("SSD_CACHE");
      expect(layout).to.have.property("block_size", 4096);
      expect(layout).to.have.property("file_size", 1_073_741_824);
      expect(layout).to.have.property("read_buffer_size", 1_048_576);
      expect(layout).to.have.property("write_buffer_size", 1_048_576);
      expect(layout).to.have.property("max_stored_keys", 1_000_000);
      // No camelCase variants
      expect(layout).to.not.have.property("blockSize");
      expect(layout).to.not.have.property("fileSize");
      expect(layout).to.not.have.property("readBufferSize");
      expect(layout).to.not.have.property("writeBufferSize");
      expect(layout).to.not.have.property("maxStoredKeys");
    });

    it("COMPLEX_KEY_HASHED layout: emits correct type string and snake_case fields", () => {
      const source = makeSourceTable();
      new OlapDictionary<MultiKeyLookup>("dict_ck_hashed", {
        sourceTable: source,
        primaryKey: ["RegionId", "ProductId"],
        layout: {
          type: "COMPLEX_KEY_HASHED",
          initialArraySize: 256,
          maxLoadFactor: 0.8,
        },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const layout = infraMap.olapDictionaries["dict_ck_hashed"].layout;
      expect(layout.type).to.equal("COMPLEX_KEY_HASHED");
      expect(layout).to.have.property("initial_array_size", 256);
      expect(layout).to.have.property("max_load_factor", 0.8);
    });
  });

  describe("in-process: DictionaryLifetime type discriminants and fields", () => {
    beforeEach(clearRegistry);

    it('lifetime: 0 → type = "STATIC" (no extra fields)', () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_lt_static", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "FLAT" },
        lifetime: 0,
      });

      const infraMap = roundTripInfraMap();
      const lifetime = infraMap.olapDictionaries["dict_lt_static"].lifetime;
      expect(lifetime.type).to.equal("STATIC");
      expect(Object.keys(lifetime)).to.deep.equal(["type"]);
    });

    it('lifetime: N > 0 → type = "SINGLE" with seconds field', () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_lt_single", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 7200,
      });

      const infraMap = roundTripInfraMap();
      const lifetime = infraMap.olapDictionaries["dict_lt_single"].lifetime;
      expect(lifetime.type).to.equal("SINGLE");
      expect(lifetime).to.have.property("seconds", 7200);
    });

    it('lifetime: { min, max } → type = "RANGE" with min/max fields', () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_lt_range", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: { min: 300, max: 600 },
      });

      const infraMap = roundTripInfraMap();
      const lifetime = infraMap.olapDictionaries["dict_lt_range"].lifetime;
      expect(lifetime.type).to.equal("RANGE");
      // Rust DictionaryRangeLifetime has #[serde(rename_all = "camelCase")]
      // but min/max are single-word — they remain min/max unchanged
      expect(lifetime).to.have.property("min", 300);
      expect(lifetime).to.have.property("max", 600);
    });
  });

  describe("in-process: DictionaryColumn fields match Rust #[serde(rename_all = camelCase)]", () => {
    beforeEach(clearRegistry);

    it("emits typeString (camelCase), not type_string (snake_case)", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_col_type", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const columns: any[] = infraMap.olapDictionaries["dict_col_type"].columns;
      expect(columns.length).to.be.greaterThan(0);
      columns.forEach((col) => {
        expect(col).to.have.property("typeString");
        expect(col).to.not.have.property("type_string");
      });
    });

    it("emits defaultValue (camelCase) when set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_col_default", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        columns: { ProductName: { defaultValue: "'Unknown'" } },
      });

      const infraMap = roundTripInfraMap();
      const cols: any[] = infraMap.olapDictionaries["dict_col_default"].columns;
      const nameCol = cols.find((c: any) => c.name === "ProductName");
      expect(nameCol).to.exist;
      expect(nameCol).to.have.property("defaultValue", "'Unknown'");
      expect(nameCol).to.not.have.property("default_value");
    });

    it("emits isInjective (camelCase) when set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_col_injective", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        columns: { ProductName: { isInjective: true } },
      });

      const infraMap = roundTripInfraMap();
      const cols: any[] =
        infraMap.olapDictionaries["dict_col_injective"].columns;
      const nameCol = cols.find((c: any) => c.name === "ProductName");
      expect(nameCol).to.have.property("isInjective", true);
      expect(nameCol).to.not.have.property("is_injective");
    });

    it("emits isHierarchical (camelCase) when set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_col_hierarchical", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        columns: { Category: { isHierarchical: true } },
      });

      const infraMap = roundTripInfraMap();
      const cols: any[] =
        infraMap.olapDictionaries["dict_col_hierarchical"].columns;
      const catCol = cols.find((c: any) => c.name === "Category");
      expect(catCol).to.have.property("isHierarchical", true);
      expect(catCol).to.not.have.property("is_hierarchical");
    });
  });

  describe("in-process: settings and optional fields are omitted when not set", () => {
    beforeEach(clearRegistry);

    it("settings defaults to empty object {}", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_no_settings", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_no_settings"];
      expect(dict.settings).to.deep.equal({});
    });

    it("database is absent when not set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_no_db", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_no_db"];
      expect(dict).to.not.have.property("database");
    });

    it("database is present when set", () => {
      const source = makeSourceTable();
      new OlapDictionary<ProductLookup>("dict_with_db", {
        sourceTable: source,
        primaryKey: ["ProductId"],
        layout: { type: "HASHED" },
        lifetime: 3600,
        database: "catalog",
      });

      const infraMap = roundTripInfraMap();
      const dict = infraMap.olapDictionaries["dict_with_db"];
      expect(dict).to.have.property("database", "catalog");
    });
  });

  // ── Subprocess tests ────────────────────────────────────────────────────────

  describe("subprocess: TABLE source — full CLI round-trip via moose-runner", () => {
    let tmpDir: string | undefined;
    let cachedResult: ReturnType<typeof runSerializer>;
    let infraMap: Record<string, any>;

    before(function (this: Mocha.Context) {
      this.timeout(30_000);
      tmpDir = createTempProject(tableSourceFixture());
      cachedResult = runSerializer(tmpDir);
      if (cachedResult.exitCode === 0) {
        infraMap = parseDelimitedOutput(cachedResult.stdout);
      }
    });

    after(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("exits with code 0", () => {
      expect(cachedResult.exitCode, `stderr: ${cachedResult.stderr}`).to.equal(
        0,
      );
    });

    it("output contains ___MOOSE_STUFF___ delimiters", () => {
      expect(cachedResult.stdout).to.include("___MOOSE_STUFF___start");
      expect(cachedResult.stdout).to.include("end___MOOSE_STUFF___");
    });

    it("olapDictionaries section contains dict_products", () => {
      expect(infraMap).to.have.property("olapDictionaries");
      expect(infraMap.olapDictionaries).to.have.property("dict_products");
    });

    it("dict_products has correct name", () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict.name).to.equal("dict_products");
    });

    it("dict_products primaryKey is camelCase and correct", () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict).to.have.property("primaryKey");
      expect(dict).to.not.have.property("primary_key");
      expect(dict.primaryKey).to.deep.equal(["ProductId"]);
    });

    it('dict_products source.type is "TABLE"', () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict.source.type).to.equal("TABLE");
    });

    it("dict_products source.table is the Products table name", () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      // Fixture uses a View-like object with name 'Products'
      expect(dict.source.table).to.equal("Products");
    });

    it("dict_products layout.type is HASHED with snake_case fields", () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict.layout.type).to.equal("HASHED");
      expect(dict.layout).to.have.property("initial_array_size", 1024);
      expect(dict.layout).to.have.property("max_load_factor", 0.9);
      expect(dict.layout).to.not.have.property("initialArraySize");
      expect(dict.layout).to.not.have.property("maxLoadFactor");
    });

    it('dict_products lifetime.type is "SINGLE" with seconds: 3600', () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict.lifetime.type).to.equal("SINGLE");
      expect(dict.lifetime.seconds).to.equal(3600);
    });

    it("dict_products columns include typeString (camelCase)", () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict.columns).to.be.an("array").with.length.greaterThan(0);
      const col = dict.columns[0];
      expect(col).to.have.property("typeString");
      expect(col).to.not.have.property("type_string");
    });

    it("dict_products settings and comment are present", () => {
      const dict = infraMap.olapDictionaries["dict_products"];
      expect(dict.settings).to.deep.equal({ max_execution_time: "30" });
      expect(dict.comment).to.equal("Product lookup dictionary");
    });
  });

  describe("subprocess: QUERY source — full CLI round-trip via moose-runner", () => {
    let tmpDir: string | undefined;
    let cachedResult: ReturnType<typeof runSerializer>;
    let infraMap: Record<string, any>;

    before(function (this: Mocha.Context) {
      this.timeout(30_000);
      tmpDir = createTempProject(querySourceFixture());
      cachedResult = runSerializer(tmpDir);
      if (cachedResult.exitCode === 0) {
        infraMap = parseDelimitedOutput(cachedResult.stdout);
      }
    });

    after(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("exits with code 0", () => {
      expect(cachedResult.exitCode, `stderr: ${cachedResult.stderr}`).to.equal(
        0,
      );
    });

    it("olapDictionaries section contains dict_by_query", () => {
      expect(infraMap.olapDictionaries).to.have.property("dict_by_query");
    });

    it('dict_by_query source.type is "QUERY"', () => {
      const dict = infraMap.olapDictionaries["dict_by_query"];
      expect(dict.source.type).to.equal("QUERY");
    });

    it("dict_by_query source.query is a non-empty SQL string", () => {
      const dict = infraMap.olapDictionaries["dict_by_query"];
      expect(dict.source).to.have.property("query");
      expect(dict.source.query).to.be.a("string").and.include("SELECT");
    });

    it('dict_by_query lifetime.type is "STATIC" (lifetime: 0)', () => {
      const dict = infraMap.olapDictionaries["dict_by_query"];
      expect(dict.lifetime.type).to.equal("STATIC");
    });

    it('dict_by_query layout.type is "FLAT"', () => {
      const dict = infraMap.olapDictionaries["dict_by_query"];
      expect(dict.layout.type).to.equal("FLAT");
    });
  });

  describe("subprocess: malformed fixture — invalid dictionary should cause non-zero exit", () => {
    let tmpDir: string | undefined;
    let cachedResult: ReturnType<typeof runSerializer>;

    before(function (this: Mocha.Context) {
      this.timeout(30_000);
      tmpDir = createTempProject(malformedFixture());
      cachedResult = runSerializer(tmpDir);
    });

    after(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("exits with non-zero status when the user file throws", () => {
      expect(cachedResult.exitCode).to.not.equal(0);
    });

    it("stderr contains an error message", () => {
      expect(cachedResult.stderr).to.be.a("string").and.to.not.be.empty;
    });
  });
});
