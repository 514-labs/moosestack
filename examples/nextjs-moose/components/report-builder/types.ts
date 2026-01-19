/**
 * Types for the generic Report Builder component.
 *
 * These types allow the ReportBuilder to work with any QueryModel instance
 * by accepting configuration props instead of hardcoded values.
 */

// Re-export FieldOption as FieldMeta for backwards compatibility
import type { FieldOption } from "@/components/inputs";

/**
 * Field metadata for UI display.
 * Used for both dimensions and metrics.
 * (Alias for FieldOption from inputs module)
 */
export type FieldMeta<TId extends string = string> = FieldOption<TId>;

/**
 * Query parameters passed to the execute function.
 * Generic to support different QueryModel configurations.
 */
export interface ReportQueryParams<
  TDimension extends string = string,
  TMetric extends string = string,
> {
  /** Dimensions to break down / group by */
  breakdown?: TDimension[];
  /** Metrics to aggregate */
  metrics?: TMetric[];
  /** Optional start date filter */
  startDate?: string;
  /** Optional end date filter */
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
  /** Available dimensions (for breakdown selection) with UI metadata */
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

  /** Optional: Default selected breakdown dimensions */
  defaultBreakdown?: TDimension[];

  /** Optional: Default selected metrics */
  defaultMetrics?: TMetric[];

  /** Optional: Show date range filter (default: true) */
  showDateFilter?: boolean;
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
  /** Maps column ID to actual data key (for snake_case vs camelCase) */
  dataKeyMap?: Record<string, string>;
  /** Optional custom value formatter */
  formatValue?: (key: string, value: unknown) => string;
}
