# CLAUDE.md - AI Context for nextjs-moose Example

This file provides context for AI assistants working with this codebase.

## What This Repo Is

Next.js demo app showing how to build fast customer-facing dashboards on ClickHouse using a small query/metrics layer. Target user: product engineers who know Postgres dashboards and want to move to ClickHouse without a huge refactor.

This demonstrates **Step 2** of the two-step OLAP migration pattern:
1. ~~Shift just-in-time joins to write-time via Materialized Views~~ *(not shown - future work)*
2. **Accelerate endpoint creation with the query layer (`defineQueryModel`)** *(this demo)*

**Important:** This demo assumes MVs/OLAP tables already exist. It focuses on the query layer for rapidly building type-safe APIs on top of those tables. The `Events` table is a simple stand-in for what would be a pre-aggregated MV in production.

## Architecture Overview

```
Data Flow:
OLTP → CDC → ClickHouse → Materialized Views → Query Layer → API Routes → React Components

Key Insight:
- Write-time transforms: MVs pre-join and pre-aggregate data at insert time
- Read-time selection: Query layer provides safe selection, filtering, sorting
```

## Project Structure

```
examples/nextjs-moose/
├── app/
│   ├── page.tsx              # Dashboard page (client component)
│   ├── builder/page.tsx      # Report builder page
│   └── actions.ts            # Server actions calling query functions
├── components/
│   ├── dashboard/            # Dashboard-specific components and hooks
│   │   ├── dashboard-hooks.ts    # useMetrics, useEventsByStatus, useTimeseries
│   │   ├── dashboard-provider.tsx # Global filter state (date range)
│   │   └── metric-cards.tsx      # Metric display component
│   ├── report-builder/       # Dynamic report builder
│   │   ├── use-report.ts         # Core hook for report state
│   │   └── prepare-model.ts      # Transforms backend model to frontend
│   └── widgets/              # Reusable chart components
└── moose/                    # MooseStack workspace package
    └── src/
        ├── models.ts             # OlapTable definitions (Events table)
        ├── client.ts             # ClickHouse client setup
        ├── query-layer/          # Core query building system
        │   ├── query-model.ts        # defineQueryModel() implementation
        │   ├── sql-utils.ts          # SQL building helpers
        │   └── types.ts              # Type definitions
        └── query-examples/       # Example usage of query layer
            ├── model.ts              # eventsModel definition
            ├── events-metrics.ts     # getEventsMetrics()
            ├── events-timeseries.ts  # getEventsTimeseries()
            └── full-builder.ts       # runEventsQuery() for dynamic queries
```

## Core Concepts

### Query Model (`defineQueryModel`)

The central abstraction. Defines what can be queried from a table:

```typescript
// moose/src/query-examples/model.ts
export const eventsModel = defineQueryModel({
  table: Events,
  dimensions: {
    status: { column: "status" },
    day: { expression: sql`toDate(${Events.columns.event_time})`, as: "time" },
  },
  metrics: {
    totalEvents: { agg: sql`count(*)` },
    totalAmount: { agg: sql`sum(${Events.columns.amount})` },
  },
  filters: {
    timestamp: { column: "event_time", operators: ["gte", "lte"] as const },
    status: { column: "status", operators: ["eq", "in"] as const },
  },
  sortable: ["totalAmount", "totalEvents"] as const,
});
```

**Key properties:**
- `dimensions`: Columns for GROUP BY (can be expressions)
- `metrics`: Aggregate functions
- `filters`: Allowed filter operations with type constraints
- `sortable`: Which fields can be sorted

**Type inference helpers:**
- `eventsModel.$inferRequest` - Type for query parameters
- `eventsModel.$inferDimensions` - Union of dimension names
- `eventsModel.$inferMetrics` - Union of metric names

### Query Execution Pattern

```typescript
// 1. Generate SQL from model
const query = eventsModel.toSql({
  dimensions: ["status"],
  metrics: ["totalEvents"],
  filters: { timestamp: { gte: startDate } },
});

// 2. Execute query
const results = await executeQuery(query);

// Or use model.query() directly with a client
const results = await eventsModel.query(params, client);
```

### Server Actions Pattern (Key Touchpoint)

**Server actions are the bridge between frontend React components and backend moose query functions.** They import query functions from the moose package and expose them to the frontend:

```typescript
// app/actions.ts
"use server";

// Import query functions from the moose package
import { getEventsMetrics, getEventsTimeseries, runEventsQuery, eventsModel } from "moose";

// Static query - wraps moose function
export async function getMetrics(startDate?: string, endDate?: string) {
  // Calls getEventsMetrics() which uses eventsModel.toSql() internally
  const results = await getEventsMetrics(parseDate(startDate), parseDate(endDate));
  return results[0];
}

// Dynamic query - passes params to model-based query
export async function executeEventsQuery(params: typeof eventsModel.$inferRequest) {
  // runEventsQuery() validates params and calls eventsModel.toSql()
  const results = await runEventsQuery(params);
  return results;
}
```

### Dashboard Hooks Pattern

Hooks call server actions (not moose directly). They don't know about ClickHouse:

```typescript
// components/dashboard/dashboard-hooks.ts
import { getMetrics } from "@/app/actions"; // Import server action, not moose

export function useMetrics() {
  const { startDate, endDate } = useDashboardFilters();
  
  return useQuery({
    queryKey: ["metrics", startDate, endDate],
    queryFn: () => getMetrics(startDate, endDate), // Calls server action
  });
}
```

**The chain:** `React Component → Hook → Server Action → Moose Query Function → eventsModel.toSql() → ClickHouse`

### Report Builder Pattern

The report builder transforms the backend model for frontend consumption:

```typescript
// app/builder/page.tsx
const model = prepareModel(eventsModel, {
  filters: {
    status: {
      inputType: "select",
      options: [
        { value: "active", label: "Active" },
        { value: "completed", label: "Completed" },
      ],
    },
  },
});
```

## Common Tasks

### Add a new metric

1. Add to model definition in `moose/src/query-examples/model.ts`:
```typescript
metrics: {
  newMetric: { agg: sql`avg(${Events.columns.amount})` },
}
```

2. Add to sortable if needed:
```typescript
sortable: ["totalAmount", "newMetric"] as const,
```

3. Use in query functions or report builder automatically picks it up.

### Add a new filter

1. Add to model definition:
```typescript
filters: {
  amount: { column: "amount", operators: ["gte", "lte"] as const },
}
```

2. For select-type filters in report builder, configure in `prepareModel()`:
```typescript
filters: {
  amount: { inputType: "number" },
}
```

### Add a new dimension

1. Add to model definition:
```typescript
dimensions: {
  week: { expression: sql`toStartOfWeek(${Events.columns.event_time})`, as: "time" },
}
```

2. Available in report builder and for time-series queries.

## Key Files to Understand

1. **`moose/src/query-layer/query-model.ts`** - Core `defineQueryModel()` implementation
2. **`moose/src/query-examples/model.ts`** - Example model showing the pattern
3. **`app/actions.ts`** - Server actions wrapping queries
4. **`components/report-builder/use-report.ts`** - Report state management
5. **`components/dashboard/dashboard-hooks.ts`** - Dashboard query hooks

## Type Safety Flow

```
Model Definition (query-layer)
    ↓ $inferRequest, $inferDimensions, $inferMetrics
Query Functions (query-examples)
    ↓ Return types
Server Actions (app/actions.ts)
    ↓ Same types
Frontend Hooks (dashboard-hooks.ts)
    ↓ React Query typed
UI Components
```

Invalid columns/metrics are caught at compile time, not runtime.

## Running Locally

```bash
# Terminal 1: MooseStack dev server
cd moose && pnpm dev

# Terminal 2: Seed data
cd moose && pnpm seed

# Terminal 3: Next.js
pnpm dev
```

URLs:
- Dashboard: http://localhost:3000
- Report Builder: http://localhost:3000/builder

## Limitations

- **No Materialized Views**: Queries a raw `Events` table, not pre-aggregated MVs. In production, you'd create MVs for pre-joined/pre-aggregated data.
- **No CDC**: Data seeded via SQL, not streamed from OLTP.
- **No JIT join translation**: Doesn't show how to convert OLTP JOIN queries to write-time MVs.
- Query layer (`defineQueryModel`) is prototype, not yet in core Moose library.
- No auth/permission filtering demonstrated.

**Roadmap:** Future iteration will extend this demo to show full MV pattern for translating OLTP just-in-time joins.
