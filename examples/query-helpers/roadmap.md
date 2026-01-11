## Query Helpers Roadmap

### P0 — Runtime parsing + validation glue for query params (HIGH)
Improve the current `QueryParams` type to add runtime parsing and validation helpers.

**Current state:** Typia handles array params via repeated query params (`?fields=a&fields=b`). This works out of the box. Comma-separated values (`?fields=a,b`) are NOT supported by default.

- Implement small utilities:
  - `parseLimit(params, { default, min, max })` - validate and coerce limit
  - `parseOffset(params, { default, min })` - validate and coerce offset
  - `parseOrderBy(params, allowedColumns): OrderByColumn<T>[]` - parse `"col DESC"` or `"col:desc"` format with allowlist filtering
- Provide user-friendly errors:
  - Unknown field → show allowed fields
  - Invalid order direction → show expected values
- Deliverables:
  - `parseQueryParams()` helper that returns a structured object ready for builders
- Acceptance criteria:
  - No throwing "generic Error" for user-input; errors are actionable.

### P0 — Typed `buildWhere()` filter builder (HIGH)
Add a type-safe WHERE/filter builder to the library.

- MVP filter grammar:
  - operators: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `contains`, `startsWith`, `endsWith`, `isNull`
- Allowlist:
  - only columns from `(keyof T)` (and optionally allow alias mapping)
- Type-aware parsing/coercion strategy:
  - either strict (no coercion; caller provides typed values)
  - or pluggable coercers per column
- Output:
  - `Sql` fragment (compatible with Moose `sql` tag) + values
- **Deliverables**:
  - `buildWhere(table, filters, { columnConfig?, coercers? })`
- **Acceptance criteria**:
  - Filtering can be added to list endpoints without handwritten SQL strings.

### P1 — Safer computed columns (HIGH)
Extend computed columns to accept raw `expression: string` or a function that returns a `sql` fragment for better type safety and interoperability with the MooseStack `OlapTable` objects.

- Change computed shape to allow:
  - `expression: Sql` **or** `expressionFactory: (t: OlapTable<T>) => Sql`
- Validate computed alias collisions:
  - conflict with real columns
  - conflict across computed aliases
- **Deliverables**:
  - Updated computed column API + validation
- **Acceptance criteria**:
  - No raw SQL string concatenation required for computed expressions.

### P1 — API polish: object argument form (MEDIUM-LOW)
Make the API scale as options grow.

- Consider switching from:
  - `buildSelectFromFields(table, fields, options)`
  - to `buildSelectFromFields(table, { fields, columnConfig, computed })`
- **Deliverables**:
  - New object-style overload (keep old signature for backward compatibility)
- **Acceptance criteria**:
  - Adding new options doesn’t create “positional arg soup.”

### P1 — Tests + type stress tests (MEDIUM)
- Type-level tests:
  - alias conflict detection
  - allowed fields inference
- Runtime tests:
  - parsing `fields`, `orderby`, `limit`, `offset`
  - filter grammar
- **Deliverables**:
  - Minimal test harness + CI-friendly commands
- **Acceptance criteria**:
  - Contributors can refactor with confidence.

### P2 — Cursor pagination helpers (optional but high UX win) (MEDIUM-LOW)
Offset pagination doesn’t scale; cursor pagination is a signature “production-ready default.”

- Implement:
  - `encodeCursor()` / `decodeCursor()`
  - `applyCursorWhere()` (supports composite sort + deterministic tie-breakers)
- **Deliverables**:
  - Cursor pagination utilities + example usage
- **Acceptance criteria**:
  - Stable pagination without offset performance issues.

### P2 — OLAP ergonomics: time bucketing + grouping helpers (optional) (3–7 days)
- `timeBucket(column, granularity)` with adapter seam (ClickHouse first)
- `groupByFields(fields)` with alias awareness
- **Deliverables**:
  - OLAP helper module + example
- **Acceptance criteria**:
  - Common OLAP patterns become 1–2 lines.

### P3 — “Semantic layer v0” model (exploratory) (HIGH)
If you want to make the semantic layer direction real without boiling the ocean:

- Evolve `ColumnConfig` into `SemanticModel`:
  - `dimensions`: { name, column, label, type, tags }
  - `metrics`: { name, expr, agg, label, type }
  - `computed`: { name, expr } (non-agg)
  - defaults + policies (RLS, field allowlists, PII)
- Update helpers to accept the model and expose `ValidDimensions` / `ValidMetrics`.
- **Deliverables**:
  - A minimal model definition API + one example
- **Acceptance criteria**:
  - Users can express intent (dims/metrics/filters) without writing SQL directly.


