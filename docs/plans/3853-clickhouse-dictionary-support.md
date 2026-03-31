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

### Questions for the issue requester

1. **Composite keys** — Do you use multi-column keys (requiring COMPLEX_KEY_HASHED)?
2. **Which layouts** — Which layouts do you actually use? (HASHED, COMPLEX_KEY_HASHED_ARRAY, CACHE, FLAT, etc.)
3. **Where is dictGet used** — Primarily in MaterializedViews, Views, or also in ConsumptionApis?
4. **Dictionary-to-dictionary** — Do you have dictionaries sourcing from other dictionaries?
5. **Invalidation patterns** — Is `max(version)` the only pattern, or do you use others?

### Key design decisions (from critique of the original issue)

1. **Flexible source config** — `source` accepts `OlapTable | View` for typed ClickHouse table references, `Sql | string` for custom ClickHouse queries (with typed interpolation via the `sql` template tag), or external source configs (`{ type: "mysql", ... }`, `{ type: "http", ... }`, etc.) for all 12 ClickHouse-supported source types. When source is a SQL query, explicit `sourceTables` is required for dependency tracking. External sources have no Moose-managed dependencies.
2. **Typed layout config** — not a plain string. A discriminated union with per-layout parameters (e.g., `CACHE` has `sizeInCells`).
3. **`dictGet` helper** — typed method on `OlapDictionary` instances for use in `sql` template tags.
4. **Key/attribute column distinction** — `primaryKey` identifies key columns; attribute columns can have `defaults` for missing key lookups.
5. **Dependency tracking** — source table reference automatically tracked (same as MV/View pattern).
6. **Immutable diffing** — ClickHouse dictionaries cannot be ALTER-ed; any change = DROP + CREATE.

---

## Phase 1: Rust CLI — Core Dictionary Type + DDL

### 1.1 New file: `apps/framework-cli/src/framework/core/infrastructure/dictionary.rs`

Create `Dictionary` struct with: `name`, `database`, `cluster`, `source_table`, `primary_key`, `columns: Vec<DictionaryColumn>`, `layout: DictionaryLayout` (tagged enum), `lifetime: DictionaryLifetime` (untagged enum: single number or {min, max}), `invalidate: Option<DictionaryInvalidation>`, `defaults`, `settings`, `life_cycle`, `metadata`.

Implement:
- `to_create_sql()` → `CREATE DICTIONARY IF NOT EXISTS \`db\`.\`name\` [ON CLUSTER \`cluster\`] (...)` — follows the same conditional `ON CLUSTER` pattern as OlapTable: if `cluster` is `Some`/non-empty, append `ON CLUSTER \`{cluster_name}\``; otherwise omit it
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

### 1.8 Modify: Proto file + state persistence

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

### 1.9 Modify: Plan + reconciliation

- `plan.rs` — add `dictionary_ids` to `ReconciliationFilter`
- `infra_reality_checker.rs` — add dictionary reconciliation
- `display/mod.rs` — add plan display formatting for dictionary changes

---

## Phase 2: TypeScript SDK

### 2.1 New file: `packages/ts-moose-lib/src/dmv2/sdk/olapDictionary.ts`

```typescript
class OlapDictionary<T> {
  constructor(config: OlapDictionaryConfig<T>, schema?, columns?)
  get(attr: keyof T, ...keys: (Sql|string|number)[]): Sql
  getOrDefault(attr: keyof T, defaultVal, ...keys): Sql
}
```

Config includes: `name`, `source: OlapDictionarySource` (typed discriminated union — OlapTable/View ref, Sql/string query, or external source config like `{ type: "mysql", host, port, ... }`), `sourceTables?: (OlapTable | View)[]` (required when source is Sql/string, for dependency tracking), `primaryKey`, `layout` (typed union), `lifetime`, `invalidate?`, `defaults?`, `settings?`, `database?`, `cluster?`, `lifeCycle?`

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
- Modify dictionary layout → verify plan shows DROP + CREATE
- Remove dictionary → verify plan shows removal
- Lifecycle: DELETION_PROTECTED blocks removal
- `dictGet` usage in a View/MV

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
- **Known limitation note** in docs: Dictionary dependencies in View/MV SQL strings are not automatically detected. When using raw `dictGet('dict_name', ...)` in SQL, the dictionary won't be auto-registered as a dependency for DDL ordering. Users should use the typed `.get()` helper (which generates correct SQL) or be aware that dictionary creation order depends on the source table reference, not on downstream consumers.
- Update SDK overview / primitives listing page
- Update ClickHouse best practices if relevant

---

## Deferred (follow-up PRs)

- `moose db pull` introspection for dictionaries (complex `system.dictionaries` parsing)
- Environment-aware source config (belongs in Moose's env system, not Dictionary-specific)
- Automatic `dictGet` dependency detection in View/MV SQL strings

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
| Rust | `plan.rs` | Reconciliation filter |
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
