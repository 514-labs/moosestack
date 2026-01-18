/**
 * 05 - Fluent Builder
 *
 * Use buildQuery() for a fluent, chainable API to build queries.
 * Great for dynamic query construction where conditions vary at runtime.
 *
 * **This example uses QueryBuilder** - an alternative to QueryMapper.
 * Use QueryBuilder when building queries programmatically in code.
 * Use QueryMapper when transforming custom API shapes (e.g., from HTTP requests).
 * Both produce QueryRequest objects that get resolved and executed.
 */

import { sql } from "@514labs/moose-lib";
import { executeQuery } from "../client";
import { EventModel, Events } from "../models";
import {
  defineQueryModel,
  buildQuery,
  InferDimensionNames,
  InferMetricNames,
  InferResult,
} from "../query-layer";
import { count, sum } from "../query-layer/utils";

// =============================================================================
// Query Model (using dimensions and metrics)
// =============================================================================

const eventsModel = defineQueryModel({
  table: Events,

  // Dimensions: columns used for grouping, filtering, and display
  dimensions: {
    id: { column: "id" },
    timestamp: { column: "event_time" },
    amount: { column: "amount" },
    status: { column: "status" },
  },

  // Metrics: aggregates computed over dimensions
  metrics: {
    totalAmount: { agg: sum(Events.columns.amount), as: "total_amount" },
    eventCount: { agg: count(), as: "event_count" },
  },

  filters: {
    status: { column: "status", operators: ["eq", "ne", "in"] as const },
    amount: { column: "amount", operators: ["gte", "lte", "between"] as const },
    id: { column: "id", operators: ["eq"] as const },
    timestamp: { column: "event_time", operators: ["gte", "lte"] as const },
  },

  sortable: ["timestamp", "amount", "total_amount"] as const,
  defaults: { orderBy: [["timestamp", "DESC"]], limit: 50 },
});

// Types are inferred from the model
type Dimension = InferDimensionNames<typeof eventsModel>; // "id" | "timestamp" | "amount" | "status"
type Metric = InferMetricNames<typeof eventsModel>; // "totalAmount" | "eventCount"
type Result = InferResult<typeof eventsModel>; // { id?: string; ... totalAmount: number; eventCount: number; }

// =============================================================================
// Fluent Builder Examples
// =============================================================================

/**
 * Basic fluent query - filter, sort, limit, execute.
 */
export async function getActiveEvents(
  minAmount?: number,
): Promise<EventModel[]> {
  return buildQuery(eventsModel)
    .filter("status", "eq", "active")
    .filter("amount", "gte", minAmount) // skipped if minAmount is undefined
    .sort("amount", "DESC")
    .limit(100)
    .execute(executeQuery);
}

/**
 * Dynamic filters based on user input.
 */
export async function searchEvents(options: {
  statuses?: string[];
  minAmount?: number;
  maxAmount?: number;
  id?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EventModel[]> {
  return buildQuery(eventsModel)
    .filter("status", "in", options.statuses)
    .filter("amount", "gte", options.minAmount)
    .filter("amount", "lte", options.maxAmount)
    .filter("id", "eq", options.id)
    .filter("timestamp", "gte", options.startDate)
    .filter("timestamp", "lte", options.endDate)
    .sort("timestamp", "DESC")
    .limit(50)
    .execute(executeQuery);
}

/**
 * Aggregation with GROUP BY using the builder.
 * Uses dimensions/metrics instead of groupBy/select.
 */
export async function getStatsByStatus(minAmount?: number) {
  return buildQuery(eventsModel)
    .filter("amount", "gte", minAmount)
    .dimensions(["status"])
    .metrics(["totalAmount", "eventCount"])
    .sort("total_amount", "DESC")
    .limit(10)
    .execute(executeQuery);
}

/**
 * Get just the SQL without executing (useful for debugging).
 */
export function getEventsSql(status: string, minAmount: number) {
  return buildQuery(eventsModel)
    .filter("status", "eq", status)
    .filter("amount", "gte", minAmount)
    .sort("amount", "DESC")
    .toSql();
}

/**
 * Custom assembly - get parts and build your own query.
 */
export async function getEventsWithCustomColumn(status: string) {
  const { columns } = Events;

  return buildQuery(eventsModel)
    .filter("status", "eq", status)
    .sort("amount", "DESC")
    .limit(50)
    .assemble(
      (parts) => sql`
      ${parts.select},
      CASE 
        WHEN ${columns.amount} >= 1000 THEN 'high'
        WHEN ${columns.amount} >= 100 THEN 'medium'
        ELSE 'low'
      END AS tier
      ${parts.from}
      ${parts.where}
      ${parts.orderBy}
      ${parts.limit}
    `,
    );
}

// =============================================================================
// Usage
// =============================================================================

/*
// Basic filtered query
await getActiveEvents(100);
// → SELECT ... FROM events WHERE status = 'active' AND amount >= 100 ORDER BY amount DESC

// Dynamic search with optional filters
await searchEvents({
  statuses: ["active", "completed"],
  minAmount: 50,
  startDate: "2024-01-01",
});
// → SELECT ... WHERE status IN ('active', 'completed') AND amount >= 50 AND event_time >= '2024-01-01'

// Aggregation with GROUP BY
await getStatsByStatus(100);
// → SELECT status, SUM(amount), COUNT(*) ... GROUP BY status ORDER BY total_amount DESC

// Get SQL for debugging
const sql = getEventsSql("active", 100);
console.log(sql.text);
// → SELECT ... FROM events WHERE status = ? AND amount >= ? ORDER BY amount DESC

// Custom assembly with extra columns
await getEventsWithCustomColumn("active");
// → SELECT ..., CASE WHEN amount >= 1000 THEN 'high' ... END AS tier FROM events ...

// The builder skips undefined/null values:
await buildQuery(eventsModel)
  .filter("status", "eq", undefined)  // ← skipped
  .filter("amount", "gte", 100)       // ← applied
  .execute(executeQuery);
// → SELECT ... FROM events WHERE amount >= 100

// Access model's auto-detected dimensions and metrics:
console.log(eventsModel.dimensionNames); // ["id", "timestamp", "amount", "status"]
console.log(eventsModel.metricNames);    // ["totalAmount", "eventCount"]
*/
