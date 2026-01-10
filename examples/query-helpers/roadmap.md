## Query Helpers Roadmap

### P0 — Runtime parsing + validation glue for query params (HIGH) (2–4 days)
The chat’s top recommendation: types exist (`QueryParams`) but runtime helpers are missing.

- Implement small utilities:
  - `parseLimit(params, { default, min, max })`
  - `parseOffset(params, { default, min })`
  - `parseFields(params): string[]` (supports `?fields=a,b,c` and repeated params)
  - `parseOrderBy(params): OrderByColumn<T>[]` supporting `"col desc"` and `"col:desc"`
- Provide **user-friendly errors**:
  - Unknown field → show allowed
  - Invalid order direction → show expected
- **Deliverables**:
  - `parseQueryParams()` helper that returns a structured object ready for builders
- **Acceptance criteria**:
  - No throwing “generic Error” for user-input; errors are actionable.

### P0 — Typed `buildWhere()` filter builder (HIGH) (3–6 days)
Second top recommendation: minimal, safe WHERE/filter builder.

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

### P1 — Safer computed columns (2–4 days)
Current computed columns accept raw `expression: string`. The chat suggests making this safer.

- Change computed shape to prefer:
  - `expression: Sql` **or** `expressionFactory: (t: OlapTable<T>) => Sql`
- Validate computed alias collisions:
  - conflict with real columns
  - conflict across computed aliases
- **Deliverables**:
  - Updated computed column API + validation
- **Acceptance criteria**:
  - No raw SQL string concatenation required for computed expressions.

### P1 — API polish: object argument form (1–2 days)
Make the API scale as options grow.

- Consider switching from:
  - `buildSelectFromFields(table, fields, options)`
  - to `buildSelectFromFields(table, { fields, columnConfig, computed })`
- **Deliverables**:
  - New object-style overload (keep old signature for backward compatibility)
- **Acceptance criteria**:
  - Adding new options doesn’t create “positional arg soup.”

### P1 — Tests + type stress tests (2–4 days)
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

### P2 — Cursor pagination helpers (optional but high UX win) (3–6 days)
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

### P3 — “Semantic layer v0” model (exploratory) (5–10 days)
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


