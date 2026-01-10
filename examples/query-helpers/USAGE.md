# API Query Helpers - Usage Guide

This is an early exploration of a schema-aware query + metrics layer built on top of your `OlapTable` definitions.

## Overview
This library provides a set of low-level helper functions that sit between:
- **API request parsing/validation** (query params like `fields`, `orderby`, `limit`, `offset`)
- **SQL / OLAP query generation** (building `sql\`...\`` fragments safely and consistently)

This library is designed to:
- Define an allowlisted set of query capabilities for a given `OlapTable` (e.g. which fields can be selected, ordered, filtered, time-bucketed, grouped, etc.).
- Validate and normalize API-facing query params against those rules (so invalid `fields` / `orderby` are blocked before query execution).
- Dynamically compose `sql` fragments (built via MooseStack’s `sql` template literal) driven by parsed request params and your defined query allowlist.
- Reduce repetitive, handwritten query construction across REST/RPC/GraphQL endpoints.

## Early / in-progress status

This is intentionally low-level right now. The current library is a set of primitives (projection + ordering + field aliasing) that will be expanded into higher-level helpers as development continues. Feedback is welcome, especially on the primitives, naming, and the overall approach.

## Current Capabilities

- **Projection (SELECT)**: build a `SELECT` list from a dynamic `fields` array (typed to your table model)
- **Column display names**: configure user-friendly aliases for table columns via `columnConfig`
- **Computed columns**: append derived columns to the `SELECT` via `computed` (always included today)
- **Ordering (ORDER BY)**: build an `ORDER BY` clause from a typed list of sortable columns (with optional alias mapping)

## How to use the current building blocks

Current capabilities:
- **`columnConfig`**: define display aliases for existing table columns
- **`QueryParams<T>`**: type your API params (`fields`, `limit`, `offset`, `orderby`)
- **`buildSelectFromFields()` + `buildOrderBy()`**: generate SQL fragments you can interpolate into a `sql\`...\`` query

What's next:
- **Dynamic filter & predicate generation** (typed `WHERE` building and validation)
- **Runtime parsing/validation glue** for query params (turn raw HTTP query params into typed inputs with good errors)
- **Safer computed columns** (use `sql` fragments instead of raw expression strings)


## Basic Setup

### 1. Define Column Configuration (Optional)

**`columnConfig`** configures metadata for **existing table columns** (columns that exist in your table schema). Currently supports aliases for the display name of the column:

```typescript
const columnConfig = {
  id: { alias: "ID" },
  owner: { alias: "Owner" },
  status: { alias: "Status" },
  createdAt: { alias: "Created At" },
} as const; // <- Required for literal type inference
```
- Keys must be actual column names from your `OlapTable` type `T`
- Type-safe: TypeScript will error if you reference non-existent columns
- Columns configured here can be referenced in the `fields` query parameter in your query functions

### 2. Create Your Params Type with QueryParams

`QueryParams<T>` defines common query params (e.g. `limit`, `offset`, `orderby`, `fields`) where `fields` is typed to your model and (optionally) aliases.

```typescript
// Example "row" type for a table
type ExampleRow = {
  id: string;
  owner: string;
  status: "OK" | "WARN" | "FAIL";
  createdAt: string;
};

type MyApiParams = QueryParams<ExampleRow, typeof columnConfig> & {
  "parameter.timeframe"?: string; // add any custom params here
};
```

### 3. Define Computed Columns (Optional)

**`computed`** defines **virtual/derived columns** that don't exist in your table schema. These are SQL expressions calculated on-the-fly:

```typescript
const computed = [
  {
    expression: "formatDateTime(createdAt, '%Y-%m-%d')",
    alias: "Created Date",
  },
  {
    expression: "coalesce(nullif(owner, ''), 'Unknown')",
    alias: "Owner (Normalized)",
  },
];
```
- Not part of your table schema - these are SQL expressions
- Each computed column has an `expression` (raw SQL) and an `alias` (display name)
- Computed columns are **always included** in the SELECT clause (they're not controlled by the `fields` query parameter)
- Currently, computed columns cannot be referenced in `fields` or used in `ORDER BY` (they're always added to the result) -- let us know if you need this!

**Relationship between `columnConfig` and `computed`:**
- `columnConfig`: Configures **existing table columns** - can be selected via `fields` param, can be used in `ORDER BY`
- `computed`: Defines **virtual columns** - always included in SELECT, cannot be selected via `fields` param

### 4. Use in Your API

Your API layer should validate incoming query params (including `fields`) before calling these helpers.

```typescript
import { buildSelectFromFields } from "./src/selectHelper";
import { buildOrderBy } from "./src/orderByHelper";

// Example table metadata (depends on your SQL library/framework)
declare const ExampleTable: import("@your-org/sql-lib").OlapTable<ExampleRow>;

export async function handler(
  params: MyApiParams,
  deps: { sql: typeof import("@your-org/sql-lib").sql }
) {
  const { sql } = deps;
  const { fields = ["id", "owner", "status"], limit = "20" } = params;
  const t = ExampleTable;

  // Computed columns (optional)
  const computed = [
    {
      expression: "formatDateTime(createdAt, '%Y-%m-%d')",
      alias: "Created Date",
    },
  ];

  const q = sql`
    SELECT ${buildSelectFromFields(t, fields, { columnConfig, computed })}
    FROM ${t}
    ${buildOrderBy(t, [{ column: "createdAt", direction: "DESC" }], columnConfig)}
    LIMIT ${parseInt(limit, 10)}
  `;

  return q;
}
```

## What Users Can Do

With the above setup, your API can accept:

```
GET /my-api?fields=id,owner                 # column names
GET /my-api?fields=ID,Owner                 # aliases
GET /my-api?fields=id,Owner,Status          # mix of both
GET /my-api?fields=InvalidField             # 400 error (if your API validates fields)
```

## Without Column Configuration

If you don't need column configuration (aliases, etc.), skip the column config:

```typescript
import { QueryParams, buildSelectFromFields } from "./src/selectHelper";
import { buildOrderBy } from "./src/orderByHelper";

type MyApiParams = QueryParams<ExampleRow>;

export async function handler(
  params: MyApiParams,
  deps: { sql: typeof import("@your-org/sql-lib").sql }
) {
  const { sql } = deps;
  const { fields = ["id", "owner"] } = params;

  const q = sql`
    SELECT ${buildSelectFromFields(ExampleTable, fields)}
    FROM ${ExampleTable}
    ${buildOrderBy(ExampleTable, [{ column: "id", direction: "DESC" }])}
  `;

  return q;
}
```

## Quick Reference

### `QueryParams<T, A?>`

Creates the params type for your API. Includes `limit`, `offset`, `orderby`, and `fields`.

```typescript
type ParamsWithConfig = QueryParams<ExampleRow, typeof columnConfig>;
type ParamsWithoutConfig = QueryParams<ExampleRow>;
```

### `buildSelectFromFields()`

One function that handles field mapping and SELECT generation together.

```typescript
// With column config
buildSelectFromFields(table, fields, { columnConfig });

// With computed columns
buildSelectFromFields(table, fields, {
  columnConfig,
  computed: [{ expression: "...", alias: "Some Field" }],
});

// Without column config
buildSelectFromFields(table, fields);
```

Impact: Only the fields specified in the `fields` parameter will be included in the `SELECT` clause.

### `buildOrderBy()`

Generates an ORDER BY clause.

```typescript
buildOrderBy(table, [{ column: "createdAt", direction: "DESC" }], columnConfig);
// Produces: ORDER BY "Created At" DESC
```
> You can pass this in as a query parameter and pass it through to this buildOrderBy function. Only columns in the `columnConfig` will be allowed to be used in the `ORDER BY` clause. If a column name is not found in the `columnConfig`, it will be ignored.

## Common Patterns

### Multiple Sort Columns

```typescript
buildOrderBy(
  table,
  [
    { column: "createdAt", direction: "DESC" },
    { column: "id", direction: "ASC" },
  ],
  columnConfig
);
```

### Computed Columns

Computed columns are virtual columns defined by SQL expressions. They are **always included** in the SELECT clause, regardless of the `fields` parameter:

```typescript
buildSelectFromFields(table, fields, {
  columnConfig,
  computed: [
    { expression: "formatDateTime(createdAt, '%Y-%m-%d')", alias: "Date" },
    { expression: "amount * 1.1", alias: "Amount With Tax" },
  ],
});
```

**Note:** Computed columns cannot be referenced in the `fields` query parameter. They're always added to the result set alongside any selected table columns.

### Setting Defaults

Use destructuring defaults in your handler signature:

```typescript
async function handler({ fields = ["id", "owner"], limit = "20", offset = "0" }: MyApiParams) {
  // fields, limit, offset all have defaults now
}
```

