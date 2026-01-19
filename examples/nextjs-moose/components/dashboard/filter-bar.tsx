"use client";

import * as React from "react";
import { DateRangeInput } from "@/components/inputs";
import { useDateFilter } from "./date-context";

export interface FilterBarProps {
  /** Additional CSS classes */
  className?: string;
  /** Show preset selector */
  showPresets?: boolean;
}

/**
 * Dashboard filter bar with date range selection.
 * Uses the DateFilterContext for state management.
 */
export function FilterBar({ className, showPresets = true }: FilterBarProps) {
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  const handleDateChange = ({ start, end }: { start: string; end: string }) => {
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      }
    >
      <DateRangeInput
        startDate={startDate}
        endDate={endDate}
        onChange={handleDateChange}
        showPresets={showPresets}
        presetLabel="Filter Date"
        startLabel="From"
        endLabel="To"
        inputWidth="w-[160px]"
      />
    </div>
  );
}
