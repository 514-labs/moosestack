"use client";

/**
 * Dashboard Provider
 *
 * Manages global dashboard filter state.
 * Query hooks automatically use these filters.
 */

import * as React from "react";
import { getDefaultDateRange } from "@/components/inputs";

// =============================================================================
// Types
// =============================================================================

export interface DashboardFilters {
  startDate: string;
  endDate: string;
}

export interface DashboardActions {
  setDateRange: (start: string, end: string) => void;
  setFilter: <K extends keyof DashboardFilters>(
    key: K,
    value: DashboardFilters[K],
  ) => void;
  resetFilters: () => void;
}

export interface DashboardContextValue {
  filters: DashboardFilters;
  actions: DashboardActions;
}

// =============================================================================
// Context
// =============================================================================

const DashboardContext = React.createContext<DashboardContextValue | null>(
  null,
);

// =============================================================================
// Provider
// =============================================================================

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const { start: defaultStart, end: defaultEnd } = getDefaultDateRange();

  const [filters, setFilters] = React.useState<DashboardFilters>({
    startDate: defaultStart,
    endDate: defaultEnd,
  });

  const actions: DashboardActions = React.useMemo(
    () => ({
      setDateRange: (start, end) => {
        setFilters((prev) => ({ ...prev, startDate: start, endDate: end }));
      },
      setFilter: (key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
      },
      resetFilters: () => {
        setFilters({ startDate: defaultStart, endDate: defaultEnd });
      },
    }),
    [defaultStart, defaultEnd],
  );

  const value = React.useMemo(() => ({ filters, actions }), [filters, actions]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useDashboardFilters(): DashboardContextValue {
  const context = React.useContext(DashboardContext);
  if (!context) {
    throw new Error(
      "useDashboardFilters must be used within a DashboardProvider",
    );
  }
  return context;
}

export { DashboardContext };
