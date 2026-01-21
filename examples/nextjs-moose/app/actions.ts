"use server";

/**
 * Server Actions
 *
 * All server actions for the application.
 * Colocated in app directory per Next.js conventions.
 */

import {
  getEventsMetrics,
  getEventsByStatus,
  getEventsTimeseries,
  runEventsQuery,
  eventsModel,
} from "moose";

// =============================================================================
// Types
// =============================================================================

/** Metrics result (single row from aggregate query) */
export type MetricsResult = Awaited<
  ReturnType<typeof getEventsMetrics>
>[number];

/** Events by status result */
export type EventsByStatusResult = Awaited<
  ReturnType<typeof getEventsByStatus>
>;

/** Time series data point with string time for chart compatibility */
export interface TimeSeriesDataPoint {
  time: string;
  count: number;
}

export type TimeSeriesData = TimeSeriesDataPoint[];
export type BucketSize = Parameters<typeof getEventsTimeseries>[2];

// =============================================================================
// Helpers
// =============================================================================

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
  return date;
}

// =============================================================================
// Dashboard Actions
// =============================================================================

/**
 * Get dashboard metrics (static query).
 * Returns: totalEvents, totalAmount, avgAmount, minAmount, maxAmount, highValueRatio
 */
export async function getMetrics(
  startDate?: string,
  endDate?: string,
): Promise<MetricsResult> {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");

  const results = await getEventsMetrics(start, end);
  return results[0];
}

/**
 * Get events grouped by status (static query).
 * Returns: Array of { name, value } for chart display.
 */
export async function getEventsByStatusAction(
  startDate?: string,
  endDate?: string,
): Promise<EventsByStatusResult> {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");

  return await getEventsByStatus(start, end);
}

/**
 * Get events over time (static query).
 * Returns: Array of { time, count } bucketed by hour/day/month.
 */
export async function getEventsOverTimeAction(
  startDate?: string,
  endDate?: string,
  bucketSize: BucketSize = "day",
): Promise<TimeSeriesData> {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");

  const results = await getEventsTimeseries(start, end, bucketSize);

  return results.map((row) => ({
    time: row.time instanceof Date ? row.time.toISOString() : String(row.time),
    count: row.totalEvents,
  }));
}

// =============================================================================
// Report Builder Actions
// =============================================================================

/**
 * Execute dynamic query using the QueryModel.
 * Used by the report builder for user-configurable queries.
 */
export async function executeEventsQuery(
  params: typeof eventsModel.$inferRequest,
) {
  const results = await runEventsQuery(params);
  return results;
}
