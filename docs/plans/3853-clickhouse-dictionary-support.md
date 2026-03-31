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
  source: ProductsTable,          // OlapTable | View reference
  primaryKey: ["ProductId"],
  layout: { type: "HASHED" },
  lifetime: { min: 10, max: 15 },
  invalidate: { column: "version", fn: "max" },
  defaults: { Category: "Unknown", PriceLevel: 0 },
});

// 2b. Complex case — sql template with typed table/column interpolation
//     Generates: SOURCE(CLICKHOUSE(QUERY 'SELECT ... FROM `local`.`products` FINAL'))
export const ProductDictComplex = new OlapDictionary<ProductLookup>("dict_products_v2", {
  source: sql`SELECT ProductId, ProductName, Category, PriceLevel FROM ${ProductsTable} FINAL`,
  sourceTables: [ProductsTable],  // explicit dependency tracking (same pattern as MV/View)
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

### Source config behavior

**ClickHouse sources (typed Moose references):**

| `source` value | `sourceTables` | DDL generated |
|---|---|---|
| `OlapTable` ref | Not needed (auto-extracted) | `SOURCE(CLICKHOUSE(TABLE 'name' DB 'db'))` |
| `View` ref | Not needed (auto-extracted) | `SOURCE(CLICKHOUSE(TABLE 'name' DB 'db'))` |
| `` sql`SELECT ...` `` | Required (explicit) | `SOURCE(CLICKHOUSE(QUERY 'SELECT ...'))` |

**All supported source types (typed discriminated union):**

| Source type | Key parameters |
|---|---|
| ClickHouse (typed ref) | `OlapTable \| View` — auto-extracts table/db |
| ClickHouse (SQL query) | `Sql \| string` + explicit `sourceTables` |
| ClickHouse (remote) | host, port, user, password, db, table/query, where, secure, invalidateQuery |
| HTTP(S) | url, format, credentials (user/password), headers |
| MySQL | host, port, user, password, db, table/query, where, replicas, invalidateQuery |
| PostgreSQL | host, port, user, password, db, table/query, where, replicas, invalidateQuery |
| MongoDB | host, port, user, password, db, collection |
| Redis | host, port, dbIndex, password, storageType |
| Cassandra | host, port, user, password, keyspace, columnFamily |
| ODBC | connectionString, db, table/query |
| File | path, format |
| Executable | command, format |
| Executable Pool | command, format, poolSize |
| Null | (none) |

Only ClickHouse `OlapTable`/`View`/`Sql` sources participate in Moose dependency tracking. External sources have no Moose-managed dependencies.

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
  source: {
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
  source: {
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
  source: {
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

### Key design decisions (from critique of the original issue)

1. **Flexible source config** — `source` accepts `OlapTable | View` for typed ClickHouse table references, `Sql | string` for custom ClickHouse queries (with typed interpolation via the `sql` template tag), or external source configs (`{ type: "mysql", ... }`, `{ type: "http", ... }`, etc.) for all 12 ClickHouse-supported source types. When source is a SQL query, explicit `sourceTables` is required for dependency tracking. External sources have no Moose-managed dependencies.
2. **Typed layout config** — not a plain string. A discriminated union with per-layout parameters (e.g., `CACHE` has `sizeInCells`, `RANGE_HASHED` has `range_min`/`range_max`). Supports `HIERARCHICAL` attribute flag on columns.
3. **`dictGet` helper** — typed methods on `OlapDictionary` instances for use in `sql` template tags: `get()`, `getOrDefault()`, and `has()`. The helper correctly prefixes with `database.dict_name` for cross-database usage.
4. **Key/attribute column distinction** — `primaryKey` identifies key columns; attribute columns can have `defaults` for missing key lookups.
5. **Dependency tracking** — source table reference automatically tracked (same as MV/View pattern).
6. **Atomic swap diffing** — uses `CREATE OR REPLACE DICTIONARY` (supported in modern ClickHouse) for zero-downtime updates. This prevents the "blackout" period where `dictGet()` calls would fail during a DROP + CREATE cycle. Dependent materialized views and queries continue to work during dictionary updates.
7. **COMMENT clause** — optional `comment` field on the dictionary config, rendered as `COMMENT '...'` in DDL. Useful for data discovery and catalogs.
8. **LIFETIME(0) support** — `lifetime: 0` or `lifetime: { min: 0, max: 0 }` represents a static dictionary that never auto-refreshes, common for "gold" reference data.
9. **Settings escape hatch** — `settings?: Record<string, string | number>` for power users who need ClickHouse-specific settings (e.g., `backoff_initial_interval`, `loading_cells_bundle_size`).
10. **Credential safety** — resolved `mooseRuntimeEnv` values must NOT be logged during `moose plan` or `moose deploy --verbose`. Mask any `__MOOSE_RUNTIME_ENV__:` resolved values in CLI output.

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

Create `OlapDictionary` struct with: `name`, `database`, `cluster`, `source` (discriminated union), `primary_key`, `columns: Vec<DictionaryColumn>` (with optional `HIERARCHICAL` flag), `layout: DictionaryLayout` (tagged enum — includes `RANGE_HASHED` with `range_min`/`range_max`), `lifetime: DictionaryLifetime` (untagged enum: single number or {min, max}, allowing 0 for static), `invalidate: Option<DictionaryInvalidation>`, `defaults`, `settings: Option<HashMap<String, String>>`, `comment: Option<String>`, `life_cycle`, `metadata`.

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
- Add `diff_dictionaries()` method (Added/Removed/Updated as DROP+CREATE)
- Call from main `diff_with_table_strategy()`
- Add `Dictionary(Change<Dictionary>)` variant to `OlapChange`
- Unit tests for diff: added, removed, updated, unchanged

### 1.4 Modify: `apps/framework-cli/src/framework/core/partial_infrastructure_map.rs`

- Add `dictionaries` field to `PartialInfrastructureMap`
- Copy into full `InfrastructureMap` in `into_infra_map()`

### 1.5 Modify: DDL ordering (`apps/framework-cli/src/infrastructure/olap/ddl_ordering.rs`)

- Add `CreateDictionary` and `DropDictionary` to `AtomicOlapOperation`
- Add dependency edges: dictionary created after source table, dropped before source table

### 1.6 Modify: ClickHouse execution (`apps/framework-cli/src/infrastructure/olap/clickhouse/mod.rs`)

- Add match arms for `CreateDictionary`/`DropDictionary` in `execute_changes`
- Add `list_dictionaries()` for introspection via `system.dictionaries`

### 1.7 Modify: Lifecycle filter (`apps/framework-cli/src/framework/core/lifecycle_filter.rs`)

- Add dictionary lifecycle filtering (DELETION_PROTECTED blocks DROP, EXTERNALLY_MANAGED blocks all)

### 1.8 Modify: Plan risk assessment (`apps/framework-cli/src/framework/core/plan_risk.rs`)

- Add `DestructiveChange::DictionaryDrop` variant
- Handle `OlapChange::Dictionary(Change::Removed(...))` in `classify_plan_risk()` — currently a wildcard `_ => {}` would silently skip dictionary drops
- Dropping a dictionary is destructive: it breaks any `dictGet()` queries referencing it

### 1.9 Modify: Runtime env credential resolution (`apps/framework-cli/src/framework/core/infrastructure_map.rs`)

- Extend `resolve_runtime_credentials_from_env()` (~line 2551) to iterate over `self.dictionaries.values_mut()` and resolve `__MOOSE_RUNTIME_ENV__:` markers in external source configs (host, user, password, etc.)
- Without this, `mooseRuntimeEnv.get()` markers in dictionary source configs would not be resolved at runtime → ClickHouse errors

### 1.10 Modify: Plan validator (`apps/framework-cli/src/framework/core/plan_validator.rs`)

- Validate that dictionary source table references exist in the target InfrastructureMap
- Validate that `primaryKey` column names are valid columns in the dictionary schema
- Validate cluster references for dictionaries (same pattern as tables)

### 1.11 Modify: SQL normalization (`apps/framework-cli/src/framework/core/plan.rs`)

- Extend `normalize_infra_map_for_comparison()` (~line 102) to normalize SQL in dictionary source configs (when source is a SQL query) — prevents false diffs from whitespace/formatting differences

### 1.12 Modify: `moose ls` (`apps/framework-cli/src/cli/routines/ls.rs`)

- Add `dictionaries` field to `ResourceListing` struct
- Add display logic for dictionaries in the `moose ls` output

### 1.13 Modify: `OlapOperations` trait (`apps/framework-cli/src/infrastructure/olap/mod.rs`)

- Add `list_dictionaries()` method to the trait for reality checking via `system.dictionaries`

### 1.14 Modify: Init deployment (`apps/framework-cli/src/framework/core/infrastructure_map.rs`)

- Chain dictionaries into `init_tables()` (~line 739) so they are created on first-time deployment
- Must come after source tables in the chain

### 1.15 Modify: Proto file + state persistence (`packages/protobuf/infrastructure_map.proto`)

- `packages/protobuf/infrastructure_map.proto`:
  - Add `message OlapDictionary { ... }` with all fields (name, database, cluster, source, primary_key, columns, layout, lifetime, invalidate, defaults, settings, life_cycle, metadata)
  - Add `map<string, OlapDictionary> olap_dictionaries = <next_field_number>;` to `InfrastructureMap` message
  - Add `string olap_dictionary_id = <next_field_number>;` to `InfrastructureSignature` oneof
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

Config includes: `name`, `source: OlapDictionarySource` (typed discriminated union — OlapTable/View ref, Sql/string query, or external source config like `{ type: "mysql", host, port, ... }`), `sourceTables?: (OlapTable | View)[]` (required when source is Sql/string, for dependency tracking), `primaryKey`, `layout` (typed union), `lifetime`, `invalidate?`, `defaults?`, `settings?`, `comment?`, `database?`, `cluster?`, `lifeCycle?`

Self-registers into `getMooseInternal().olapDictionaries`.

### 2.2 Modify: `packages/ts-moose-lib/src/dmv2/internal.ts`

- Add `olapDictionaries` to registry type and initialization
- Add serialization block for olap dictionaries

### 2.3 Modify: `packages/ts-moose-lib/src/dmv2/dataModelMetadata.ts`

- Add `["OlapDictionary", 1]` to `typesToArgsLength` (1 user arg before injected schema+columns)

### 2.4 Modify: `packages/ts-moose-lib/src/sqlHelpers.ts`

- Add OlapDictionary interpolation support in `sql` template tag

### 2.5 Modify export chain

- `dmv2/index.ts`, `browserCompatible.ts` — export OlapDictionary + types

### 2.6 Unit tests: `packages/ts-moose-lib/src/__tests__/dictionary.test.ts`

- Construction, validation, registration, serialization
- `get()` and `getOrDefault()` SQL fragment generation
- Duplicate name rejection
- Layout validation

---

## Phase 3: Python SDK

### 3.1 New file: `packages/py-moose-lib/moose_lib/dmv2/olap_dictionary.py`

```python
class OlapDictionary(Generic[T]):
    def __init__(self, config: OlapDictionaryConfig, **kwargs)
    def get(self, attr: str, *keys) -> str
    def get_or_default(self, attr: str, default, *keys) -> str
    def has(self, *keys) -> str  # → dictHas('db.dict', key)
```

Mirrors TypeScript API with Pydantic config models.

### 3.2 Modify: `packages/py-moose-lib/moose_lib/dmv2/_registry.py`

- Add `_olap_dictionaries` dict

### 3.3 Modify: `packages/py-moose-lib/moose_lib/internal.py`

- Add olap dictionary serialization to `InfrastructureMapConfig`

### 3.4 Modify export chain

- `dmv2/__init__.py`, `moose_lib/__init__.py` — export OlapDictionary + types

### 3.5 Unit tests: `packages/py-moose-lib/tests/test_dictionary.py`

- Mirror of TS tests

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
      source: PartitionStrategiesSource,
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
- **Known limitation note** in docs: Dictionary dependencies in View/MV SQL strings are not automatically detected. When using raw `dictGet('dict_name', ...)` in SQL, the dictionary won't be auto-registered as a dependency for DDL ordering. Users should use the typed `.get()` helper (which generates correct SQL) or be aware that dictionary creation order depends on the source table reference, not on downstream consumers.
- Update SDK overview / primitives listing page
- Update ClickHouse best practices if relevant

---

## Deferred (follow-up PRs)

- `moose db pull` introspection for dictionaries (complex `system.dictionaries` / `SHOW CREATE DICTIONARY` parsing)
- Environment-aware source config (belongs in Moose's env system, not Dictionary-specific)
- Automatic `dictGet` dependency detection in View/MV SQL strings (cycle detection for dictionary↔view circular references)
- **Layout-key type validation** — enforce that `HASHED` requires a single UInt64 key, `COMPLEX_KEY_HASHED` allows multi-column keys. Currently ClickHouse throws the error; ideally Moose validates at plan time.
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
