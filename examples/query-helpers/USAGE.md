# API Query Helpers - Usage Guide (Anonymized)

Build type-safe query APIs with automatic field validation and user-friendly column aliases.

## Why Use These Helpers?

- **Automatic validation**: invalid field names can return `400` automatically (your API layer enforces this)
- **User-friendly APIs**: allow display names like `"Status"` instead of internal `status`
- **Type safety**: catch column name typos at compile time
- **Less boilerplate**: define columns once, reuse across APIs

## Basic Setup

### 1. Define an Alias Config (Optional)

Map internal column names to user-friendly display names:

```typescript
const aliasConfig = {
  id: { alias: "ID" },
  owner: { alias: "Owner" },
  status: { alias: "Status" },
  createdAt: { alias: "Created At" },
} as const; // <- Required for literal type inference
```

### 2. Create Your Params Type

`QueryParams<T>` defines common query params (`limit`, `offset`, `orderby`, `fields`) where `fields` is typed to your model and (optionally) aliases.

```typescript
import { QueryParams } from "./src/selectHelper";

// Example "row" type for a table
type ExampleRow = {
  id: string;
  owner: string;
  status: "OK" | "WARN" | "FAIL";
  createdAt: string;
};

type MyApiParams = QueryParams<ExampleRow, typeof aliasConfig> & {
  "parameter.timeframe"?: string; // add any custom params here
};
```

### 3. Use in Your API

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

  const q = sql`
    SELECT ${buildSelectFromFields(t, fields, { aliasConfig })}
    FROM ${t}
    ${buildOrderBy(t, [{ column: "createdAt", direction: "DESC" }], aliasConfig)}
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

## Without Aliases

If you don't need display name aliases, skip the alias config:

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

Creates the params type for your API. Includes `cacheId`, `limit`, `offset`, `orderby`, and `fields`.

```typescript
type ParamsWithAliases = QueryParams<ExampleRow, typeof aliasConfig>;
type ParamsWithoutAliases = QueryParams<ExampleRow>;
```

### `buildSelectFromFields()`

One function that handles field mapping and SELECT generation together.

```typescript
// With aliases
buildSelectFromFields(table, fields, { aliasConfig });

// With computed columns
buildSelectFromFields(table, fields, {
  aliasConfig,
  computed: [{ expression: "...", alias: "Some Field" }],
});

// Without aliases
buildSelectFromFields(table, fields);
```

### `buildOrderBy()`

Generates an ORDER BY clause.

```typescript
buildOrderBy(table, [{ column: "createdAt", direction: "DESC" }], aliasConfig);
// Produces: ORDER BY "Created At" DESC
```

## Common Patterns

### Multiple Sort Columns

```typescript
buildOrderBy(
  table,
  [
    { column: "createdAt", direction: "DESC" },
    { column: "id", direction: "ASC" },
  ],
  aliasConfig
);
```

### Computed Columns

```typescript
buildSelectFromFields(table, fields, {
  aliasConfig,
  computed: [{ expression: "formatDateTime(createdAt, '%Y-%m-%d')", alias: "Date" }],
});
```

### Setting Defaults

Use destructuring defaults in your handler signature:

```typescript
async function handler({ fields = ["id", "owner"], limit = "20", offset = "0" }: MyApiParams) {
  // fields, limit, offset all have defaults now
}
```

