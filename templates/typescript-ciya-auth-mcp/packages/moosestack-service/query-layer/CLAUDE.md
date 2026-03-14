# CLAUDE.md - Moose Query Layer

This file provides context for AI assistants working with this codebase.

## What This Is

A standalone repository containing copy-paste TypeScript code for type-safe SQL query building on Moose + ClickHouse dashboards. It's a "semantic layer" that lets developers work with business concepts (dimensions, metrics, filters) instead of raw SQL.

**Distribution model:** shadcn-style. Developers copy the `src/` folder into their Moose project and own the code. This is NOT an npm package.

**Key insight:** This is a copy-pasteable pattern, not a framework. The goal is to show how to build maintainable, type-safe dashboard queries without a heavy ORM.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Your Application                       │
│  (Next.js, Express, Fastify, etc.)                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Server Actions / API Routes                            │
│   └── Import query handler functions from moose package  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Moose Package (this library)                           │
│   ├── defineQueryModel() - Creates semantic query model  │
│   ├── Query handlers - Export functions like             │
│   │                    getEventsMetrics()                │
│   └── SQL utilities - Low-level building blocks          │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ClickHouse (via @514labs/moose-lib)                    │
│   └── Executes parameterized SQL queries                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Repository Structure

```
moose-query-layer/
├── src/                    # Query layer library source (copy into your project)
│   ├── index.ts            # Public API exports
│   ├── types.ts            # Type definitions
│   ├── query-model.ts      # defineQueryModel() implementation
│   ├── query-builder.ts    # Fluent builder API
│   └── sql-utils.ts        # Low-level SQL building utilities
├── example/                # Example Moose project using the query layer
│   └── src/
│       ├── query-layer/    # Copied from /src
│       ├── models.ts       # OlapTable definitions
│       ├── client.ts       # ClickHouse client
│       └── queries/        # Query handler functions
└── integrations/           # Framework integrations consuming the example
    ├── nextjs/             # Full Next.js dashboard app
    ├── express/            # Minimal Express API server
    └── fastify/            # Minimal Fastify API server
```

## Core Concepts

### 1. Query Model (`defineQueryModel`)

The central abstraction. Defines:
- **Dimensions**: Columns/expressions for grouping (status, day, month)
- **Metrics**: Aggregates (count, sum, avg)
- **Filters**: Which columns can be filtered and with what operators
- **Sortable**: Which fields can be sorted

The model then provides:
- `toSql(request)` - Build complete SQL
- `toParts(request)` - Get individual clauses for custom assembly
- `query(request, client)` - Execute and return results
- Type inference helpers (`$inferRequest`, `$inferFilters`)

### 2. Filter Operators

```typescript
// Scalar: eq, ne, gt, gte, lt, lte, like, ilike
{ status: { eq: "active" } }

// List: in, notIn
{ status: { in: ["active", "pending"] } }

// Range: between
{ amount: { between: [100, 500] } }

// Null checks: isNull, isNotNull
{ email: { isNotNull: true } }
```

### 3. SQL Utilities

Low-level building blocks when you need custom queries:
- `filter(col, op, value)` - Conditional filter (skips undefined)
- `where(...conditions)` - Build WHERE clause
- `and()`, `or()`, `not()` - Logical combinators
- `count()`, `sum()`, `avg()`, `min()`, `max()` - Aggregations
- `eq()`, `gte()`, `inList()`, etc. - Comparison operators

## Type System

The library uses TypeScript generics extensively:

```typescript
// QueryModel is generic over:
// - TTable: The table's row type
// - TMetrics: Record of metric definitions
// - TDimensions: Record of dimension definitions
// - TFilters: Record of filter definitions
// - TSortable: Union of sortable field names
// - TResult: Query result type

// Type inference:
type Request = typeof model.$inferRequest;
type Filters = typeof model.$inferFilters;
```

## Common Patterns

### Creating a Query Handler Function

```typescript
// 1. Define the model
export const eventsModel = defineQueryModel({ ... });

// 2. Create typed query function
export async function getEventsByStatus(startDate?: Date, endDate?: Date) {
  const query = eventsModel.toSql({
    dimensions: ["status"],
    metrics: ["totalEvents"],
    filters: {
      timestamp: { gte: startDate, lte: endDate },
    },
  });

  return executeQuery<{ status: string; totalEvents: number }>(query);
}
```

### Using the Fluent Builder

```typescript
const results = await buildQuery(model)
  .dimensions(["status"])
  .metrics(["totalEvents"])
  .filter("timestamp", "gte", startDate)  // Skips if undefined
  .filter("timestamp", "lte", endDate)
  .orderBy(["totalEvents", "DESC"])
  .limit(10)
  .execute(client.query);
```

### Custom SQL Assembly

```typescript
const parts = model.toParts(request);
const customQuery = sql`
  WITH filtered AS (
    SELECT * ${parts.from} ${parts.where}
  )
  SELECT ${parts.dimensions}, ${parts.metrics}
  FROM filtered
  ${parts.groupBy}
  ${parts.orderBy}
`;
```

## Dependencies

- `@514labs/moose-lib` - Required for `sql` template literal, `Sql` class, `OlapTable`, `QueryClient`
- `typia` - Optional, only needed if using `createQueryHandler()` validation utilities

## Testing

When testing query models:
1. Use `toSql()` to inspect generated SQL
2. Mock the QueryClient for unit tests
3. Use actual ClickHouse for integration tests

## Common Issues

### Circular Type Reference
If you see "implicitly has type 'any' because it references itself", you're likely using `typeof model.$inferRequest` in a way that creates a cycle. Use the concrete `QueryRequest` type instead.

### Filter Operators Not Type-Safe
Make sure to use `as const` on operator arrays:
```typescript
operators: ["eq", "in"] as const  // ✓
operators: ["eq", "in"]           // ✗ loses literal types
```

### SQL Injection
The library parameterizes values by default. Only `raw()` bypasses this - use it only with trusted input (column names, table names).

## Roadmap / Non-Goals

**What this is:**
- A pattern/recipe for type-safe ClickHouse queries
- Copy-pasteable into any Moose project
- Focused on read queries for dashboards

**What this is NOT:**
- A full ORM
- A migration system
- A Materialized View manager (that's a separate concern)

## Running the Examples

```bash
# Install dependencies
pnpm install

# Start the Moose development server (runs ClickHouse)
pnpm dev:moose

# In another terminal, start one of the integrations:
pnpm dev:nextjs    # Next.js at http://localhost:3000
pnpm dev:express   # Express at http://localhost:3001
pnpm dev:fastify   # Fastify at http://localhost:3002
```
