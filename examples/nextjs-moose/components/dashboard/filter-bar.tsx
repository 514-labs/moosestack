"use client";

import * as React from "react";
import { DateRangeInput } from "@/components/inputs";
import { useDashboardFilters } from "./dashboard-provider";

export interface FilterBarProps {
  className?: string;
  showPresets?: boolean;
}

/**
 * Dashboard filter bar with date range selection.
 */
export function FilterBar({ className, showPresets = true }: FilterBarProps) {
  const { filters, actions } = useDashboardFilters();

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      }
    >
      <DateRangeInput
        startDate={filters.startDate}
        endDate={filters.endDate}
        onChange={({ start, end }) => actions.setDateRange(start, end)}
        showPresets={showPresets}
        presetLabel="Filter Date"
        startLabel="From"
        endLabel="To"
        inputWidth="w-[160px]"
      />
    </div>
  );
}
