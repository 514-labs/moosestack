"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  FieldOption,
  FilterMeta,
  FilterValue,
  QueryRequest,
} from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Model metadata prepared for the report.
 * This is the serializable structure passed from server to client.
 */
export interface ReportModel {
  /** Available dimensions for grouping */
  dimensions: FieldOption[];
  /** Available metrics for aggregation */
  metrics: FieldOption[];
  /** Available filters with operators and input types */
  filters: FilterMeta[];
}

/**
 * Options for the useReport hook.
 */
export interface UseReportOptions {
  /** Model metadata (from prepareModel) */
  model: ReportModel;
  /** Function to execute the query */
  execute: (params: QueryRequest) => Promise<unknown[]>;
  /** Default selections */
  defaults?: {
    dimensions?: string[];
    metrics?: string[];
    filters?: Record<string, FilterValue>;
  };
}

/**
 * Current state of the report.
 */
export interface ReportState {
  /** Currently selected dimension IDs */
  dimensions: string[];
  /** Currently selected metric IDs */
  metrics: string[];
  /** Current filter values: { filterName: { operator: value } } */
  filters: Record<string, FilterValue>;
}

/**
 * Actions to modify report state.
 */
export interface ReportActions {
  /** Set selected dimensions */
  setDimensions: (ids: string[]) => void;
  /** Toggle a single dimension on/off */
  toggleDimension: (id: string) => void;
  /** Set selected metrics */
  setMetrics: (ids: string[]) => void;
  /** Toggle a single metric on/off */
  toggleMetric: (id: string) => void;
  /** Set a filter value */
  setFilter: (name: string, operator: string, value: unknown) => void;
  /** Clear a specific filter */
  clearFilter: (name: string) => void;
  /** Clear all filters */
  clearAllFilters: () => void;
  /** Manually trigger query execution */
  execute: () => void;
}

/**
 * Query state from react-query.
 */
export interface ReportQuery {
  /** Query results */
  data: unknown[] | null;
  /** True during initial load */
  isLoading: boolean;
  /** True during any fetch (including refetch) */
  isFetching: boolean;
  /** Error if query failed */
  error: Error | null;
}

/**
 * Return type of useReport hook.
 */
export interface UseReportReturn {
  /** Model metadata (dimensions, metrics, filters) */
  model: ReportModel;
  /** Current state (selections and filter values) */
  state: ReportState;
  /** Actions to modify state */
  actions: ReportActions;
  /** Query execution state */
  query: ReportQuery;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing report state and query execution.
 *
 * Provides a clear, transparent API for building report UIs:
 * - `report.model` - Access model metadata (dimensions, metrics, filters)
 * - `report.state` - Current selections and filter values
 * - `report.actions` - Functions to modify state
 * - `report.query` - Query execution state (data, loading, error)
 *
 * @example
 * const report = useReport({
 *   model: reportModel,
 *   execute: executeQuery,
 *   defaults: { dimensions: ["status"], metrics: ["totalEvents"] },
 * });
 *
 * // Access model
 * report.model.dimensions.map(d => d.label)
 *
 * // Check state
 * report.state.dimensions // ["status"]
 * report.state.filters    // { status: { eq: "active" } }
 *
 * // Modify state
 * report.actions.toggleDimension("day")
 * report.actions.setFilter("status", "eq", "active")
 *
 * // Query state
 * report.query.data       // Results
 * report.query.isLoading  // Loading state
 */
export function useReport(options: UseReportOptions): UseReportReturn {
  const { model, execute, defaults } = options;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [dimensions, setDimensions] = React.useState<string[]>(
    defaults?.dimensions ??
      (model.dimensions[0] ? [model.dimensions[0].id] : []),
  );

  const [metrics, setMetrics] = React.useState<string[]>(
    defaults?.metrics ?? model.metrics.slice(0, 2).map((m) => m.id),
  );

  const [filters, setFilters] = React.useState<Record<string, FilterValue>>(
    defaults?.filters ?? {},
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const toggleDimension = React.useCallback((id: string) => {
    setDimensions((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }, []);

  const toggleMetric = React.useCallback((id: string) => {
    setMetrics((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }, []);

  const setFilter = React.useCallback(
    (name: string, operator: string, value: unknown) => {
      // Always store the filter to preserve operator selection in UI
      // Empty values are filtered out when building queryParams
      setFilters((prev) => ({
        ...prev,
        [name]: { [operator]: value },
      }));
    },
    [],
  );

  const clearFilter = React.useCallback((name: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const clearAllFilters = React.useCallback(() => {
    setFilters({});
  }, []);

  // ---------------------------------------------------------------------------
  // Query Params
  // ---------------------------------------------------------------------------

  const queryParams = React.useMemo((): QueryRequest => {
    // Filter out empty filter values
    const activeFilters: Record<string, FilterValue> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value && Object.keys(value).length > 0) {
        const hasNonEmptyValue = Object.values(value).some(
          (v) =>
            v !== undefined &&
            v !== null &&
            v !== "" &&
            !(Array.isArray(v) && v.length === 0),
        );
        if (hasNonEmptyValue) {
          activeFilters[key] = value;
        }
      }
    }

    return {
      dimensions,
      metrics,
      filters:
        Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
    };
  }, [dimensions, metrics, filters]);

  // ---------------------------------------------------------------------------
  // Query Execution
  // ---------------------------------------------------------------------------

  const canQuery = dimensions.length > 0 || metrics.length > 0;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["report", queryParams],
    queryFn: () => execute(queryParams),
    enabled: canQuery,
  });

  const executeQuery = React.useCallback(() => {
    refetch();
  }, [refetch]);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    model,
    state: {
      dimensions,
      metrics,
      filters,
    },
    actions: {
      setDimensions,
      toggleDimension,
      setMetrics,
      toggleMetric,
      setFilter,
      clearFilter,
      clearAllFilters,
      execute: executeQuery,
    },
    query: {
      data: data ?? null,
      isLoading,
      isFetching,
      error: error as Error | null,
    },
  };
}
