# Query Helpers v2 - Usage Guide

A type-safe, three-layer architecture for building query APIs in MooseStack WebApps.

## Overview

This library provides a structured approach to handling query parameters in WebApp endpoints:

1. **Layer 1: Validation** — TypeScript types with Typia tags for compile-time + runtime validation
2. **Layer 2: Mapping** — Map API params to database columns (renames, transforms, expressions)
3. **Layer 3: SQL Generation** — Build safe, parameterized SQL from query intent

```
┌─────────────────────────────────────────────────────────────────┐
│  WebApp Handler                                                 │
│  ┌─────────────┐                                                │
│  │ req.query + │                                                │
│  │ req.body    │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Layer 1: Validation (Typia)                             │   │
│  │ • TypeScript types with tags.Minimum, tags.Maximum, etc │   │
│  │ • Compile-time type checking                            │   │
│  │ • Runtime validation with detailed errors               │   │
│  └──────────────────────────┬──────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Layer 2: Param-to-Column Mapping                        │   │
│  │ • Map param names to column names                       │   │
│  │ • Transform values (string → Date, etc.)                │   │
│  │ • Custom SQL expressions for complex filters            │   │
│  └──────────────────────────┬──────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Layer 3: SQL Generation                                 │   │
│  │ • toSelectSql, toWhereSql, toOrderBySql                 │   │
│  │ • Parameterized queries (SQL injection safe)            │   │
│  │ • Composable with Moose's sql template tag              │   │
│  └──────────────────────────┬──────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Moose Native: client.query.execute(sql`...`)            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

These helpers are part of MooseStack. Import from `@514labs/moose-lib`:

```typescript
import { 
  // Layer 1: Validation
  createParamValidatorSafe,
  PaginationParams,
  DateRangeParams,
  
  // Layer 2: Mapping
  createParamMap,
  
  // Layer 3: SQL Generation
  toQuerySql,
} from "@514labs/moose-lib/query-helpers";
```

---

## Layer 1: Validation

### Define Param Types with Typia Tags

Use TypeScript types with Typia constraint tags. The Moose compiler generates validators at compile time.

```typescript
import { tags } from "typia";

// Reusable pagination params (provided by moose-lib)
interface PaginationParams {
  limit?: number & tags.Type<"int32"> & tags.Minimum<1> & tags.Maximum<1000> & tags.Default<50>;
  offset?: number & tags.Type<"int32"> & tags.Minimum<0> & tags.Default<0>;
}

// Reusable date range params (provided by moose-lib)
interface DateRangeParams {
  startDate?: string & tags.Format<"date-time">;
  endDate?: string & tags.Format<"date-time">;
}
```

### Define Your Endpoint's Param Types

```typescript
import { tags } from "typia";
import { PaginationParams, DateRangeParams } from "@514labs/moose-lib/query-helpers";

// Define what's filterable for your endpoint
interface OrderFilters {
  orderId?: string;
  status?: "pending" | "completed" | "cancelled";  // Enum validation
  minAmount?: number & tags.Minimum<0>;
  maxAmount?: number & tags.Minimum<0>;
  customerId?: string;
}

// Complete params for your endpoint
interface OrderQueryParams {
  filters?: OrderFilters;
  pagination?: PaginationParams;
  dateRange?: DateRangeParams;
  reportType?: "summary" | "detailed";
  search?: string & tags.MaxLength<100>;
}
```

### Create and Use Validator

```typescript
import { createParamValidatorSafe } from "@514labs/moose-lib/query-helpers";

// Typia generates this at compile time
const validateParams = createParamValidatorSafe<OrderQueryParams>();

// In your handler:
const params = { ...req.query, ...req.body };
const validated = validateParams(params);

if (!validated.ok) {
  return res.status(400).json({ 
    error: "Invalid parameters",
    details: validated.errors  // [{ path: "filters.minAmount", expected: "number", value: "abc" }]
  });
}

// validated.data is now typed as OrderQueryParams
const { filters, pagination, reportType } = validated.data;
```

### Available Typia Tags

| Tag | Purpose | Example |
|-----|---------|---------|
| `tags.Type<"int32">` | Integer type | `number & tags.Type<"int32">` |
| `tags.Minimum<N>` | Minimum value | `number & tags.Minimum<0>` |
| `tags.Maximum<N>` | Maximum value | `number & tags.Maximum<1000>` |
| `tags.MinLength<N>` | Min string length | `string & tags.MinLength<1>` |
| `tags.MaxLength<N>` | Max string length | `string & tags.MaxLength<100>` |
| `tags.Format<F>` | String format | `string & tags.Format<"date-time">` |
| `tags.Pattern<P>` | Regex pattern | `string & tags.Pattern<"^[A-Z]+$">` |
| `tags.Default<V>` | Default value | `number & tags.Default<50>` |

---

## Layer 2: Param-to-Column Mapping

### Why Mapping?

API params often differ from database columns:
- **Naming**: `orderId` (API) → `order_id` (DB)
- **Operators**: `minAmount` implies `>=`, not `=`
- **Transforms**: String date → Date object
- **Complex filters**: `search` queries multiple columns

### Define a Param Map

```typescript
import { OlapTable } from "@514labs/moose-lib";
import { createParamMap } from "@514labs/moose-lib/query-helpers";

// Your table type
interface OrderRow {
  order_id: string;
  customer_id: string;
  amount: number;
  status: string;
  created_at: Date;
}

const OrdersTable = new OlapTable<OrderRow>("orders");

// Create mapping from filter params to table columns
const paramMap = createParamMap<OrderFilters, OrderRow>(OrdersTable, {
  filters: {
    // Simple rename: orderId → order_id
    orderId: { column: "order_id" },
    
    // Same name, default operator (eq)
    status: { column: "status" },
    
    // Different operator: minAmount uses >=
    minAmount: { column: "amount", operator: "gte" },
    maxAmount: { column: "amount", operator: "lte" },
    
    // Rename
    customerId: { column: "customer_id" },
  },
  
  // Default columns to SELECT if none specified
  defaultSelect: ["order_id", "customer_id", "amount", "status", "created_at"],
  
  // Default ORDER BY
  defaultOrderBy: [{ column: "created_at", direction: "DESC" }],
});
```

### Mapping Types

**Simple Column Mapping:**
```typescript
orderId: { column: "order_id" }
// Generates: WHERE order_id = $value
```

**With Operator:**
```typescript
minAmount: { column: "amount", operator: "gte" }
// Generates: WHERE amount >= $value
```

**With Transform:**
```typescript
startDate: { 
  column: "created_at",
  operator: "gte",
  transform: (v: string) => new Date(v),
}
```

**Custom SQL Expression:**
```typescript
search: {
  toSql: (value, table) => sql`(
    ${table}.customer_name ILIKE ${'%' + value + '%'} OR
    ${table}.order_id ILIKE ${'%' + value + '%'}
  )`,
}
```

### Available Operators

| Operator | SQL | Example |
|----------|-----|---------|
| `eq` | `=` | `status = 'pending'` |
| `neq` | `!=` | `status != 'cancelled'` |
| `gt` | `>` | `amount > 100` |
| `gte` | `>=` | `amount >= 100` |
| `lt` | `<` | `amount < 1000` |
| `lte` | `<=` | `amount <= 1000` |
| `in` | `IN` | `status IN ('pending', 'completed')` |
| `contains` | `ILIKE` | `name ILIKE '%john%'` |
| `startsWith` | `ILIKE` | `name ILIKE 'john%'` |
| `isNull` | `IS NULL` | `deleted_at IS NULL` |

### Convert Params to Query Intent

```typescript
// After validation
const intent = paramMap.toIntent(validated.data);

// intent contains:
// {
//   select: { columns: ["order_id", "customer_id", ...] },
//   where: [{ column: "status", operator: "eq", value: "pending" }, ...],
//   orderBy: [{ column: "created_at", direction: "DESC" }],
//   pagination: { limit: 50, offset: 0 },
// }
```

---

## Layer 3: SQL Generation

### Generate Full Query

```typescript
import { toQuerySql } from "@514labs/moose-lib/query-helpers";

const query = toQuerySql(OrdersTable, intent);

// Execute with Moose
const { client } = await getMooseUtils();
const result = await client.query.execute(query);
```

### Individual Builders

For more control, use individual builders:

```typescript
import { toSelectSql, toWhereSql, toOrderBySql } from "@514labs/moose-lib/query-helpers";
import { sql } from "@514labs/moose-lib";

// Build custom query
const query = sql`
  SELECT ${toSelectSql(table, intent.select)}
  FROM ${table}
  WHERE ${toWhereSql(table, intent.where)}
    AND deleted_at IS NULL  -- Add custom conditions
  ${toOrderBySql(intent.orderBy)}
  LIMIT ${intent.pagination.limit}
  OFFSET ${intent.pagination.offset}
`;
```

### SQL Injection Safety

All values are parameterized:

```typescript
// User input: { filters: { status: "pending'; DROP TABLE orders; --" } }

// Generated SQL (safe):
// SELECT ... WHERE status = {p0:String}
// Parameters: { p0: "pending'; DROP TABLE orders; --" }

// The malicious input is treated as a literal string value, not SQL code.
```

---

## Complete Example

```typescript
// app/apis/orders.ts
import express from "express";
import { tags } from "typia";
import { WebApp, OlapTable, getMooseUtils } from "@514labs/moose-lib";
import { 
  createParamValidatorSafe, 
  createParamMap, 
  toQuerySql,
  PaginationParams,
  DateRangeParams,
} from "@514labs/moose-lib/query-helpers";

// ============================================
// Table Definition
// ============================================
interface OrderRow {
  order_id: string;
  customer_id: string;
  amount: number;
  status: string;
  created_at: Date;
}

const OrdersTable = new OlapTable<OrderRow>("orders");

// ============================================
// Layer 1: Param Types
// ============================================
interface OrderFilters {
  orderId?: string;
  status?: "pending" | "completed" | "cancelled";
  minAmount?: number & tags.Minimum<0>;
  maxAmount?: number & tags.Minimum<0>;
}

interface OrderQueryParams {
  filters?: OrderFilters;
  pagination?: PaginationParams;
  dateRange?: DateRangeParams;
  reportType?: "summary" | "detailed";
}

const validateParams = createParamValidatorSafe<OrderQueryParams>();

// ============================================
// Layer 2: Param Mapping
// ============================================
const paramMap = createParamMap<OrderFilters, OrderRow>(OrdersTable, {
  filters: {
    orderId: { column: "order_id" },
    status: { column: "status" },
    minAmount: { column: "amount", operator: "gte" },
    maxAmount: { column: "amount", operator: "lte" },
  },
  defaultSelect: ["order_id", "customer_id", "amount", "status", "created_at"],
  defaultOrderBy: [{ column: "created_at", direction: "DESC" }],
});

// ============================================
// Express App
// ============================================
const app = express();
app.use(express.json());

app.post("/", async (req, res) => {
  // Merge query string + body
  const params = { ...req.query, ...req.body };
  
  // Layer 1: Validate
  const validated = validateParams(params);
  if (!validated.ok) {
    return res.status(400).json({ errors: validated.errors });
  }
  
  // Fan-out pattern: different logic based on reportType
  if (validated.data.reportType === "summary") {
    return handleSummaryReport(validated.data, res);
  }
  
  // Layer 2: Map to query intent
  const intent = paramMap.toIntent(validated.data);
  
  // Layer 3: Generate SQL
  const query = toQuerySql(OrdersTable, intent);
  
  // Execute
  const { client } = await getMooseUtils();
  const result = await client.query.execute(query);
  res.json(await result.json());
});

async function handleSummaryReport(params: OrderQueryParams, res: express.Response) {
  // Different query logic for summary reports...
  const { client, sql } = await getMooseUtils();
  const result = await client.query.execute(sql`
    SELECT status, COUNT(*) as count, SUM(amount) as total
    FROM ${OrdersTable}
    GROUP BY status
  `);
  res.json(await result.json());
}

export default new WebApp("orders-api", app, { mountPath: "/orders" });
```

## Example Request

```bash
# POST with JSON body
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "status": "pending",
      "minAmount": 100
    },
    "pagination": {
      "limit": 20,
      "offset": 0
    }
  }'
```

---

## Security

The three-layer approach provides defense in depth:

| Layer | Protection |
|-------|-----------|
| **Validation** | Typia rejects values that don't match types/enums. Can't inject SQL in a field typed as `"pending" \| "completed"`. |
| **Mapping** | Column names come from your config, not user input. Users provide values, you control which columns they apply to. |
| **SQL Generation** | Uses Moose's `sql` template tag which generates parameterized queries. Values are never string-concatenated. |

---

## API Reference

### Validation

```typescript
// Create a validator that throws on invalid input
createParamValidator<T>(): (input: unknown) => T

// Create a validator that returns { ok, data } or { ok, errors }
createParamValidatorSafe<T>(): (input: unknown) => ValidationResult<T>
```

### Mapping

```typescript
// Create a param map with column mappings
createParamMap<TFilters, TTable>(
  table: OlapTable<TTable>,
  config: ParamMapConfig<TFilters, TTable>,
): ParamMap<TFilters, TTable>

// Convert validated params to query intent
paramMap.toIntent(params): QueryIntent<TTable>
```

### SQL Generation

```typescript
// Build complete query
toQuerySql<T>(table: OlapTable<T>, intent: QueryIntent<T>): Sql

// Individual builders
toSelectSql<T>(table: OlapTable<T>, select: SelectIntent<T>): Sql
toWhereSql<T>(table: OlapTable<T>, conditions: WhereCondition<T>[]): Sql
toOrderBySql<T>(orderBy: OrderByColumn<T>[]): Sql
```
