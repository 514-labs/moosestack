/**
 * Report Builder Types
 *
 * Consolidated type definitions for the Report Builder components.
 * Single source of truth for all types used across the module.
 */

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
 * Filter operator type.
 * All supported SQL-like operators for filtering.
 */
export type FilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "notIn"
  | "between"
  | "isNull"
  | "isNotNull";

/**
 * Filter input type hint for UI rendering.
 * Determines which input component to use for a filter.
 */
export type FilterInputType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multiselect";

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
// Query Types
// =============================================================================

/**
 * Query parameters passed to the execute function.
 */
export interface ReportQueryParams {
  /** Dimensions to break down / group by */
  dimensions: string[];
  /** Metrics to aggregate */
  metrics: string[];
  /** Filter conditions */
  filters?: Record<string, FilterValue>;
}

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
  onExecute: (params: ReportQueryParams) => Promise<unknown[]>;
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

// =============================================================================
// Client Props (Serializable for Server → Client)
// =============================================================================

/**
 * Serializable props for passing from Server Component to Client Component.
 * All readonly arrays are converted to mutable for JSON serialization.
 */
export interface ReportClientProps {
  filterMeta: FilterMeta[];
  dimensionOptions: FieldOption[];
  metricOptions: FieldOption[];
  onExecute: (params: ReportQueryParams) => Promise<unknown[]>;
  defaultDimensions?: string[];
  defaultMetrics?: string[];
}
