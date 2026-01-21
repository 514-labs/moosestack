# Next.js + MooseStack Dashboard

A Next.js demo app showing how to build fast customer-facing dashboards on ClickHouse using a small query/metrics layer. Target audience: product engineers who know Postgres dashboards and want to move to ClickHouse without a huge refactor.

## What This Demo Shows

This example demonstrates **Step 2** of the "two-step migration pattern" from the [Performant Dashboards Guide](../../apps/framework-docs-v2/content/guides/performant-dashboards.mdx):

1. ~~Shift just-in-time joins to write-time via Materialized Views~~ *(not yet shown in this demo)*
2. **Accelerate endpoint creation with the query layer** *(this demo)*

**This demo assumes your Materialized Views (or OLAP tables) already exist.** It focuses on the query layer pattern for rapidly building type-safe API endpoints on top of those tables. The `Events` table here is a simple stand-in for what would be a pre-aggregated MV in production.

> **Roadmap:** Extending this demo to showcase the full MV pattern—translating OLTP just-in-time joins to write-time MVs—is planned for a future iteration.

## Architecture (Conceptual)

```
┌─────────────┐    ┌─────────┐    ┌────────────┐    ┌─────────────┐    ┌───────────┐
│  OLTP DB    │───▶│   CDC   │───▶│ ClickHouse │───▶│   Query     │───▶│   React   │
│ (Postgres)  │    │         │       Tables/MVs│    │   Layer     │    │ Dashboard │
└─────────────┘    └─────────┘    └────────────┘    └─────────────┘    └───────────┘
                                        │                  │
                                  Write-time          Read-time
                                  transforms          selection
                                  (pre-joined,        sorting, paginatiom
                                   pre-aggregated)         ▲
                                                           │
                                                    THIS DEMO FOCUSES HERE
```

OLTP dashboards compute joins at read time. 
OLAP dashboards pre-compute joins at write time via Materialized Views, then use a thin query layer to select/filter/sort the pre-computed data. 

## Core Concepts

### 1. Query Layer (`moose/src/query-layer/`)

The query layer provides a **semantic model** over your ClickHouse tables:

- **Dimensions**: Columns you can group by (e.g., `status`, `day`, `month`)
- **Metrics**: Aggregations computed over dimensions (e.g., `totalEvents`, `avgAmount`)
- **Filters**: Allowed filter operations with type safety
- **Sortable**: Which fields can be sorted

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

### 2. Query Functions (`moose/src/query-examples/`)

Query functions in the moose package use the model to build type-safe SQL:

```typescript
// moose/src/query-examples/events-metrics.ts
import { eventsModel } from "./model";
import { executeQuery } from "../client";

export async function getEventsMetrics(startDate?: Date, endDate?: Date) {
  // Model builds type-safe SQL - invalid dimensions/metrics caught at compile time
  const query = eventsModel.toSql({
    dimensions: [],
    metrics: ["totalEvents", "totalAmount", "avgAmount", "minAmount", "maxAmount", "highValueRatio"],
    filters: {
      timestamp: { gte: startDate, lte: endDate },
    },
  });

  return await executeQuery<{ totalEvents: number; totalAmount: number; /* ... */ }>(query);
}
```

### 3. Import Query Handlers into Your Backend (`app/actions.ts`)

**This is the key pattern.** The moose package exports type-safe **query handler functions** built on top of OLAP objects. You import these compiled functions into whatever backend framework you're using—Next.js server actions in this example, but it could be Express, Fastify, or any Node.js backend.

```typescript
// app/actions.ts
"use server";

// Import compiled query handlers from the moose package
// These are type-safe functions built on defineQueryModel + OLAP tables
import { getEventsMetrics, getEventsTimeseries, runEventsQuery, eventsModel } from "moose";

// Use the query handlers in your backend
export async function getMetrics(startDate?: string, endDate?: string) {
  // getEventsMetrics is a pre-built query handler from moose
  const results = await getEventsMetrics(parseDate(startDate), parseDate(endDate));
  return results[0];
}

// For dynamic queries, pass params to the model-based handler
export async function executeEventsQuery(params: typeof eventsModel.$inferRequest) {
  // runEventsQuery validates params and executes against the model
  const results = await runEventsQuery(params);
  return results;
}
```

Why do this? Define your query logic once in the moose package using `defineQueryModel`, export query handler functions, then import them into any backend. The moose package owns the OLAP schema, query building, and type safety. Your backend just calls the handlers.

### 4. Dashboard Hooks (`components/dashboard/`)

React hooks call server actions and manage query state. The hooks don't know about ClickHouse - they just call the server actions:

```typescript
// components/dashboard/dashboard-hooks.ts
import { getMetrics } from "@/app/actions";

export function useMetrics() {
  const { startDate, endDate } = useDashboardFilters(); // Global filter state
  
  return useQuery({
    queryKey: ["metrics", startDate, endDate],
    queryFn: () => getMetrics(startDate, endDate), // Calls server action → moose query function
  });
}
```

### 5. Report Builder (`components/report-builder/`)

A dynamic UI that lets users select dimensions, metrics, and filters at runtime:

- `useReport()` hook - Manages report state and query execution, designed to work with the query model
- `prepareModel()` - Transforms backend model to frontend-friendly format
- Chip-based UI for selecting dimensions/metrics

## Prerequisites

- Node.js 20+
- pnpm
- Docker Desktop (for local ClickHouse)

## Setup

1. **Install dependencies**:

```bash
pnpm install
```

2. **Configure environment** — create `.env.local`:

```bash
MOOSE_CLIENT_ONLY=true
MOOSE_CLICKHOUSE_CONFIG__DB_NAME=local
MOOSE_CLICKHOUSE_CONFIG__HOST=localhost
MOOSE_CLICKHOUSE_CONFIG__PORT=18123
MOOSE_CLICKHOUSE_CONFIG__USER=panda
MOOSE_CLICKHOUSE_CONFIG__PASSWORD=pandapass
MOOSE_CLICKHOUSE_CONFIG__USE_SSL=false
```

3. **Start MooseStack dev server** (runs ClickHouse via Docker):

```bash
cd moose
pnpm dev
```

4. **Seed sample data** (in a separate terminal):

```bash
cd moose
pnpm seed
```

5. **Start Next.js** (in another terminal):

```bash
pnpm dev
```

6. Open the app:
   - Dashboard: [http://localhost:3000](http://localhost:3000)
   - Report Builder: [http://localhost:3000/builder](http://localhost:3000/builder)

## Guided Tour

### Key Files

| Path | What It Does |
|------|--------------|
| `moose/src/query-layer/query-model.ts` | Core `defineQueryModel()` function - the heart of the query layer |
| `moose/src/query-examples/model.ts` | Example model definition showing dimensions, metrics, filters |
| `moose/src/query-examples/events-*.ts` | Pre-built query functions using the model |
| `app/actions.ts` | Server actions that call query functions (keeps credentials server-side) |
| `app/page.tsx` | Dashboard page consuming hooks |
| `app/builder/page.tsx` | Report builder page with dynamic query UI |
| `components/report-builder/use-report.ts` | Hook that manages report state and query execution |

### Data Flow (Frontend ↔ Backend)

The key insight: **Client components never touch ClickHouse directly**. They call server actions, which call moose query functions, which use the query model to build type-safe SQL.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                                              │
│                                                                               │
│  app/page.tsx                 components/dashboard/dashboard-hooks.ts        │
│  ┌─────────────────┐          ┌─────────────────────────────────────┐        │
│  │ <MetricCards /> │ ──uses── │ useMetrics() {                      │        │
│  └─────────────────┘          │   return useQuery({                 │        │
│                               │     queryFn: () => getMetrics(...)  │ ───┐   │
│                               │   })                                │    │   │
│                               │ }                                   │    │   │
│                               └─────────────────────────────────────┘    │   │
└──────────────────────────────────────────────────────────────────────────│───┘
                                                                           │
                                                          Server Action Call
                                                                           │
┌──────────────────────────────────────────────────────────────────────────│───┐
│ BACKEND (Next.js Server Actions)                                         │   │
│                                                                          ▼   │
│  app/actions.ts                                                              │
│  ┌───────────────────────────────────────────────────────────────────┐      │
│  │ export async function getMetrics(startDate, endDate) {            │      │
│  │   const results = await getEventsMetrics(start, end);  // ────────┼──┐   │
│  │   return results[0];                                              │  │   │
│  │ }                                                                 │  │   │
│  └───────────────────────────────────────────────────────────────────┘  │   │
└─────────────────────────────────────────────────────────────────────────│───┘
                                                                          │
                                                         Moose Function Call
                                                                          │
┌─────────────────────────────────────────────────────────────────────────│───┐
│ MOOSE PACKAGE (moose/src/)                                              │   │
│                                                                         ▼   │
│  query-examples/events-metrics.ts                                           │
│  ┌───────────────────────────────────────────────────────────────────┐      │
│  │ export async function getEventsMetrics(startDate, endDate) {      │      │
│  │   const query = eventsModel.toSql({                               │      │
│  │     metrics: ["totalEvents", "totalAmount", ...],                 │      │
│  │     filters: { timestamp: { gte: startDate, lte: endDate } }      │      │
│  │   });                                                             │      │
│  │   return await executeQuery(query);  // ──────────────────────────┼──┐   │
│  │ }                                                                 │  │   │
│  └───────────────────────────────────────────────────────────────────┘  │   │
│                                                                         │   │
│  query-examples/model.ts (defines eventsModel)                          │   │
│  query-layer/query-model.ts (defineQueryModel implementation)           │   │
└─────────────────────────────────────────────────────────────────────────│───┘
                                                                          │
                                                            ClickHouse Query
                                                                          ▼
                                                                   ┌───────────┐
                                                                   │ClickHouse │
                                                                   └───────────┘
```

**Why this matters:**
- Type safety flows from model → query function → server action → hook
- Database credentials stay server-side (in moose package)
- Frontend only knows about the server action API shape
- Adding a new metric/filter to the model automatically flows through the entire stack

## Key "Aha" Demos

### 1. Add a new filter to the model

In `moose/src/query-examples/model.ts`, add a filter:

```typescript
filters: {
  // ... existing filters
  amount: { column: "amount", operators: ["gte", "lte"] as const },
}
```

The filter is now available in the report builder UI automatically.

### 2. Add a new metric

In `moose/src/query-examples/model.ts`, add a metric:

```typescript
metrics: {
  // ... existing metrics
  uniqueStatuses: { agg: sql`uniqExact(${Events.columns.status})` },
}
```

Use it in a dashboard widget by adding to `useMetrics()` or in the report builder.

### 3. See TypeScript catch invalid columns

Try requesting a non-existent dimension:

```typescript
const query = eventsModel.toSql({
  dimensions: ["nonExistent"], // ❌ TypeScript error!
  metrics: ["totalEvents"],
});
```

TypeScript catches this at compile time, not runtime.

### 4. Explore the report builder

1. Go to [http://localhost:3000/builder](http://localhost:3000/builder)
2. Toggle different metrics and dimensions
3. Apply filters
4. Watch the query execute and results update

## How This Maps to the Guide

| Guide Concept | Demo Status |
|---------------|-------------|
| **Write-time transforms (MVs)** | *Not demonstrated.* This demo uses a raw table. Future work will show MV creation for pre-joined/pre-aggregated data. |
| **Read-time selection (Query Layer)** | **Demonstrated.** `defineQueryModel()` provides safe, typed selection of dimensions/metrics at query time. |
| **Maintainable dashboards** | **Demonstrated.** Dashboard components use hooks that auto-refresh when filters change. Adding new metrics/dimensions is a one-line change. |
| **Frontend contract preserved** | **Demonstrated.** Server actions maintain the same API shape. Frontend doesn't know about ClickHouse. |
| **OLTP → OLAP migration** | *Partially demonstrated.* The query layer pattern is shown; the MV translation pattern is future work. |

## Limitations / Non-Goals

### What this demo does NOT show

- **No Materialized Views**: This demo queries a simple `Events` table, not pre-aggregated MVs. In production, you'd create MVs that pre-join and pre-aggregate data at write time, then point the query model at those MVs.
- **No CDC**: Data is seeded via SQL, not streamed from an OLTP database via Debezium.
- **No just-in-time join translation**: The demo doesn't show how to convert OLTP JOIN queries into write-time MVs.

> **Roadmap:** A future iteration will extend this demo to show the full pattern: translating OLTP just-in-time joins into ClickHouse Materialized Views, then using the query layer on top.

### What's copy-pasteable today

- **Query layer pattern** (`moose/src/query-layer/`): Production-ready pattern for building type-safe query APIs on top of existing OLAP tables or MVs
- **Report builder components**: Reusable UI for building dynamic reports
- **Dashboard hooks pattern**: React Query + provider pattern for filter coordination

### What's not yet in Moose/Boreal

- The query layer (`defineQueryModel`) is a prototype pattern, not yet part of the core Moose library
- Copy the `query-layer/` folder into your project to use it

## Learn More

- [MooseStack + Next.js Guide](https://docs.fiveonefour.com/moosestack/getting-started/existing-app/next-js)
- [Performant Dashboards Guide](../../apps/framework-docs-v2/content/guides/performant-dashboards.mdx)
- [OlapTable Reference](https://docs.fiveonefour.com/moosestack/olap/model-table)
- [Migrations](https://docs.fiveonefour.com/moosestack/migrate)
