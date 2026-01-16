/**
 * 04 - Aggregations & GROUP BY
 *
 * Define metrics (aggregates) in your model and use GROUP BY.
 * Use .build() for custom SQL assembly when you need full control.
 */

import { sql } from "@514labs/moose-lib";
import { tags } from "typia";
import { executeQuery } from "../client";
import { Events } from "../models";
import {
  defineQueryModel,
  defineMapper,
  InferParams,
  InferDimensions,
  InferMetrics,
  InferResult,
} from "../queryModel";
import { count, sum, avg, min, max, groupBy, orderBy, raw } from "../utils";

// =============================================================================
// Query Model with Dimensions & Metrics
// =============================================================================

const statsModel = defineQueryModel({
  table: Events,

  // Dimensions: columns for grouping and filtering (all are automatically groupable)
  dimensions: {
    status: Events.columns.status,
    timestamp: Events.columns.event_time,
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

// =============================================================================
// API Params
// =============================================================================

// Types inferred from the model - no manual definitions needed!
type Dimension = InferDimensions<typeof statsModel>;
type Metric = InferMetrics<typeof statsModel>;

export interface StatsParams {
  // Filter params
  startDate?: string & tags.Format<"date">;
  endDate?: string & tags.Format<"date">;
  status?: "completed" | "active" | "inactive";

  // Dynamic field selection (types inferred from model)
  dimensions?: Dimension[];
  metrics?: Metric[];

  // Grouping (any dimension)
  groupBy?: Dimension;
}

const toQueryParams = defineMapper<StatsParams>()(statsModel, {
  startDate: ["timestamp", "gte"],
  endDate: ["timestamp", "lte"],
  status: ["status", "eq"],
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
  // Combine dimensions + metrics into select list
  const select = [
    ...(params.dimensions ?? ["status"]),
    ...(params.metrics ?? ["totalEvents", "totalAmount"]),
  ];

  const queryParams: InferParams<typeof statsModel> = {
    ...toQueryParams(params),
    select,
    groupBy: params.groupBy ? [params.groupBy] : undefined,
  };

  const query = statsModel.toSql(queryParams);
  return executeQuery<Partial<StatsResult>>(query);
}

/**
 * Get stats with GROUP BY using the model's dimensions and metrics.
 * Uses parts.dimensions and parts.metrics for clean separation.
 */
export async function getStats(params: StatsParams): Promise<StatsResult[]> {
  const groupByDim: Dimension = params.groupBy ?? "status";

  // Select the grouping dimension + all metrics
  const queryParams: InferParams<typeof statsModel> = {
    ...toQueryParams(params),
    select: [
      groupByDim,
      ...(params.metrics ?? [
        "totalEvents",
        "totalAmount",
        "avgAmount",
        "minAmount",
        "maxAmount",
        "highValueRatio",
      ]),
    ],
    groupBy: [groupByDim],
  };

  const query = statsModel.build(
    queryParams,
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
  const queryParams: InferParams<typeof statsModel> = {
    ...toQueryParams(params),
    select: params.metrics ?? [
      "totalEvents",
      "totalAmount",
      "avgAmount",
      "minAmount",
      "maxAmount",
      "highValueRatio",
    ],
  };

  const { metrics, from, where } = statsModel.toParts(queryParams);

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
