# API Query Helpers - Usage Guide

A schema-aware query helper layer for building type-safe SQL queries on top of MooseStack's `OlapTable` definitions.

## Overview

This library provides helper functions that sit between:
- **API request handling** (query params like `fields`, `orderby`, `limit`, `offset`)
- **SQL query generation** (building `sql` fragments safely and consistently)

**What it does:**
- Type-safe field selection with optional user-friendly display aliases
- Dynamic SELECT clause generation from validated field lists
- ORDER BY clause generation with alias support

## Installation

These helpers are designed to work with MooseStack. Import from `@514labs/moose-lib`:

```typescript
import {
  buildSelectFromFields,
  buildOrderBy,
  type QueryParams,
  type ColumnConfig,
} from "@514labs/moose-lib";
```

## Quick Start

```typescript
import { Api, OlapTable, sql } from "@514labs/moose-lib";
import { buildSelectFromFields, buildOrderBy, QueryParams, ColumnConfig } from "@514labs/moose-lib";

// 1. Define your row type
type UserRow = {
  id: string;
  email: string;
  createdAt: string;
  status: "active" | "inactive";
};

// 2. Define column aliases (optional)
const columnConfig = {
  id: { alias: "User ID" },
  email: { alias: "Email Address" },
  createdAt: { alias: "Created At" },
  status: { alias: "Status" },
} as const satisfies ColumnConfig<UserRow>;

// 3. Define your API params type
type UserApiParams = QueryParams<UserRow, typeof columnConfig>;

// 4. Create your API
const UsersTable = new OlapTable<UserRow>("users");

export const UsersApi = new Api<UserApiParams, Record<string, any>[]>(
  "users",
  async ({ fields = ["id", "email"], limit = "20", offset = "0" }, { client, sql }) => {
    const query = sql`
      SELECT ${buildSelectFromFields(UsersTable, fields, { columnConfig })}
      FROM ${UsersTable}
      ${buildOrderBy(UsersTable, [{ column: "createdAt", direction: "DESC" }], columnConfig)}
      LIMIT ${parseInt(limit, 10)}
      OFFSET ${parseInt(offset, 10)}
    `;

    const result = await client.query.execute(query);
    return result.json();
  }
);
```

## Query Parameter Format

### Field Selection

The `fields` parameter accepts an array of field names. When calling your API via HTTP, use **repeated query parameters**:

```bash
# Select specific fields (use repeated params)
GET /api/users?fields=id&fields=email

# Select using display aliases
GET /api/users?fields=User%20ID&fields=Email%20Address

# Mix column names and aliases
GET /api/users?fields=id&fields=Email%20Address
```

> **Note:** Typia validates that each field is either a valid column name or a configured alias. Invalid fields return a 400 error with a helpful message listing allowed values.

### Pagination

```bash
GET /api/users?limit=10&offset=20
```

### Ordering

The `orderby` parameter is a string that your handler can parse. A common format:

```bash
GET /api/users?orderby=createdAt%20DESC
```

## API Reference

### `ColumnConfig<T>`

Defines display aliases for table columns. Use `as const` for literal type inference.

```typescript
const columnConfig = {
  id: { alias: "ID" },
  createdAt: { alias: "Created At" },
} as const satisfies ColumnConfig<MyRow>;
```

**Rules:**
- Keys must be actual column names from your table type `T`
- Aliases must not conflict with column names (TypeScript will error if they do)
- The `as const` assertion is required for proper type inference

### `QueryParams<T, A?>`

Creates a typed params interface for your API:

```typescript
type MyApiParams = QueryParams<MyRow, typeof columnConfig>;
// Includes: fields?, limit?, offset?, orderby?
```

The `fields` property is typed to accept:
- Any column name from `T` (e.g., `"id"`, `"createdAt"`)
- Any alias from your config (e.g., `"ID"`, `"Created At"`)

### `buildSelectFromFields(table, fields, options?)`

Builds a SELECT clause from a table and field list.

```typescript
buildSelectFromFields(table, fields, { columnConfig });
```

**Parameters:**
- `table` - Your `OlapTable<T>` instance
- `fields` - Array of field names (column names or aliases)
- `options.columnConfig` - Optional column configuration for aliases

**Returns:** A `Sql` fragment for interpolation into a query.

**Example output:**
```sql
SELECT "id" AS "ID", "email" AS "Email Address", "createdAt" AS "Created At"
```

### `buildOrderBy(table, columns, columnConfig?)`

Builds an ORDER BY clause.

```typescript
buildOrderBy(table, [{ column: "createdAt", direction: "DESC" }], columnConfig);
```

**Parameters:**
- `table` - Your `OlapTable<T>` instance
- `columns` - Array of `{ column, direction? }` objects
- `columnConfig` - Optional config to use aliases in the ORDER BY

**Returns:** A `Sql` fragment like `ORDER BY "Created At" DESC`

**Example - multiple columns:**
```typescript
buildOrderBy(table, [
  { column: "status", direction: "ASC" },
  { column: "createdAt", direction: "DESC" },
], columnConfig);
// ORDER BY "Status" ASC, "Created At" DESC
```

## Complete Example

```typescript
import { Api, OlapTable, sql } from "@514labs/moose-lib";
import {
  buildSelectFromFields,
  buildOrderBy,
  type QueryParams,
  type ColumnConfig,
} from "@514labs/moose-lib";

// Row type matching your table schema
type OrderRow = {
  orderId: string;
  customerId: string;
  amount: number;
  status: "pending" | "completed" | "cancelled";
  createdAt: string;
};

// Column configuration with display aliases
const columnConfig = {
  orderId: { alias: "Order ID" },
  customerId: { alias: "Customer ID" },
  amount: { alias: "Amount" },
  status: { alias: "Status" },
  createdAt: { alias: "Created At" },
} as const satisfies ColumnConfig<OrderRow>;

// API params type
type OrderApiParams = QueryParams<OrderRow, typeof columnConfig> & {
  minAmount?: string;
  maxAmount?: string;
};

// Table reference
const OrdersTable = new OlapTable<OrderRow>("orders");

export const OrdersApi = new Api<OrderApiParams, Record<string, any>[]>(
  "orders",
  async (params, { client, sql: sqlTag }) => {
    const {
      fields = ["orderId", "customerId", "amount", "status"],
      limit = "50",
      offset = "0",
      minAmount,
      maxAmount,
    } = params;

    // Build WHERE conditions
    const conditions: string[] = [];
    if (minAmount) conditions.push(`amount >= ${parseFloat(minAmount)}`);
    if (maxAmount) conditions.push(`amount <= ${parseFloat(maxAmount)}`);
    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const query = sqlTag`
      SELECT ${buildSelectFromFields(OrdersTable, fields, { columnConfig })}
      FROM ${OrdersTable}
      ${whereClause}
      ${buildOrderBy(OrdersTable, [{ column: "createdAt", direction: "DESC" }], columnConfig)}
      LIMIT ${parseInt(limit, 10)}
      OFFSET ${parseInt(offset, 10)}
    `;

    const result = await client.query.execute(query);
    return result.json();
  }
);
```

**Example requests:**

```bash
# Default fields
GET /api/orders

# Select specific fields
GET /api/orders?fields=orderId&fields=amount&fields=status

# Using aliases
GET /api/orders?fields=Order%20ID&fields=Amount

# With filters and pagination
GET /api/orders?fields=orderId&fields=amount&minAmount=100&limit=10&offset=0
```

**Example response:**

```json
[
  {
    "Order ID": "ord-123",
    "Customer ID": "cust-456",
    "Amount": 150.00,
    "Status": "completed",
    "Created At": "2024-01-15T10:30:00Z"
  }
]
```

## Tips

### Setting Defaults

Use destructuring defaults in your handler:

```typescript
async ({ fields = ["id", "name"], limit = "20", offset = "0" }, utils) => {
  // fields, limit, offset all have defaults
}
```

### Without Column Configuration

If you don't need aliases, skip the config entirely:

```typescript
type SimpleParams = QueryParams<MyRow>;  // No second type param

buildSelectFromFields(table, fields);     // No options
buildOrderBy(table, columns);             // No config
```

### Type Safety

The `ValidFields` type ensures compile-time safety:

```typescript
// This will error at compile time if "invalidField" doesn't exist
const fields: ValidFields<MyRow, typeof columnConfig>[] = ["id", "invalidField"];
```

If an alias conflicts with a column name, the type becomes `never`, causing a compile error:

```typescript
// ERROR: "id" alias conflicts with "id" column
const badConfig = {
  name: { alias: "id" }  // "id" is already a column name!
} as const;
```
