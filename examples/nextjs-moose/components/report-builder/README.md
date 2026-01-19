# Report Builder

A generic, reusable report builder component for building interactive query UIs that integrate with Moose QueryModel instances.

## Overview

The Report Builder provides a type-safe, configurable UI for:
- Selecting breakdown dimensions (how to segment/group data)
- Selecting metrics (aggregate calculations)
- Date range filtering
- Auto-refreshing results when selections change

It's designed to work with any QueryModel instance, providing a clean separation between the query layer and the UI layer.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Page                              │
│                    (Server Component)                            │
│                           │                                      │
│                           ▼                                      │
│              ┌─────────────────────────┐                        │
│              │    ReportBuilder        │ ◄── Generic component   │
│              │  (Client Component)     │     with config props   │
│              └───────────┬─────────────┘                        │
│                          │                                       │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Dimensions  │  │   Metrics   │  │   Server    │             │
│  │  Metadata   │  │  Metadata   │  │   Action    │             │
│  └─────────────┘  └─────────────┘  └──────┬──────┘             │
│                                           │                     │
│                                           ▼                     │
│                              ┌─────────────────────┐            │
│                              │  QueryModel         │            │
│                              │  (getStatsSimple)   │            │
│                              └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
components/
├── report-builder/
│   ├── index.ts              # Barrel exports
│   ├── types.ts              # TypeScript types & interfaces
│   ├── report-builder.tsx    # Generic ReportBuilder component
│   ├── results-table.tsx     # Results table component
│   └── README.md             # This documentation

app/
├── reports/
│   └── 04/
│       ├── page.tsx          # Page with ReportBuilder
│       └── actions.ts        # Server Action for statsModel
```

## Usage Pattern

### Step 1: Create a Server Action

Create a Server Action that wraps your QueryModel's query function:

```ts
// app/reports/my-report/actions.ts
"use server";

import { getMyQueryData, MyDimension, MyMetric } from "moose";
import type { ReportQueryParams } from "@/components/report-builder";

// Extract the result row type
export type MyResultRow = Awaited<ReturnType<typeof getMyQueryData>>[number];

export async function executeMyQuery(
  params: ReportQueryParams<MyDimension, MyMetric>,
): Promise<MyResultRow[]> {
  return await getMyQueryData({
    dimensions: params.breakdown,  // breakdown maps to dimensions in query
    metrics: params.metrics,
    startDate: params.startDate,
    endDate: params.endDate,
  });
}
```

### Step 2: Create a Page with ReportBuilder

```tsx
// app/reports/my-report/page.tsx
import { ReportBuilder, FieldMeta } from "@/components/report-builder";
import { executeMyQuery } from "./actions";
import type { MyDimension, MyMetric } from "moose";

// Define dimension metadata for UI
const DIMENSIONS: readonly FieldMeta<MyDimension>[] = [
  { id: "category", label: "Category", description: "Product category" },
  { id: "region", label: "Region", description: "Sales region" },
  { id: "date", label: "Date", description: "Transaction date" },
] as const;

// Define metric metadata for UI
const METRICS: readonly FieldMeta<MyMetric>[] = [
  { id: "totalSales", label: "Total Sales", description: "Sum of sales" },
  { id: "avgOrder", label: "Avg Order", description: "Average order value" },
  { id: "orderCount", label: "Orders", description: "Number of orders" },
] as const;

export default function MyReportPage() {
  return (
    <div className="container mx-auto p-6">
      <ReportBuilder
        dimensions={DIMENSIONS}
        metrics={METRICS}
        execute={executeMyQuery}
        title="Sales Report"
        description="Analyze sales by category and region"
        defaultBreakdown={["category"]}
        defaultMetrics={["totalSales", "orderCount"]}
        showDateFilter={true}
      />
    </div>
  );
}
```

## Component API

### ReportBuilder

The generic report builder component.

```tsx
interface ReportBuilderProps<TDimension, TMetric, TResult> {
  // Required
  dimensions: readonly FieldMeta<TDimension>[];  // Available dimensions for breakdown
  metrics: readonly FieldMeta<TMetric>[];        // Available metrics
  execute: (params: ReportQueryParams) => Promise<TResult[]>;

  // Optional UI customization
  title?: string;                    // Header title
  description?: string;              // Header description
  defaultBreakdown?: TDimension[];   // Initially selected breakdown dimensions
  defaultMetrics?: TMetric[];        // Initially selected metrics
  showDateFilter?: boolean;          // Show date range inputs (default: true)
}
```

### FieldMeta

Metadata for dimension/metric UI display.

```tsx
interface FieldMeta<TId extends string> {
  id: TId;           // Field identifier (must match QueryModel key)
  label: string;     // Display label
  description?: string;  // Tooltip description
}
```

### ReportQueryParams

Parameters passed to the execute function.

```tsx
interface ReportQueryParams<TDimension, TMetric> {
  breakdown?: TDimension[];  // Dimensions to group/segment by
  metrics?: TMetric[];       // Metrics to aggregate
  startDate?: string;        // Optional date filter
  endDate?: string;          // Optional date filter
}
```

## Concepts

### Breakdown vs Dimensions

The UI uses "Breakdown" to describe the dimensions you want to segment your data by. This is clearer than having separate "Dimensions" and "Group By" controls:

- **Breakdown**: Select which dimensions to segment data by (e.g., "by status", "by day")
- These become both the SELECT columns and GROUP BY clause in the underlying SQL

This single-control approach avoids confusion since in SQL aggregation queries, the columns you SELECT must match your GROUP BY.

### Metrics

Metrics are the aggregate values calculated for each breakdown segment:
- Count, sum, average, min, max, etc.
- Multiple metrics can be selected simultaneously

## Features

### Auto-Refresh on Selection Change

The ReportBuilder uses React Query's `useQuery` hook with the query parameters as the query key. This means:
- Results automatically refresh when any selection changes
- Queries are cached and deduplicated
- Background refetching happens seamlessly

### Type Safety

The component is fully generic and provides type safety for:
- Dimension IDs (must match QueryModel dimension keys)
- Metric IDs (must match QueryModel metric keys)
- Result row types (inferred from query function)

### Server Actions Integration

The execute function is a Server Action, which means:
- Query logic runs on the server
- No API routes needed
- Secure access to database/services
- Automatic serialization of results

## Integration with QueryModel

The Report Builder is designed to work with Moose QueryModel instances:

```
┌──────────────────────────────────────────────────────────────┐
│                      QueryModel (moose)                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ defineQueryModel({                                      │ │
│  │   table: Events,                                        │ │
│  │   dimensions: {                                         │ │
│  │     status: { column: "id" },          ──────────┐      │ │
│  │     day: { expression: sql`...` },               │      │ │
│  │   },                                             │      │ │
│  │   metrics: {                                     │      │ │
│  │     totalEvents: { agg: count() },     ──────────┤      │ │
│  │     totalAmount: { agg: sum(...) },              │      │ │
│  │   },                                             │      │ │
│  │ })                                               │      │ │
│  └─────────────────────────────────────────────────│──────┘ │
│                                                     │        │
│  Exported types:                                    │        │
│  - StatsDimension = "status" | "day" | ...         ◄┘        │
│  - StatsMetric = "totalEvents" | "totalAmount" | ...         │
│  - getStatsSimple(params) => Promise<Result[]>               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Report Builder (frontend)                  │
│                                                               │
│  Server Action imports and calls getStatsSimple               │
│  UI metadata (labels, descriptions) defined separately        │
│  Type safety via StatsDimension, StatsMetric types            │
└──────────────────────────────────────────────────────────────┘
```

The dimension/metric IDs in the UI must match the keys defined in the QueryModel. TypeScript enforces this at compile time.

## Example: Stats Report

See the complete implementation in `app/reports/04/`:

```tsx
// app/reports/04/page.tsx
import { ReportBuilder, FieldMeta } from "@/components/report-builder";
import { executeStatsQuery } from "./actions";
import type { StatsDimension, StatsMetric } from "moose";

const DIMENSIONS: readonly FieldMeta<StatsDimension>[] = [
  { id: "status", label: "Status", description: "Event status" },
  { id: "day", label: "Day", description: "Day (date)" },
] as const;

const METRICS: readonly FieldMeta<StatsMetric>[] = [
  { id: "totalEvents", label: "Total Events", description: "Count of events" },
  { id: "totalAmount", label: "Total Amount", description: "Sum of amounts" },
] as const;

export default function StatsReportPage() {
  return (
    <ReportBuilder
      dimensions={DIMENSIONS}
      metrics={METRICS}
      execute={executeStatsQuery}
      title="Events Report Builder"
      defaultBreakdown={["status"]}
      defaultMetrics={["totalEvents", "totalAmount"]}
    />
  );
}
```
