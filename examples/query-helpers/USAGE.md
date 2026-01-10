# API Query Helpers - Usage Guide

This is a very early exploration of a query helper library that can be used to build dynamic queries based on the columns of a table. This is primarily meant to illustrate the pattern, and will be improved over time.

## Current Capabilities

- Configure aliases for columns of a table used in a `SELECT` statement
- Configure computed columns for the `SELECT` statement
- Generate a `SELECT` statement based on a dynamic list of column names that are provided as query params
- Dynamically generate a `ORDER BY` statement based on a configured list of columns in your table model that you denote as "sortable" in your model config.

What's next:
- Dynamic filter & predicate generation


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

