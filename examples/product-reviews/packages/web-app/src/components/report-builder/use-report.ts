"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { FilterValue, QueryRequest, ReportModel } from "./types";

export interface UseReportOptions {
  model: ReportModel;
  execute: (params: QueryRequest) => Promise<unknown[]>;
  defaults?: {
    dimensions?: string[];
    metrics?: string[];
  };
}

export interface UseReportReturn {
  model: ReportModel;
  state: {
    dimensions: string[];
    metrics: string[];
    filters: Record<string, FilterValue>;
  };
  actions: {
    setDimensions: (ids: string[]) => void;
    toggleDimension: (id: string) => void;
    setMetrics: (ids: string[]) => void;
    toggleMetric: (id: string) => void;
    setFilter: (id: string, operator: string, value: unknown) => void;
    clearFilter: (id: string) => void;
    clearAllFilters: () => void;
  };
  query: {
    data: unknown[] | null;
    isLoading: boolean;
    isFetching: boolean;
    error: Error | null;
  };
}

export function useReport(options: UseReportOptions): UseReportReturn {
  const { model, execute, defaults } = options;

  const [dimensions, setDimensions] = React.useState<string[]>(
    defaults?.dimensions ?? [],
  );

  const [metrics, setMetrics] = React.useState<string[]>(
    defaults?.metrics ?? model.metrics.slice(0, 3).map((m) => m.id),
  );

  const [filters, setFilters] = React.useState<Record<string, FilterValue>>({});

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
    (id: string, operator: string, value: unknown) => {
      setFilters((prev) => ({
        ...prev,
        [id]: { ...prev[id], [operator]: value },
      }));
    },
    [],
  );

  const clearFilter = React.useCallback((id: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clearAllFilters = React.useCallback(() => {
    setFilters({});
  }, []);

  const activeFilters = React.useMemo(() => {
    const result: Record<string, FilterValue> = {};
    for (const [name, ops] of Object.entries(filters)) {
      const cleaned: FilterValue = {};
      for (const [op, val] of Object.entries(ops)) {
        if (val === undefined || val === null || val === "") continue;
        if (Array.isArray(val) && val.length === 0) continue;
        cleaned[op] = val;
      }
      if (Object.keys(cleaned).length > 0) result[name] = cleaned;
    }
    return result;
  }, [filters]);

  const queryParams = React.useMemo(
    (): QueryRequest => ({
      dimensions,
      metrics,
      filters:
        Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
    }),
    [dimensions, metrics, activeFilters],
  );

  const canQuery = metrics.length > 0;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["report", queryParams],
    queryFn: () => execute(queryParams),
    enabled: canQuery,
  });

  return {
    model,
    state: { dimensions, metrics, filters },
    actions: {
      setDimensions,
      toggleDimension,
      setMetrics,
      toggleMetric,
      setFilter,
      clearFilter,
      clearAllFilters,
    },
    query: {
      data: data ?? null,
      isLoading,
      isFetching,
      error: error as Error | null,
    },
  };
}
