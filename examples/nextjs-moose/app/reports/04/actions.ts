"use server";

import { statsModel } from "moose";
import { executeQuery } from "@/moose/src/client";

// Use the new $infer API for type inference (similar to Drizzle's $inferSelect)
type StatsQueryRequest = typeof statsModel.$inferRequest;

// Export filter params type for external use if needed
export type StatsFilters = typeof statsModel.$inferFilters;

/** Result row type - inferred from the query execution */
export type StatsResultRow = Record<string, unknown>;

/**
 * Server Action: Execute stats query.
 * Converts ReportQueryParams to QueryRequest and executes using statsModel.
 * Types are automatically derived from statsModel, including full filter type definitions.
 * Supports all filter operators (eq, in, gte, lte, etc.) as defined in the model.
 */
export async function executeStatsQuery(
  params: StatsQueryRequest,
): Promise<StatsResultRow[]> {
  // Build QueryRequest using the inferred type
  const request: StatsQueryRequest = {
    dimensions: params.dimensions,
    metrics: params.metrics,
    filters: params.filters,
  };

  // Execute query using the model
  const query = statsModel.toSql(request);
  return executeQuery<StatsResultRow>(query);
}
