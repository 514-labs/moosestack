# Plan: First-Class ClickHouse Dictionary Support in MooseStack

## Context

ClickHouse Dictionaries can currently only be modeled via raw SQL in `SqlResource`, which provides no type safety, no diff detection, no lifecycle management, and no introspection. This adds a first-class `OlapDictionary` SDK primitive — analogous to `OlapTable` and `MaterializedView` — across TypeScript, Python, and Rust.

Issue: https://github.com/514-labs/moosestack/issues/3853

### Confirmed API — TypeScript usage example

```typescript
import { OlapTable, OlapDictionary, View, MaterializedView, ClickHouseInt, sql } from "@514labs/moose-lib";

// 1. Source table
interface Product {
  ProductId: string;
  ProductName: string;
  Category: string;
  PriceLevel: number & ClickHouseInt<"Int32">;
  version: number & ClickHouseInt<"UInt64">;
}

export const ProductsTable = new OlapTable<Product>("products", {
  orderByFields: ["ProductId"],
  engine: { type: "ReplacingMergeTree", ver: "version" },
});

// 2a. Simple case — direct table reference
//     Generates: SOURCE(CLICKHOUSE(TABLE 'products' DB 'local'))
interface ProductLookup {
  ProductId: string;
  ProductName: string;
  Category: string;
  PriceLevel: number & ClickHouseInt<"Int32">;
}

export const ProductDict = new OlapDictionary<ProductLookup>("dict_products", {
  sourceTable: ProductsTable,     // OlapTable | View reference → SOURCE(CLICKHOUSE(TABLE ...))
  primaryKey: ["ProductId"],
  layout: { type: "HASHED" },
  lifetime: { min: 10, max: 15 },
  invalidate: { column: "version", fn: "max" },
  defaults: { Category: "Unknown", PriceLevel: 0 },
});

// 2b. Complex case — sql template with typed table/column interpolation
//     Generates: SOURCE(CLICKHOUSE(QUERY 'SELECT ... FROM `local`.`products` FINAL'))
export const ProductDictComplex = new OlapDictionary<ProductLookup>("dict_products_v2", {
  sourceQuery: sql`SELECT ProductId, ProductName, Category, PriceLevel FROM ${ProductsTable} FINAL`,
  sourceTables: [ProductsTable],  // explicit dependency tracking (required for sourceQuery)
  primaryKey: ["ProductId"],
  layout: { type: "HASHED" },
  lifetime: { min: 10, max: 15 },
});

// 3. Use dictGet in a materialized view via typed helper
export const EnrichClicksMV = new MaterializedView<EnrichedClick>("enrich_clicks_mv", {
  selectStatement: sql`
    SELECT
      ClickId,
      ProductId,
      ${ProductDict.get("ProductName", sql`ProductId`)} AS ProductName,
      ${ProductDict.get("Category", sql`ProductId`)} AS Category,
      ClickedAt
    FROM ${RawClicksTable}
  `,
  selectTables: [RawClicksTable],
  targetTable: ClicksTable,
});
// ProductDict.get("ProductName", sql`ProductId`)
//   → dictGet('local.dict_products', 'ProductName', ProductId)
```

### Source config — mutually exclusive fields (not a union)

The source is specified via **exactly one** of three mutually exclusive config fields. This eliminates ambiguity and makes validation straightforward:

| Config field | Type | `sourceTables` | DDL generated |
|---|---|---|---|
| `sourceTable` | `OlapTable \| View` | Not needed (auto-extracted) | `SOURCE(CLICKHOUSE(TABLE 'name' DB 'db'))` |
| `sourceQuery` | `Sql` (template tag only, no raw strings) | Required (explicit) | `SOURCE(CLICKHOUSE(QUERY 'SELECT ...'))` |
| `externalSource` | Typed discriminated union (`{ type: "mysql", ... }`) | N/A | `SOURCE(MYSQL(...))`, `SOURCE(HTTP(...))`, etc. |

Validation: exactly one of `sourceTable`/`sourceQuery`/`externalSource` must be set. Setting zero or multiple is a config error caught at registration time.

**Why no raw `string` for sourceQuery**: A plain string is ambiguous — it's hard to distinguish "raw ClickHouse query" from "user accidentally passed a table name string instead of a typed reference." The `sql` template tag is required because it enables typed interpolation and dependency extraction.

**External source types (typed discriminated union):**

| Source type | Key parameters |
|---|---|
| `clickhouse_remote` | host, port, user, password, db, table/query, where, secure, invalidateQuery |
| `http` | url, format, credentials (user/password), headers |
| `mysql` | host, port, user, password, db, table/query, where, replicas, invalidateQuery |
| `postgresql` | host, port, user, password, db, table/query, where, replicas, invalidateQuery |
| `mongodb` | host, port, user, password, db, collection |
| `redis` | host, port, dbIndex, password, storageType |
| `cassandra` | host, port, user, password, keyspace, columnFamily |
| `odbc` | connectionString, db, table/query |
| `file` | path, format |
| `executable` | command, format |
| `executable_pool` | command, format, poolSize |
| `null` | (none) |

**Named Collections**: Not supported in v1. If the SDK detects a `NAME` parameter or named collection reference in any source config, it must reject it with a clear error: "Named Collections are not yet supported. Use mooseRuntimeEnv for credentials and specify connection parameters directly."

Only `sourceTable` and `sourceQuery` participate in Moose dependency tracking. External sources have no Moose-managed dependencies. Dictionary-to-dictionary sources (a dictionary referencing another dictionary) are explicitly rejected in v1 with a clear error message.

### Confirmed real-world usage (from client feedback)

```sql
-- Client's actual dictionary definition
CREATE DICTIONARY IF NOT EXISTS snson_telemetry.partition_strategies
  [ON CLUSTER 'senseon']
(
    name String,
    strategy String DEFAULT 'WEEK'
)
PRIMARY KEY name
SOURCE(CLICKHOUSE(
    NAME 'dict_source'          -- Named Collection reference
    TABLE 'partition_strategies_source'
))
LAYOUT(COMPLEX_KEY_HASHED())
LIFETIME(MIN 60 MAX 300)

-- Used in MV CTEs for dynamic partition routing:
-- WITH dictGetOrDefault('snson_telemetry.partition_strategies', 'strategy',
--   tuple('<table_name>'), 'WEEK') AS partition_strategy
-- SELECT ... FROM ...
```

**Key takeaways:**
1. **COMPLEX_KEY_HASHED** is actively used — composite key support is required
2. **dictGetOrDefault** with `tuple()` for keys — our `getOrDefault()` helper must handle tuple wrapping for composite keys automatically
3. **Named Collections** (`NAME 'dict_source'`) — client uses server-side Named Collections for ClickHouse source config. Currently deferred, but confirmed as a real pattern.
4. **MV + CTE pattern** — dictionaries used in `WITH` CTEs inside MaterializedViews for dynamic partition key computation. Great pattern for documentation.
5. **Simple LIFETIME refresh** — no `INVALIDATE_QUERY`, just `MIN 60 MAX 300` polling
6. **DEFAULT values on columns** — `strategy String DEFAULT 'WEEK'` confirms column-level defaults are needed

### Resolved questions

All client questions answered:
1. **Composite keys** — Yes, uses `COMPLEX_KEY_HASHED`. Required.
2. **Layouts** — Only `COMPLEX_KEY_HASHED` confirmed. All layouts supported via typed union, but this gets priority testing/docs.
3. **Where dictGet is used** — MaterializedViews, specifically in `WITH` CTEs for dynamic partition routing.
4. **Dictionary-to-dictionary** — Not used. Deferred.
5. **Invalidation** — Simple `LIFETIME(MIN/MAX)` polling only. No `INVALIDATE_QUERY` needed yet.
6. **Named Collections** — Client uses them but only as indirection for same-server tables. Moose typed refs replace this pattern. Deferred.

### Credential security for external sources

External sources (MongoDB, MySQL, PostgreSQL, HTTP, Redis, Cassandra, ODBC) often require credentials. Moose already provides `mooseRuntimeEnv` (`packages/ts-moose-lib/src/secrets.ts`) for secure runtime environment variable resolution. This is the recommended approach for all external source credentials.

**How it works**: During infrastructure map loading (`IS_LOADING_INFRA_MAP=true`), `mooseRuntimeEnv.get("VAR")` returns a marker string (`__MOOSE_RUNTIME_ENV__:VAR`). At deploy time, Moose CLI resolves these markers from actual environment variables. Credentials never appear in source code or Docker images.

**Example — MongoDB source with secure credentials:**

```typescript
import { OlapDictionary, mooseRuntimeEnv, ClickHouseInt } from "@514labs/moose-lib";

interface ProductLookup {
  ProductId: string;
  ProductName: string;
  Category: string;
  PriceLevel: number & ClickHouseInt<"Int32">;
}

export const ProductDict = new OlapDictionary<ProductLookup>("dict_products", {
  externalSource: {
    type: "mongodb",
    host: "mongo.example.com",
    port: 27017,
    user: mooseRuntimeEnv.get("MONGO_USER"),
    password: mooseRuntimeEnv.get("MONGO_PASSWORD"),
    db: "catalog",
    collection: "products",
  },
  primaryKey: ["ProductId"],
  layout: { type: "HASHED" },
  lifetime: { min: 300, max: 360 },
});
```

**Example — MySQL source with secure credentials:**

```typescript
export const ProductDictMySQL = new OlapDictionary<ProductLookup>("dict_products_mysql", {
  externalSource: {
    type: "mysql",
    host: "mysql.example.com",
    port: 3306,
    user: mooseRuntimeEnv.get("MYSQL_USER"),
    password: mooseRuntimeEnv.get("MYSQL_PASSWORD"),
    db: "catalog",
    table: "products",
  },
  primaryKey: ["ProductId"],
  layout: { type: "HASHED" },
  lifetime: { min: 300, max: 360 },
});
```

**Example — HTTP source with secure credentials:**

```typescript
export const ProductDictHTTP = new OlapDictionary<ProductLookup>("dict_products_http", {
  externalSource: {
    type: "http",
    url: "https://api.example.com/products",
    format: "JSONEachRow",
    credentials: {
      user: mooseRuntimeEnv.get("API_USER"),
      password: mooseRuntimeEnv.get("API_PASSWORD"),
    },
    headers: {
      "X-API-Key": mooseRuntimeEnv.get("API_KEY"),
    },
  },
  primaryKey: ["ProductId"],
  layout: { type: "CACHE", sizeInCells: 10000 },
  lifetime: { min: 60, max: 120 },
});
```

All documentation examples for external sources MUST use `mooseRuntimeEnv.get()` for credentials — never hardcoded values.

### Key design decisions

1. **Mutually exclusive source config** — three separate fields (`sourceTable`, `sourceQuery`, `externalSource`) instead of one overloaded `source` field. Eliminates ambiguity, enables clean validation, and avoids the "did the user mean a table name or a query?" problem. No raw strings accepted for queries — `sql` template tag required.
2. **Full column attribute model** — each `DictionaryColumn` carries the full ClickHouse attribute set: `DEFAULT`, `EXPRESSION`, `INJECTIVE`, `HIERARCHICAL`, and `IS_OBJECT_ID`. Without these, valid dictionary definitions cannot round-trip through the SDK/CLI, and diffing against existing dictionaries would lose information or force false updates.
3. **Exhaustive typed layout config** — a discriminated union covering all 16 ClickHouse layout types with per-layout parameters and key-type constraints. See "Layout types" section below.
4. **`dictGet` helper** — typed methods on `OlapDictionary` instances: `get()`, `getOrDefault()`, and `has()`. The helper correctly prefixes with `database.dict_name` for cross-database usage. Range dictionaries are supported — `get()` accepts range-aware key arguments.
5. **Key/attribute column distinction** — `primaryKey` identifies key columns; attribute columns carry per-column flags (`DEFAULT`, `EXPRESSION`, `INJECTIVE`, `HIERARCHICAL`, `IS_OBJECT_ID`).
6. **Two-tier dependency tracking**:
   - **Source-side** (upstream): `sourceTable` auto-tracked; `sourceQuery` requires explicit `sourceTables`. Dictionary created after its source, dropped before its source.
   - **Consumer-side** (downstream): when `OlapDictionary` is interpolated via `sql` template tag in View/MV SQL (e.g., `${ProductDict.get(...)}`), the dictionary reference is recorded as a dependency of that View/MV. This ensures: (a) dictionary is created before dependent MVs/Views, (b) dropping a dictionary used by a MV surfaces as a plan risk, (c) creating a dictionary and MV in the same plan respects ordering.
7. **Atomic swap updates** — `CREATE OR REPLACE DICTIONARY` for all updates. `CREATE DICTIONARY IF NOT EXISTS` only for initial bootstrap. `DROP DICTIONARY IF EXISTS` only for removal. The diff/reconciliation layer emits `CREATE OR REPLACE` for updates — never DROP+CREATE. This prevents query blackout during updates.
8. **Plan risk for replacements** — dictionary drops are `DestructiveChange::DictionaryDrop`. Dictionary replacements (CREATE OR REPLACE) for cache/direct/external-source layouts are classified as `OperationalRisk::DictionaryReplace` because they can trigger reload cost, temporary cold-cache, or source access spikes. Simple HASHED replacements are low-risk.
9. **COMMENT clause** — optional `comment` field, rendered as `COMMENT '...'` in DDL.
10. **LIFETIME(0) support** — `lifetime: 0` or `{ min: 0, max: 0 }` for static dictionaries.
11. **Settings escape hatch** — `settings?: Record<string, string | number>` for ClickHouse-specific settings.
12. **Credential masking** — resolved `mooseRuntimeEnv` values must NOT appear in any display surface: plan output, deploy logs, debug dumps, proto snapshots, `moose ls`. All fields that could contain secrets (host, user, password, headers, connection strings, query strings) are masked.
13. **Named Collections: explicit non-goal in v1** — not supported. SDK validates and rejects any Named Collection references with a clear error message and documentation pointing to `mooseRuntimeEnv` as the alternative.
14. **Reality checker boundary** — reconciliation uses `system.dictionaries` for existence/status checks only (dictionary name, database, status, load time). It does NOT attempt full DDL diffing via `SHOW CREATE DICTIONARY` — that is deferred. Mismatches are reported as "dictionary exists but may differ from Moose state."

### Layout types (exhaustive)

All 16 ClickHouse dictionary layouts, grouped by key-type constraint:

**Simple key layouts** (single UInt64 key):
| Layout | Parameters |
|---|---|
| `FLAT` | `initialSize?`, `maxSize?` |
| `HASHED` | `shards?`, `shard_load_queue_backlog?` |
| `SPARSE_HASHED` | `shards?` |
| `HASHED_ARRAY` | (none) |
| `RANGE_HASHED` | `rangeMin: string`, `rangeMax: string` (column names) |
| `CACHE` | `sizeInCells: number` |
| `SSD_CACHE` | `sizeInCells: number`, `path: string`, `blockSize?`, `fileSize?` |
| `DIRECT` | (none) |
| `IP_TRIE` | (none) |

**Complex key layouts** (multi-column / arbitrary type keys):
| Layout | Parameters |
|---|---|
| `COMPLEX_KEY_HASHED` | `shards?` |
| `COMPLEX_KEY_SPARSE_HASHED` | `shards?` |
| `COMPLEX_KEY_HASHED_ARRAY` | (none) |
| `COMPLEX_KEY_RANGE_HASHED` | `rangeMin: string`, `rangeMax: string` |
| `COMPLEX_KEY_CACHE` | `sizeInCells: number` |
| `COMPLEX_KEY_SSD_CACHE` | `sizeInCells: number`, `path: string` |
| `COMPLEX_KEY_DIRECT` | (none) |

Layout-key validation in `plan_validator`: non-complex layouts require exactly one UInt64 primary key; complex layouts allow arbitrary key types and counts.

---

## Rust implementation conventions

All Rust code must mirror existing patterns exactly. The reference types are `MaterializedView` (`materialized_view.rs`) and `Table` (`table.rs`).

**Derives and serde:**
- Core structs: `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]`
- Add `Hash` only when needed for HashMap/HashSet keys
- `#[serde(rename_all = "camelCase")]` on all user-facing types (JSON from TS/Python)
- Every `Option<T>` field: `#[serde(skip_serializing_if = "Option::is_none", default)]`
- Every `Vec<T>` field: `#[serde(default)]`
- Tagged enums: `#[serde(tag = "kind")]` or `#[serde(tag = "type")]`
- Use `#[serde(rename = "type")]` for Rust keyword conflicts

**Struct field ordering:**
1. `name: String`
2. `database: Option<String>`
3. Core domain fields (source, primary_key, columns, layout, lifetime, etc.)
4. `metadata: Option<Metadata>`
5. `life_cycle: LifeCycle`

**Methods (in order within impl block):**
1. `new()` — constructor with `impl Into<String>` params
2. `id(&self, default_database: &str) -> String` — format: `"{database}_{name}"`
3. `quoted_name(&self) -> String` — backtick-quoted `` `db`.`name` ``
4. `to_create_sql(&self) -> String` — infallible, uses `IF NOT EXISTS`
5. `to_drop_sql(&self) -> String` — infallible, uses `IF EXISTS`
6. `short_display(&self) -> String` / `expanded_display(&self) -> String`
7. `to_proto(&self) -> ProtoType` / `from_proto(proto: ProtoType) -> Self`

**Trait implementations:**
- `DataLineage` trait: `pulls_data_from()` and `pushes_data_to()` returning `Vec<InfrastructureSignature>`

**Error handling:**
- No error types in the infrastructure data model layer — these are pure data types, DDL generation is infallible
- Error types only at the execution layer (e.g., `clickhouse/errors.rs`), using `thiserror` with named fields
- Never use `anyhow::Result`

**Tests:**
- Inline `#[cfg(test)] mod tests { use super::*; ... }` at bottom of file
- `test_` prefix with descriptive snake_case names
- Raw struct literals for test data (no builder pattern)
- `assert_eq!` for equality, `assert!` with `.contains()` for SQL string checks
- `.unwrap()` freely in tests, never in production code

**Documentation:**
- `//!` module-level docs at top of file explaining what the module provides
- `///` on all public types, fields, methods, and constants
- Cross-reference related types with backticks

**Clippy:**
- Zero warnings: `cargo clippy --all-targets -- -D warnings`
- Use `#[allow(clippy::large_enum_variant)]` only when justified

---

## Phase 1: Rust CLI — Core Dictionary Type + DDL

### 1.1 New file: `apps/framework-cli/src/framework/core/infrastructure/dictionary.rs`

Create `OlapDictionary` struct with:
- `name`, `database`, `cluster`
- `source: DictionarySource` — enum with variants: `Table { name, database }`, `Query { sql, source_tables }`, `External(ExternalSource)` where `ExternalSource` is a tagged enum with all 12 external types. Dictionary-to-dictionary references are rejected at deserialization.
- `primary_key: Vec<String>`
- `columns: Vec<DictionaryColumn>` — each column carries: `name`, `column_type`, `default_value: Option`, `expression: Option`, `hierarchical: bool`, `injective: bool`, `is_object_id: bool`
- `layout: DictionaryLayout` — tagged enum with all 16 layout types and per-layout parameters (see Layout types section)
- `lifetime: DictionaryLifetime` — enum: `Static` (LIFETIME(0)), `Single(u64)`, `Range { min: u64, max: u64 }`
- `invalidate: Option<DictionaryInvalidation>`
- `settings: Option<HashMap<String, String>>`
- `comment: Option<String>`
- `life_cycle`, `metadata`

Proto modeling: `source`, `layout`, and `lifetime` must be modeled as nested `oneof` messages in the proto schema, not flattened optional fields. This ensures proper round-trip serialization without losing variant information or producing false diffs on restart.

Implement:
- `to_create_sql()` → `CREATE OR REPLACE DICTIONARY \`db\`.\`name\` [ON CLUSTER \`cluster\`] (...) [COMMENT '...']` — uses `CREATE OR REPLACE` for atomic swap (zero downtime). Follows the same conditional `ON CLUSTER` pattern as OlapTable.
- `to_create_if_not_exists_sql()` → `CREATE DICTIONARY IF NOT EXISTS ...` — for initial deployment only
- `to_drop_sql()` → `DROP DICTIONARY IF EXISTS \`db\`.\`name\` [ON CLUSTER \`cluster\`]` — same conditional cluster inclusion
- `DataLineage` trait (pulls from source table)
- `id()` method → `"{database}_{name}"`
- Unit tests for DDL generation (all layout types, invalidation, defaults, cluster)

### 1.2 Modify: `apps/framework-cli/src/framework/core/infrastructure/mod.rs`

- Add `pub mod dictionary;`
- Add `Dictionary { id: String }` variant to `InfrastructureSignature`

### 1.3 Modify: `apps/framework-cli/src/framework/core/infrastructure_map.rs`

- Add `pub dictionaries: HashMap<String, Dictionary>` to `InfrastructureMap`
- Add `diff_dictionaries()` method (Added → `CREATE IF NOT EXISTS`, Removed → `DROP IF EXISTS`, Updated → `CREATE OR REPLACE`)
- Call from main `diff_with_table_strategy()`
- Add `Dictionary(Change<Dictionary>)` variant to `OlapChange`
- Unit tests for diff: added, removed, updated, unchanged

### 1.4 Modify: `apps/framework-cli/src/framework/core/partial_infrastructure_map.rs`

- Add `dictionaries` field to `PartialInfrastructureMap`
- Copy into full `InfrastructureMap` in `into_infra_map()`

### 1.5 Modify: DDL ordering (`apps/framework-cli/src/infrastructure/olap/ddl_ordering.rs`)

- Add `CreateDictionary`, `ReplaceDictionary`, and `DropDictionary` to `AtomicOlapOperation`
- Add source-side dependency edges: dictionary created after source table, dropped before source table
- Add consumer-side dependency edges: when a View/MV SQL references a dictionary (via `sql` tag interpolation recorded as `InfrastructureSignature::Dictionary`), the dictionary must be created/replaced before the dependent View/MV is created/replaced. This ensures a dictionary and MV introduced in the same plan are ordered correctly.
- Reject cycles: if a View sources a dictionary that sources back to that View, emit a clear error at plan time

### 1.6 Modify: ClickHouse execution (`apps/framework-cli/src/infrastructure/olap/clickhouse/mod.rs`)

- Add match arms for `CreateDictionary`/`DropDictionary` in `execute_changes`
- Add `list_dictionaries()` for introspection via `system.dictionaries`

### 1.7 Modify: Lifecycle filter (`apps/framework-cli/src/framework/core/lifecycle_filter.rs`)

- Add dictionary lifecycle filtering (DELETION_PROTECTED blocks DROP, EXTERNALLY_MANAGED blocks all)

### 1.8 Modify: Plan risk assessment (`apps/framework-cli/src/framework/core/plan_risk.rs`)

- Add `DestructiveChange::DictionaryDrop` variant for removals — breaks any `dictGet()` queries referencing it
- Add `OperationalRisk::DictionaryReplace` variant for updates — `CREATE OR REPLACE` triggers reload. For `CACHE`/`DIRECT`/external-source layouts, this can cause temporary cold-cache behavior or source access spikes. Simple `HASHED` replacements are lower risk.
- Handle both `Change::Removed` and `Change::Updated` in `classify_plan_risk()` — currently the wildcard `_ => {}` silently skips both

### 1.9 Modify: Runtime env credential resolution (`apps/framework-cli/src/framework/core/infrastructure_map.rs`)

- Extend `resolve_runtime_credentials_from_env()` (~line 2551) to iterate over `self.dictionaries.values_mut()` and resolve `__MOOSE_RUNTIME_ENV__:` markers in ALL string fields that could contain secrets: host, user, password, headers, connection strings, query strings, URLs
- Add credential masking to all display surfaces that serialize infra objects: plan display, verbose deploy logs, debug dumps, `moose ls`. Any resolved `__MOOSE_RUNTIME_ENV__:` value must be masked as `***` in output.
- Without env resolution, `mooseRuntimeEnv.get()` markers in dictionary source configs would not be resolved at runtime → ClickHouse errors

### 1.10 Modify: Plan validator (`apps/framework-cli/src/framework/core/plan_validator.rs`)

- Validate that dictionary source table references exist in the target InfrastructureMap
- Validate that `primaryKey` column names are valid columns in the dictionary schema
- Validate layout-key compatibility: non-`COMPLEX_KEY_*` layouts require exactly one UInt64 primary key; `COMPLEX_KEY_*` layouts allow arbitrary key types and counts
- Validate cluster references for dictionaries (same pattern as tables)
- Reject dictionary-to-dictionary sources (not supported in v1)
- Reject Named Collection references in any source config

### 1.11 Modify: SQL normalization (`apps/framework-cli/src/framework/core/plan.rs`)

- Extend `normalize_infra_map_for_comparison()` (~line 102) to normalize SQL in dictionary source configs (when source is a SQL query) — prevents false diffs from whitespace/formatting differences

### 1.12 Modify: `moose ls` (`apps/framework-cli/src/cli/routines/ls.rs`)

- Add `dictionaries` field to `ResourceListing` struct
- Add display logic for dictionaries in the `moose ls` output

### 1.13 Modify: `OlapOperations` trait (`apps/framework-cli/src/infrastructure/olap/mod.rs`)

- Add `list_dictionaries()` method to the trait — queries `system.dictionaries` for existence/status checks (name, database, status, origin, loading_duration). Does NOT attempt full DDL comparison via `SHOW CREATE DICTIONARY` — that is complex and deferred. Mismatches reported as "dictionary exists but may differ from Moose state."

### 1.14 Modify: Init deployment (`apps/framework-cli/src/framework/core/infrastructure_map.rs`)

- Chain dictionaries into `init_tables()` (~line 739) so they are created on first-time deployment
- Must come after source tables in the chain

### 1.15 Modify: Proto file + state persistence (`packages/protobuf/infrastructure_map.proto`)

- `packages/protobuf/infrastructure_map.proto`:
  - Add `message OlapDictionary { ... }` with all fields
  - `source` as `oneof` with variants: `DictionarySourceTable`, `DictionarySourceQuery`, `DictionaryExternalSource` (which itself uses `oneof` for the 12 external types)
  - `layout` as `oneof` with variants for all 16 layout types, each carrying its specific parameters
  - `lifetime` as `oneof`: `uint64 static_lifetime = N` (for LIFETIME(0)), `uint64 single_lifetime = N`, `DictionaryLifetimeRange range_lifetime = N`
  - `DictionaryColumn` message with: name, type, default_value, expression, hierarchical, injective, is_object_id
  - Add `map<string, OlapDictionary> olap_dictionaries = <next_field_number>;` to `InfrastructureMap` message
  - Add `string olap_dictionary_id = <next_field_number>;` to `InfrastructureSignature` oneof
  - **Round-trip tests**: every source variant × every layout variant must survive TS/Python → Rust → proto → Rust without information loss or false diffs
- `apps/framework-cli/src/framework/core/infrastructure/mod.rs`:
  - Add `OlapDictionary { id: String }` variant to `InfrastructureSignature` enum
  - Add `to_proto()` and `from_proto()` arms for the new variant
- `apps/framework-cli/src/framework/core/infrastructure_map.rs`:
  - Add `to_proto()` serialization for dictionaries (~line 2830)
  - Add `from_proto()` deserialization for dictionaries (~line 3000)
- `apps/framework-cli/src/mcp/compressed_map.rs`:
  - Add `add_olap_dictionaries()` to `build_compressed_map()`

**Why this is required in v1**: Without proto updates, dictionaries are silently lost on state persistence (to_proto drops them), causing every restart to re-create them. The failure is runtime data loss, not a build error.

### 1.16 Modify: Plan + reconciliation

- `plan.rs` — add `dictionary_ids` to `ReconciliationFilter`
- `infra_reality_checker.rs` — add dictionary reconciliation + `InfraDiscrepancies` fields (`unmapped_dictionaries`, `missing_dictionaries`, `mismatched_dictionaries`) + update `is_empty()`
- `display/mod.rs` — add plan display formatting for dictionary changes

---

## Phase 2: TypeScript SDK

### 2.1 New file: `packages/ts-moose-lib/src/dmv2/sdk/olapDictionary.ts`

```typescript
class OlapDictionary<T> {
  constructor(config: OlapDictionaryConfig<T>, schema?, columns?)
  get(attr: keyof T, ...keys: (Sql|string|number)[]): Sql
  getOrDefault(attr: keyof T, defaultVal: Sql|string|number, ...keys: (Sql|string|number)[]): Sql
  has(...keys: (Sql|string|number)[]): Sql  // → dictHas('db.dict', key)
}
```

Config includes: `name`, source (exactly one of: `sourceTable: OlapTable | View`, `sourceQuery: Sql` + required `sourceTables: (OlapTable | View)[]`, or `externalSource: ExternalSourceConfig`), `primaryKey`, `layout` (typed union — all 16 layouts), `lifetime`, `invalidate?`, `defaults?`, `settings?`, `comment?`, `database?`, `cluster?`, `lifeCycle?`

Validation at registration: exactly one source field set, layout-key compatibility checked, Named Collection references rejected, dictionary-to-dictionary sources rejected.

Self-registers into `getMooseInternal().olapDictionaries`.

### 2.2 Modify: `packages/ts-moose-lib/src/dmv2/internal.ts`

- Add `olapDictionaries` to registry type and initialization
- Add serialization block for olap dictionaries

### 2.3 Modify: `packages/ts-moose-lib/src/dmv2/dataModelMetadata.ts`

- Add `["OlapDictionary", 1]` to `typesToArgsLength` (1 user arg before injected schema+columns)

### 2.4 Modify: `packages/ts-moose-lib/src/sqlHelpers.ts`

- Add OlapDictionary interpolation support in `sql` template tag
- When a dictionary `get()`/`getOrDefault()`/`has()` call is interpolated into a `sql` template, the dictionary reference must be recorded as a dependency (same mechanism used for OlapTable/View references). This enables consumer-side dependency tracking: a MV/View whose SQL includes `${dict.get(...)}` automatically depends on that dictionary for DDL ordering.

### 2.5 Modify export chain

- `dmv2/index.ts`, `browserCompatible.ts` — export OlapDictionary + types

### 2.6 Unit tests: `packages/ts-moose-lib/src/__tests__/dictionary.test.ts`

- Construction, validation, registration, serialization
- `get()`, `getOrDefault()`, `has()` SQL fragment generation
- Duplicate name rejection
- Layout validation (all 16 types)
- Source validation: exactly one source field, reject zero/multiple
- Named Collection reference rejected with clear error
- Dictionary-to-dictionary source rejected
- Layout-key compatibility validation

---

## Phase 3: Python SDK

### 3.1 New file: `packages/py-moose-lib/moose_lib/dmv2/olap_dictionary.py`

Follows the existing `OlapTable`/`MaterializedView` patterns exactly.

**Config model (`OlapDictionaryConfig`):**

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional, Union
from moose_lib.dmv2.olap_table import OlapTable
from moose_lib.dmv2.view import View

class DictionaryColumn(BaseModel):
    """Per-column attributes for dictionary columns."""
    model_config = ConfigDict(extra="forbid")
    default: Optional[str] = None
    expression: Optional[str] = None
    hierarchical: bool = False
    injective: bool = False
    is_object_id: bool = False

class DictionaryLifetime(BaseModel):
    """LIFETIME(MIN x MAX y) or LIFETIME(x) or LIFETIME(0) for static."""
    model_config = ConfigDict(extra="forbid")
    min: int = 0
    max: int = 0

class DictionaryInvalidation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    column: str
    fn: str  # e.g., "max"

# --- Layout types (discriminated union) ---
class FlatLayout(BaseModel):
    type: Literal["FLAT"] = "FLAT"
    initial_size: Optional[int] = None
    max_size: Optional[int] = None

class HashedLayout(BaseModel):
    type: Literal["HASHED"] = "HASHED"
    shards: Optional[int] = None

class ComplexKeyHashedLayout(BaseModel):
    type: Literal["COMPLEX_KEY_HASHED"] = "COMPLEX_KEY_HASHED"
    shards: Optional[int] = None

class CacheLayout(BaseModel):
    type: Literal["CACHE"] = "CACHE"
    size_in_cells: int

class RangeHashedLayout(BaseModel):
    type: Literal["RANGE_HASHED"] = "RANGE_HASHED"
    range_min: str
    range_max: str
# ... (all 16 layouts follow the same pattern)

DictionaryLayout = Union[
    FlatLayout, HashedLayout, ComplexKeyHashedLayout, CacheLayout,
    RangeHashedLayout, # ... all 16 types
]

# --- External source types (discriminated union) ---
class MongoDbSource(BaseModel):
    type: Literal["mongodb"] = "mongodb"
    host: str
    port: int = 27017
    user: str
    password: str
    db: str
    collection: str

class MySqlSource(BaseModel):
    type: Literal["mysql"] = "mysql"
    host: str
    port: int = 3306
    user: str
    password: str
    db: str
    table: Optional[str] = None
    query: Optional[str] = None
# ... (all 12 external source types)

ExternalSource = Union[MongoDbSource, MySqlSource, ...]  # discriminated on "type"

class OlapDictionaryConfig(BaseModel):
    """User-facing config for OlapDictionary."""
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    # Source — exactly one must be set (validated in model_post_init)
    source_table: Optional[Union[OlapTable, View]] = None
    source_query: Optional[str] = None  # SQL string (from sql helper)
    source_tables: Optional[list[Union[OlapTable, View]]] = None  # required with source_query
    external_source: Optional[ExternalSource] = None

    primary_key: list[str]
    layout: DictionaryLayout
    lifetime: Union[int, DictionaryLifetime] = DictionaryLifetime(min=0, max=0)
    invalidate: Optional[DictionaryInvalidation] = None
    columns: Optional[dict[str, DictionaryColumn]] = None  # per-column attributes
    defaults: Optional[dict[str, Union[str, int, float]]] = None
    settings: Optional[dict[str, Union[str, int]]] = None
    comment: Optional[str] = None
    database: Optional[str] = None
    cluster: Optional[str] = None
    life_cycle: Optional[LifeCycle] = None
    metadata: Optional[dict] = None

    def model_post_init(self, __context):
        # Validate exactly one source field is set
        sources = [self.source_table, self.source_query, self.external_source]
        set_count = sum(1 for s in sources if s is not None)
        if set_count != 1:
            raise ValueError("Exactly one of source_table, source_query, or external_source must be set")
        if self.source_query and not self.source_tables:
            raise ValueError("source_tables is required when using source_query")
```

**Class definition:**

```python
from moose_lib.dmv2.types import BaseTypedResource
from moose_lib.dmv2._registry import _olap_dictionaries

class OlapDictionary(BaseTypedResource, Generic[T]):
    kind: str = "OlapDictionary"

    def __init__(self, name: str, config: OlapDictionaryConfig, **kwargs):
        t = self._get_type(kwargs)
        self._set_type(name, t)
        self.name = name
        self.config = config
        self._column_list = _to_columns(t)
        self.life_cycle = config.life_cycle
        self.metadata = {**(config.metadata or {}), "source": get_source_file_from_stack()}

        # Format source tables for serialization
        if config.source_table:
            self.source_tables = [_format_table_reference(config.source_table)]
        elif config.source_tables:
            self.source_tables = [_format_table_reference(t) for t in config.source_tables]
        else:
            self.source_tables = []

        # Register with duplicate check
        if name in _olap_dictionaries:
            raise ValueError(f"OlapDictionary '{name}' already registered")
        _olap_dictionaries[name] = self

    def get(self, attr: str, *keys) -> str:
        """Generate dictGet SQL fragment.
        Returns: dictGet('db.dict_name', 'attr', key1, key2, ...)
        """
        db = self.config.database or "local"
        key_args = ", ".join(str(k) for k in keys)
        return f"dictGet('{db}.{self.name}', '{attr}', {key_args})"

    def get_or_default(self, attr: str, default, *keys) -> str:
        """Generate dictGetOrDefault SQL fragment."""
        db = self.config.database or "local"
        key_args = ", ".join(str(k) for k in keys)
        return f"dictGetOrDefault('{db}.{self.name}', '{attr}', {key_args}, {default})"

    def has(self, *keys) -> str:
        """Generate dictHas SQL fragment."""
        db = self.config.database or "local"
        key_args = ", ".join(str(k) for k in keys)
        return f"dictHas('{db}.{self.name}', {key_args})"
```

**Usage example:**

```python
from moose_lib import OlapTable, OlapDictionary, OlapDictionaryConfig, OlapConfig
from moose_lib import HashedLayout, ComplexKeyHashedLayout, DictionaryLifetime
from moose_lib import moose_runtime_env
from pydantic import BaseModel

# 1. Source table
class Product(BaseModel):
    product_id: str
    product_name: str
    category: str
    price_level: int

products_table = OlapTable[Product](
    name="products",
    config=OlapConfig(order_by_fields=["product_id"]),
)

# 2a. Simple case — direct table reference
class ProductLookup(BaseModel):
    product_id: str
    product_name: str
    category: str

product_dict = OlapDictionary[ProductLookup](
    name="dict_products",
    config=OlapDictionaryConfig(
        source_table=products_table,
        primary_key=["product_id"],
        layout=HashedLayout(),
        lifetime=DictionaryLifetime(min=10, max=15),
        defaults={"category": "Unknown"},
    ),
)

# 2b. External source with secure credentials
class MongoProduct(BaseModel):
    product_id: str
    product_name: str

mongo_dict = OlapDictionary[MongoProduct](
    name="dict_mongo_products",
    config=OlapDictionaryConfig(
        external_source=MongoDbSource(
            host="mongo.example.com",
            port=27017,
            user=moose_runtime_env.get("MONGO_USER"),
            password=moose_runtime_env.get("MONGO_PASSWORD"),
            db="catalog",
            collection="products",
        ),
        primary_key=["product_id"],
        layout=HashedLayout(),
        lifetime=DictionaryLifetime(min=300, max=360),
    ),
)

# 3. Use in MV
f"""
  SELECT
    click_id,
    {product_dict.get("product_name", "product_id")} AS product_name,
    {product_dict.get("category", "product_id")} AS category
  FROM raw_clicks
"""
```

### 3.2 Modify: `packages/py-moose-lib/moose_lib/dmv2/_registry.py`

- Add `_olap_dictionaries: Dict[str, Any] = {}`

### 3.3 Modify: `packages/py-moose-lib/moose_lib/dmv2/registry.py`

- Add `get_olap_dictionaries() -> Dict[str, OlapDictionary]` accessor function
- Add `get_olap_dictionary(name: str) -> OlapDictionary` accessor function

### 3.4 Modify: `packages/py-moose-lib/moose_lib/internal.py`

Add serialization model and conversion:

```python
class OlapDictionaryJson(BaseModel):
    """Serialization model for OlapDictionary → JSON → Rust CLI."""
    model_config = ConfigDict(
        alias_generator=AliasGenerator(serialization_alias=to_camel)
    )
    name: str
    database: Optional[str] = None
    cluster: Optional[str] = None
    source: dict  # serialized source config
    primary_key: list[str]
    columns: list[dict]  # serialized column definitions
    layout: dict  # serialized layout config
    lifetime: Union[int, dict]
    invalidate: Optional[dict] = None
    defaults: Optional[dict] = None
    settings: Optional[dict] = None
    comment: Optional[str] = None
    metadata: Optional[dict] = None
    life_cycle: str = "FULLY_MANAGED"
```

Add to `InfrastructureMap`:
```python
class InfrastructureMap(BaseModel):
    # ... existing fields ...
    olap_dictionaries: dict[str, OlapDictionaryJson]
```

Add conversion in `to_infra_map()`:
```python
olap_dictionaries = {}
for name, d in get_olap_dictionaries().items():
    olap_dictionaries[name] = OlapDictionaryJson(
        name=d.name,
        database=d.config.database,
        cluster=d.config.cluster,
        source=_serialize_dict_source(d.config),
        primary_key=d.config.primary_key,
        columns=_serialize_dict_columns(d._column_list, d.config.columns),
        layout=d.config.layout.model_dump(),
        lifetime=_serialize_lifetime(d.config.lifetime),
        invalidate=d.config.invalidate.model_dump() if d.config.invalidate else None,
        defaults=d.config.defaults,
        settings=d.config.settings,
        comment=d.config.comment,
        metadata=d.metadata,
        life_cycle=(d.life_cycle.value if d.life_cycle else "FULLY_MANAGED"),
    )
```

### 3.5 Modify export chain

- `dmv2/__init__.py` — export `OlapDictionary`, `OlapDictionaryConfig`, all layout types, all external source types, `DictionaryColumn`, `DictionaryLifetime`, `DictionaryInvalidation`, `get_olap_dictionaries`
- `moose_lib/__init__.py` — re-export all of the above

### 3.6 Unit tests: `packages/py-moose-lib/tests/test_olap_dictionary.py`

- Construction with all three source types
- Source validation: exactly one source field, reject zero/multiple
- Registration + duplicate rejection
- `get()`, `get_or_default()`, `has()` SQL fragment generation
- Composite key tuple wrapping
- Layout validation (all 16 types)
- Layout-key compatibility (non-complex requires single key)
- Named Collection reference rejected
- Dictionary-to-dictionary source rejected
- Serialization round-trip via `OlapDictionaryJson`
- `moose_runtime_env` marker strings in external source credentials

---

## Phase 4: E2E Tests + Documentation

### 4.1 E2E tests (in `templates/typescript-tests` and `templates/python-tests`)

- Create OlapTable + OlapDictionary → verify `moose plan` shows creation
- Modify dictionary layout → verify plan shows CREATE OR REPLACE
- Remove dictionary → verify plan shows removal + destructive warning
- Lifecycle: DELETION_PROTECTED blocks removal
- `dictGet` usage in a View/MV
- `dictHas` usage
- `LIFETIME(0)` static dictionary — verify DDL has `LIFETIME(0)`
- `COMPLEX_KEY_HASHED` with composite keys — verify tuple wrapping in dictGet
- Cross-database dictGet — verify `database.dict_name` prefix
- Invalidation: update source table → verify dictionary reflects new data after LIFETIME expires
- Dictionary + MV created in same plan → verify correct ordering (dictionary before MV)
- Dictionary replacement while dependent MV remains intact
- Per-column attributes round-trip (INJECTIVE, HIERARCHICAL, EXPRESSION, IS_OBJECT_ID)
- External-source secrets masked in plan/deploy output
- Proto round-trip: every source/layout variant survives serialize → deserialize without loss
- Normalization stability: semantically identical source queries produce same diff result
- Missing credentials at deploy time → clear error message
- Invalid key/layout combination rejected at plan time before DDL

### 4.2 Documentation (`apps/framework-docs-v2/`)

- **SDK reference page** for `OlapDictionary` (TS + Python):
  - Constructor signature, `OlapDictionaryConfig` type definition
  - `OlapDictionaryLayout` union with all layout variants and their parameters
  - `OlapDictionarySource` union with all source types
  - `get()` and `getOrDefault()` helper methods
  - Lifecycle management options
- **Source type examples** — one complete code example per supported source type:
  - ClickHouse (OlapTable reference)
  - ClickHouse (View reference)
  - ClickHouse (sql template query)
  - ClickHouse (remote — host/port/credentials)
  - HTTP(S) (url, format, credentials, headers)
  - MySQL (host, port, credentials, table/query, replicas)
  - PostgreSQL (host, port, credentials, table/query, replicas)
  - MongoDB (host, port, credentials, db, collection)
  - Redis (host, port, storage_type)
  - Cassandra (host, port, keyspace, column_family)
  - ODBC (connection_string, db, table)
  - File (path, format)
  - Executable (command, format)
  - Executable Pool (command, format, pool_size)
  - Null
- **Tutorial**: "Using OlapDictionary for fast ClickHouse lookups" — end-to-end walkthrough: define source table, create dictionary, use `dictGet` in a MaterializedView
- **Migration guide**: "Migrating existing ClickHouse dictionaries to Moose" — shows how to bring existing infrastructure under Moose's type system using `lifeCycle: "EXTERNALLY_MANAGED"` for pre-existing tables while letting Moose manage the dictionary. Key example:
  ```typescript
  // Pre-existing table — Moose won't create/drop/modify it
  export const PartitionStrategiesSource = new OlapTable<PartitionStrategy>(
    "partition_strategies_source",
    { orderByFields: ["name"], lifeCycle: "EXTERNALLY_MANAGED" }
  );

  // Moose-managed dictionary referencing the external table
  export const PartitionStrategies = new OlapDictionary<PartitionStrategy>(
    "partition_strategies",
    {
      sourceTable: PartitionStrategiesSource,
      primaryKey: ["name"],
      layout: { type: "COMPLEX_KEY_HASHED" },
      lifetime: { min: 60, max: 300 },
      defaults: { strategy: "WEEK" },
    }
  );

  // Type-safe dictGet in MV CTEs — replaces raw dictGetOrDefault() calls
  sql`WITH ${PartitionStrategies.getOrDefault("strategy", "WEEK", sql`tuple(table_name)`)} AS partition_strategy
      SELECT ...`
  ```
  Highlights: replaces Named Collection indirection, eliminates raw SQL, adds dependency tracking and type safety. Covers the three lifeCycle modes and when to use each.
- **Known limitation note** in docs: Dictionary dependencies are only tracked when using the typed `.get()`/`.getOrDefault()`/`.has()` helpers via the `sql` template tag. When using raw `dictGet('dict_name', ...)` in SQL strings, the dictionary is NOT auto-registered as a dependency. Users should always prefer the typed helpers for correct DDL ordering and drop safety.
- Update SDK overview / primitives listing page
- Update ClickHouse best practices if relevant

---

## Deferred (follow-up PRs)

- `moose db pull` introspection for dictionaries (complex `system.dictionaries` / `SHOW CREATE DICTIONARY` parsing)
- Environment-aware source config (belongs in Moose's env system, not Dictionary-specific)
- Automatic `dictGet` dependency detection in View/MV SQL strings (cycle detection for dictionary↔view circular references)
- **Full DDL reconciliation via `SHOW CREATE DICTIONARY`** — currently reality checker only does existence/status checks. Full DDL comparison for exact diffing is complex and deferred.
- **Connection test during plan phase** — for external sources (MySQL, PostgreSQL, HTTP, etc.), optionally test connectivity during `moose plan` rather than waiting for ClickHouse to fail at CREATE time
- **Typed dictGet variants** — `dictGetUInt32`, `dictGetFloat64`, etc. for type-specific lookups. For v1, `get()` uses the generic `dictGet` which auto-casts.
- **ClickHouse Named Collections** — server-side credential store (`CREATE NAMED COLLECTION ... AS key1='val1', ...`). Would allow referencing credentials by collection name in DDL instead of embedding resolved values. For v1, `mooseRuntimeEnv` covers the same security need via environment variables. Named Collections could be added as an optional Moose-managed primitive in a follow-up if users request it.

---

## Verification

1. **Unit tests**: `cargo test --package moose-cli`, `cd packages/ts-moose-lib && pnpm test`, `cd packages/py-moose-lib && pytest`
2. **Lint**: `cargo clippy --all-targets -- -D warnings`
3. **E2E**: `cd apps/framework-cli-e2e && pnpm test`
4. **Manual**: Init a test project in /tmp, define an OlapTable + OlapDictionary, run `moose plan`, verify DDL output

## Key files to modify

| Layer | File | Purpose |
|-------|------|---------|
| Rust | `infrastructure/dictionary.rs` (NEW) | Core type + DDL |
| Rust | `infrastructure/mod.rs` | Module + signature enum |
| Rust | `infrastructure_map.rs` | HashMap + diff |
| Rust | `partial_infrastructure_map.rs` | JSON deserialization |
| Rust | `ddl_ordering.rs` | Atomic ops + dependency graph |
| Rust | `clickhouse/mod.rs` | Execution + introspection |
| Rust | `lifecycle_filter.rs` | Lifecycle enforcement |
| Rust | `plan_risk.rs` | Destructive change classification |
| Rust | `plan.rs` | Reconciliation filter + SQL normalization |
| Rust | `plan_validator.rs` | Source table + column validation |
| Rust | `infra_reality_checker.rs` | Reality checking + discrepancies |
| Rust | `cli/routines/ls.rs` | `moose ls` dictionary listing |
| Rust | `olap/mod.rs` | `OlapOperations` trait — `list_dictionaries()` |
| Proto | `packages/protobuf/infrastructure_map.proto` | State persistence schema |
| Rust | `mcp/compressed_map.rs` | MCP compressed map |
| TS | `dmv2/sdk/olapDictionary.ts` (NEW) | SDK class |
| TS | `dmv2/internal.ts` | Registry + serialization |
| TS | `dmv2/dataModelMetadata.ts` | Compiler plugin registration |
| TS | `sqlHelpers.ts` | `sql` tag interpolation |
| TS | `dmv2/index.ts`, `browserCompatible.ts` | Exports |
| Python | `dmv2/olap_dictionary.py` (NEW) | SDK class |
| Python | `dmv2/_registry.py` | Registry |
| Python | `internal.py` | Serialization |
| Python | `dmv2/__init__.py`, `__init__.py` | Exports |
