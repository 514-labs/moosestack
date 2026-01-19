"use client";

import * as React from "react";
import { getDefaultDateRange } from "@/components/inputs";

export interface DateFilterContextType {
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
}

export const DateFilterContext = React.createContext<
  DateFilterContextType | undefined
>(undefined);

export function DateFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize with default dates (last 30 days) synchronously
  const { start: defaultStart, end: defaultEnd } = getDefaultDateRange();

  const [startDate, setStartDateState] = React.useState<string>(defaultStart);
  const [endDate, setEndDateState] = React.useState<string>(defaultEnd);

  const setStartDate = React.useCallback((date: string) => {
    setStartDateState(date);
  }, []);

  const setEndDate = React.useCallback((date: string) => {
    setEndDateState(date);
  }, []);

  const value = React.useMemo(
    () => ({
      startDate,
      endDate,
      setStartDate,
      setEndDate,
    }),
    [startDate, endDate, setStartDate, setEndDate],
  );

  return (
    <DateFilterContext.Provider value={value}>
      {children}
    </DateFilterContext.Provider>
  );
}

/**
 * Hook to access the date filter context.
 */
export function useDateFilter(): DateFilterContextType {
  const context = React.useContext(DateFilterContext);
  if (!context) {
    throw new Error("useDateFilter must be used within a DateFilterProvider");
  }
  return context;
}
