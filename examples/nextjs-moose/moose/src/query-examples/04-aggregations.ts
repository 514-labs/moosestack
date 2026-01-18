/* 04 - Aggregations & GROUP BY
 *
 * Define metrics (aggregates) in your model and use GROUP BY.
 * Use .build() for custom SQL assembly when you need full control.
 *
 * **This example uses QueryMapper** - an alternative to QueryBuilder.
 * Use QueryMapper when transforming custom API shapes (e.g., from HTTP requests).
 * Use QueryBuilder when building queries programmatically in code.
 * Both produce QueryRequest objects that get resolved and executed.
 */

import { sql } from "@514labs/moose-lib";
import { tags } from "typia";
import { executeQuery } from "../client";
import { Events } from "../models";
import {
  InferRequest,
  InferResult,
  InferDimensionNames,
  InferMetricNames,
  defineQueryModel,
  defineMapper,
} from "../query-layer";
import { count, sum, avg, min, max, orderBy } from "../query-layer/utils";

// =============================================================================
// Query Model with Dimensions & Metrics
// =============================================================================

export const statsModel = defineQueryModel({
  table: Events,

  // Dimensions: columns for grouping and filtering (all are automatically groupable)
  dimensions: {
    status: { column: "id" },
    timestamp: { column: "event_time" },
    day: { expression: sql`toDate(${Events.columns.event_time})`, as: "day" },
    month: {
      expression: sql`toStartOfMonth(${Events.columns.event_time})`,
      as: "month",
    },
  },

  // Metrics: aggregates computed over dimensions
  metrics: {
    totalEvents: { agg: count(), as: "total_events" },
    totalAmount: { agg: sum(Events.columns.amount), as: "total_amount" },
    avgAmount: { agg: avg(Events.columns.amount), as: "avg_amount" },
    minAmount: { agg: min(Events.columns.amount), as: "min_amount" },
    maxAmount: { agg: max(Events.columns.amount), as: "max_amount" },
    highValueRatio: {
      agg: sql`countIf(${Events.columns.amount} > 100) / count(*)`,
      as: "high_value_ratio",
    },
  },

  filters: {
    timestamp: { column: "event_time", operators: ["gte", "lte"] as const },
    status: { column: "status", operators: ["eq", "in"] as const },
    amount: { column: "amount", operators: ["gte", "lte"] as const },
  },

  sortable: ["total_amount", "total_events", "avg_amount"] as const,
  defaults: {},
});

export type StatsDimension = InferDimensionNames<typeof statsModel>;
export type StatsMetric = InferMetricNames<typeof statsModel>;

// =============================================================================
// API Params
// =============================================================================

// Types inferred from the model - no manual definitions needed!
// These are kept for backwards compatibility but resolve to the direct literal exports
export type Dimension = StatsDimension;
export type Metric = StatsMetric;

export interface StatsParams {
  // Filter params
  startDate?: string & tags.Format<"date">;
  endDate?: string & tags.Format<"date">;
  status?: "completed" | "active" | "inactive";

  // Dynamic field selection (arrays of dimension/metric names)
  dimensions?: StatsDimension[];
  metrics?: StatsMetric[];
}

// =============================================================================
// QueryMapper: Transform API params → QueryRequest
// =============================================================================
// Alternative approach: Use QueryBuilder for programmatic query building
const mapToQueryRequest = defineMapper<StatsParams>()(statsModel, {
  startDate: ["timestamp", "gte"],
  endDate: ["timestamp", "lte"],
  status: ["status", "eq"],
  // Pass-through: dimensions and metrics map directly
  dimensions: "dimensions",
  metrics: "metrics",
});

// =============================================================================
// Result Type (inferred from model)
// =============================================================================

// Result type inferred from the model's dimensions and metrics
type StatsResult = InferResult<typeof statsModel>;
// Equivalent to:
// {
//   status?: string;
//   timestamp?: string;
//   day?: string;
//   month?: string;
//   totalEvents: number;
//   totalAmount: number;
//   avgAmount: number;
//   minAmount: number;
//   maxAmount: number;
//   highValueRatio: number;
// }

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get stats with dynamic dimension and metric selection.
 * Only returns the fields you ask for.
 */
export async function getStatsSimple(
  params: StatsParams,
): Promise<Partial<StatsResult>[]> {
  const request = mapToQueryRequest({
    ...params,
    dimensions: params.dimensions ?? ["status"],
    metrics: params.metrics ?? ["totalEvents", "totalAmount"],
  });

  const query = statsModel.toSql(request);
  return executeQuery<Partial<StatsResult>>(query);
}

/**
 * Get stats with GROUP BY using the model's dimensions and metrics.
 * Uses parts.dimensions and parts.metrics for clean separation.
 */
export async function getStats(params: StatsParams): Promise<StatsResult[]> {
  const groupByDim = params.dimensions?.[0] ?? "status";

  // Select the grouping dimension + all metrics
  const metricsToSelect = params.metrics ?? [
    "totalEvents",
    "totalAmount",
    "avgAmount",
    "minAmount",
    "maxAmount",
    "highValueRatio",
  ];

  const request = mapToQueryRequest({
    ...params,
    dimensions: [groupByDim],
    metrics: metricsToSelect,
  });

  const query = statsModel.build(
    request,
    (parts) => sql`
    SELECT ${parts.dimensions}, ${parts.metrics}
    ${parts.from}
    ${parts.where}
    ${parts.groupBy}
    ${orderBy([sql`total_amount`, "DESC"])}
  `,
  );

  return executeQuery<StatsResult>(query);
}

/**
 * Get overall stats (no grouping) - just metrics.
 */
export async function getOverallStats(
  params: StatsParams,
): Promise<StatsResult> {
  // Select only metrics (no dimensions = no grouping)
  const request = mapToQueryRequest({
    ...params,
    metrics: params.metrics ?? [
      "totalEvents",
      "totalAmount",
      "avgAmount",
      "minAmount",
      "maxAmount",
      "highValueRatio",
    ],
  });

  const { metrics, from, where } = statsModel.toParts(request);

  const query = sql`
    SELECT ${metrics}
    ${from}
    ${where}
  `;

  const [result] = await executeQuery<StatsResult>(query);
  return result;
}

// =============================================================================
// Usage
// =============================================================================

/*
// ─────────────────────────────────────────────────────────────────────────────
// Dimensions & Metrics: Clear Semantic Separation
// ─────────────────────────────────────────────────────────────────────────────

// Select specific dimensions and metrics
await getStatsSimple({
  dimensions: ["status"],
  metrics: ["totalEvents", "totalAmount"],
  groupBy: "status",
});
// → SELECT status, COUNT(*) AS total_events, SUM(amount) AS total_amount
//   FROM events GROUP BY status

// Group by computed dimension (day or month)
await getStatsSimple({
  dimensions: ["day"],
  metrics: ["totalEvents", "totalAmount", "avgAmount"],
  groupBy: "day",
});
// → SELECT toDate(event_time) AS day, COUNT(*), SUM(amount), AVG(amount)
//   FROM events GROUP BY toDate(event_time)

// Just metrics (no dimensions = overall totals)
await getOverallStats({
  metrics: ["totalEvents", "totalAmount"],
  startDate: "2024-01-01",
});
// → SELECT COUNT(*) AS total_events, SUM(amount) AS total_amount
//   FROM events WHERE event_time >= '2024-01-01'

// ─────────────────────────────────────────────────────────────────────────────
// Using parts.dimensions and parts.metrics for custom assembly
// ─────────────────────────────────────────────────────────────────────────────

// Group by status
await getStats({ groupBy: "status", startDate: "2024-01-01" });
// → [
//   { status: "active", total_events: 150, total_amount: 25000, ... },
//   { status: "completed", total_events: 300, total_amount: 75000, ... },
// ]

// Group by month (computed dimension)
await getStats({ groupBy: "month", startDate: "2024-01-01" });
// → [
//   { month: "2024-01-01", total_events: 100, ... },
//   { month: "2024-02-01", total_events: 120, ... },
// ]

// Overall stats (no grouping)
await getOverallStats({ startDate: "2024-01-01" });
// → { total_events: 450, total_amount: 100000, avg_amount: 222.22, ... }
*/
