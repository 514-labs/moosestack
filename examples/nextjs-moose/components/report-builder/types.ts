/**
 * Types for the generic Report Builder component.
 *
 * These types allow the ReportBuilder to work with any QueryModel instance
 * by accepting configuration props instead of hardcoded values.
 */

/**
 * Field metadata for UI display.
 * Used for both dimensions and metrics.
 */
export interface FieldMeta<TId extends string = string> {
  id: TId;
  label: string;
  description?: string;
}

/**
 * Query parameters passed to the execute function.
 * Generic to support different QueryModel configurations.
 */
export interface ReportQueryParams<
  TDimension extends string = string,
  TMetric extends string = string,
> {
  dimensions?: TDimension[];
  metrics?: TMetric[];
  groupBy?: TDimension;
  startDate?: string;
  endDate?: string;
}

/**
 * Configuration for the ReportBuilder component.
 *
 * @template TDimension - Union type of dimension IDs
 * @template TMetric - Union type of metric IDs
 * @template TResult - Type of result rows returned by execute
 */
export interface ReportBuilderConfig<
  TDimension extends string = string,
  TMetric extends string = string,
  TResult extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Available dimensions with UI metadata */
  dimensions: readonly FieldMeta<TDimension>[];

  /** Available metrics with UI metadata */
  metrics: readonly FieldMeta<TMetric>[];

  /** Execute function that runs the query and returns results */
  execute: (
    params: ReportQueryParams<TDimension, TMetric>,
  ) => Promise<TResult[]>;

  /** Optional: Title for the report builder */
  title?: string;

  /** Optional: Description for the report builder */
  description?: string;

  /** Optional: Default selected dimensions */
  defaultDimensions?: TDimension[];

  /** Optional: Default selected metrics */
  defaultMetrics?: TMetric[];

  /** Optional: Default groupBy dimension */
  defaultGroupBy?: TDimension;

  /** Optional: Show date range filter (default: true) */
  showDateFilter?: boolean;

  /** Optional: Show group by selector (default: true) */
  showGroupBy?: boolean;
}

/**
 * Props for the ResultsTable component.
 */
export interface ResultsTableConfig<
  TDimension extends string = string,
  TMetric extends string = string,
  TResult extends Record<string, unknown> = Record<string, unknown>,
> {
  data: TResult[];
  dimensions: TDimension[];
  metrics: TMetric[];
  dimensionLabels: Record<TDimension, string>;
  metricLabels: Record<TMetric, string>;
  /** Optional custom value formatter */
  formatValue?: (key: string, value: unknown) => string;
}

/**
 * Helper to create a ReportBuilder config from QueryModel metadata.
 * This provides a cleaner API for creating configurations.
 *
 * @example
 * const config = createReportConfig({
 *   dimensions: [
 *     { id: "status", label: "Status", description: "Event status" },
 *     { id: "day", label: "Day", description: "Day (date)" },
 *   ],
 *   metrics: [
 *     { id: "totalEvents", label: "Total Events" },
 *     { id: "totalAmount", label: "Total Amount" },
 *   ],
 *   execute: async (params) => getReport(params),
 * });
 */
export function createReportConfig<
  TDimension extends string,
  TMetric extends string,
  TResult extends Record<string, unknown>,
>(
  config: ReportBuilderConfig<TDimension, TMetric, TResult>,
): ReportBuilderConfig<TDimension, TMetric, TResult> {
  return config;
}
