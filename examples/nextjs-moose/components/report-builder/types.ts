/**
 * Report Builder Types
 *
 * Consolidated type definitions for the Report Builder components.
 * Single source of truth for all types used across the module.
 */

// Import shared types from query-layer (single source of truth)
import type {
  QueryRequest,
  FilterOperator,
  FilterInputTypeHint,
  FilterParams,
} from "@/moose/src/query-layer";

// Re-export for convenience
export type { FilterOperator, QueryRequest, FilterParams };

// Alias for backwards compatibility
export type FilterInputType = FilterInputTypeHint;

// =============================================================================
// Core Field Types
// =============================================================================

/**
 * Field option for dimensions and metrics.
 * Used in selectors and results display.
 */
export interface FieldOption {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional description/tooltip */
  description?: string;
  /** Data key in query results (if different from id, e.g., snake_case vs camelCase) */
  dataKey?: string;
}

/**
 * Generic field metadata with typed ID.
 * Extends FieldOption for type-safe field references.
 */
export interface FieldMeta<TId extends string = string>
  extends Omit<FieldOption, "id"> {
  id: TId;
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Option for select/multiselect filters.
 */
export interface FilterSelectOption {
  value: string;
  label: string;
}

/**
 * Filter metadata for UI display.
 * Defines how a filter should be rendered and what operators it supports.
 */
export interface FilterMeta<TFilterName extends string = string> {
  /** Filter identifier */
  id: TFilterName;
  /** Display label */
  label: string;
  /** Tooltip description */
  description?: string;
  /** Allowed operators for this filter */
  operators: readonly string[];
  /** Input type hint (for UI rendering) */
  inputType: FilterInputType;
  /** Options for select/multiselect inputs */
  options?: FilterSelectOption[];
}

/**
 * Filter value shape: { operator: value }
 * @example { gte: "2024-01-01" } or { eq: "active" } or { in: ["a", "b"] }
 */
export type FilterValue = Record<string, unknown>;

// =============================================================================
// Component Props Types
// =============================================================================

/**
 * Props for ReportBuilderProvider.
 */
export interface ReportBuilderProviderProps {
  children: React.ReactNode;
  /** Filter definitions with inputType metadata */
  filters?: FilterMeta[];
  /** Dimension options */
  dimensions?: FieldOption[];
  /** Metric options */
  metrics?: FieldOption[];
  /** Execute function that runs the query */
  onExecute: (params: QueryRequest) => Promise<unknown[]>;
  /** Default selected dimensions */
  defaultDimensions?: string[];
  /** Default selected metrics */
  defaultMetrics?: string[];
  /** Default filter values */
  defaultFilters?: Record<string, FilterValue>;
}

/**
 * Context value exposed by useReportBuilder hook.
 */
export interface ReportBuilderContextValue {
  // Metadata (from props)
  filterMeta: FilterMeta[];
  dimensionOptions: FieldOption[];
  metricOptions: FieldOption[];

  // Filter state
  filters: Record<string, FilterValue | undefined>;
  setFilter: (name: string, value: FilterValue | undefined) => void;
  clearFilter: (name: string) => void;
  clearAllFilters: () => void;

  // Selection state
  dimensions: string[];
  setDimensions: (dims: string[]) => void;
  metrics: string[];
  setMetrics: (metrics: string[]) => void;

  // Execution
  execute: () => void;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;

  // Results
  results: unknown[] | null;
}

/**
 * Props for ResultsTable component.
 */
export interface ResultsTableProps {
  data: Record<string, unknown>[];
  dimensions: string[];
  metrics: string[];
  dimensionLabels: Record<string, string>;
  metricLabels: Record<string, string>;
  /** Maps column ID to actual data key (for snake_case vs camelCase) */
  dataKeyMap?: Record<string, string>;
  /** Optional custom value formatter */
  formatValue?: (key: string, value: unknown) => string;
}
