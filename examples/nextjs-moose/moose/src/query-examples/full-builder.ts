/* 04 - Aggregations & GROUP BY
 *
 * Define metrics (aggregates) in your model and use GROUP BY.
 * Use toParts() for custom SQL assembly when you need full control.
 */

import { sql, getMooseClients } from "@514labs/moose-lib";
import { Events } from "../models";
import { defineQueryModel, orderBy } from "../query-layer";
import { tags } from "typia";
// =============================================================================
// Query Model with Dimensions & Metrics
// =============================================================================

export const statsModel = defineQueryModel({
  table: Events,

  // Dimensions: columns for grouping and filtering
  dimensions: {
    status: { column: "status" },
    day: { expression: sql`toDate(${Events.columns.event_time})`, as: "day" },
    month: {
      expression: sql`toStartOfMonth(${Events.columns.event_time})`,
      as: "month",
    },
  },

  // Metrics: aggregates computed over dimensions
  metrics: {
    totalEvents: { agg: sql`count(*)`, as: "total_events" },
    totalAmount: {
      agg: sql`sum(${Events.columns.amount})`,
      as: "total_amount",
    },
    avgAmount: { agg: sql`avg(${Events.columns.amount})`, as: "avg_amount" },
    minAmount: { agg: sql`min(${Events.columns.amount})`, as: "min_amount" },
    maxAmount: { agg: sql`max(${Events.columns.amount})`, as: "max_amount" },
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

// Type exports derived from the model
export type StatsDimension = typeof statsModel.$inferDimensions;
export type StatsMetric = typeof statsModel.$inferMetrics;
export type StatsFilterParams = typeof statsModel.$inferFilters;
export type StatsRequest = typeof statsModel.$inferRequest;

// =============================================================================
// API Params
// =============================================================================

export interface StatsParams {
  // Filter params
  startDate?: string & tags.Format<"date">;
  endDate?: string & tags.Format<"date">;
  status?: "completed" | "active" | "inactive";

  // Dynamic field selection
  dimensions?: StatsDimension[];
  metrics?: StatsMetric[];
}

// =============================================================================
// Mapping Function
// =============================================================================

/**
 * Maps API params to QueryRequest.
 * Note: Date strings are converted to Date objects to match the model's type.
 */
function mapToQueryRequest(params: StatsParams): StatsRequest {
  return {
    filters: {
      ...(params.startDate && {
        timestamp: { gte: new Date(params.startDate) },
      }),
      ...(params.endDate && { timestamp: { lte: new Date(params.endDate) } }),
      ...(params.status && { status: { eq: params.status } }),
    },
    dimensions: params.dimensions,
    metrics: params.metrics,
  };
}

// =============================================================================
// Result Type
// =============================================================================

interface StatsResult {
  status?: string;
  day?: string;
  month?: string;
  total_events?: number;
  total_amount?: number;
  avg_amount?: number;
  min_amount?: number;
  max_amount?: number;
  high_value_ratio?: number;
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get stats with dynamic dimension and metric selection.
 */
export async function getStatsSimple(
  params: StatsParams,
): Promise<StatsResult[]> {
  const request = mapToQueryRequest({
    ...params,
    dimensions: params.dimensions ?? ["status"],
    metrics: params.metrics ?? ["totalEvents", "totalAmount"],
  });

  const { client } = await getMooseClients();
  return statsModel.query(request, client.query);
}

/**
 * Get stats using toParts() for custom SQL assembly.
 */
export async function getStats(params: StatsParams): Promise<StatsResult[]> {
  const groupByDim = params.dimensions?.[0] ?? "status";
  const metricsToSelect = params.metrics ?? [
    "totalEvents",
    "totalAmount",
    "avgAmount",
  ];

  const request = mapToQueryRequest({
    ...params,
    dimensions: [groupByDim],
    metrics: metricsToSelect,
  });

  // Use toParts() for custom assembly
  const parts = statsModel.toParts(request);
  const query = sql`
    SELECT ${parts.dimensions}, ${parts.metrics}
    ${parts.from}
    ${parts.where}
    ${parts.groupBy}
    ${orderBy([sql`total_amount`, "DESC"])}
  `;

  const { client } = await getMooseClients();
  const result = await client.query.execute(query);
  return result.json();
}

/**
 * Get overall stats (no grouping) - just metrics.
 */
export async function getOverallStats(
  params: StatsParams,
): Promise<StatsResult> {
  const request = mapToQueryRequest({
    ...params,
    metrics: params.metrics ?? [
      "totalEvents",
      "totalAmount",
      "avgAmount",
      "minAmount",
      "maxAmount",
    ],
  });

  const { metrics, from, where } = statsModel.toParts(request);

  const query = sql`
    SELECT ${metrics}
    ${from}
    ${where}
  `;

  const { client } = await getMooseClients();
  const result = await client.query.execute(query);
  const rows = (await result.json()) as StatsResult[];
  return rows[0];
}

// =============================================================================
// Usage
// =============================================================================

/*
// Select specific dimensions and metrics
await getStatsSimple({
  dimensions: ["status"],
  metrics: ["totalEvents", "totalAmount"],
});
// → SELECT status, COUNT(*) AS total_events, SUM(amount) AS total_amount
//   FROM events GROUP BY status

// Group by computed dimension (day or month)
await getStatsSimple({
  dimensions: ["day"],
  metrics: ["totalEvents", "totalAmount", "avgAmount"],
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

// Group by status with custom SQL assembly
await getStats({ startDate: "2024-01-01" });
// → [
//   { status: "active", total_events: 150, total_amount: 25000, ... },
//   { status: "completed", total_events: 300, total_amount: 75000, ... },
// ]
*/
