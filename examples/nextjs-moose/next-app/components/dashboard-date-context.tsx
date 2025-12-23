"use client";

import * as React from "react";

interface DataPoint {
  time: string;
  value: number;
}

interface DateFilterContextType {
  startDate: string;
  endDate: string;
  chartData: DataPoint[];
  setChartData: (data: DataPoint[]) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
}

const DateFilterContext = React.createContext<
  DateFilterContextType | undefined
>(undefined);

export function useDateFilter() {
  const context = React.useContext(DateFilterContext);
  if (!context) {
    throw new Error("useDateFilter must be used within DateFilterProvider");
  }
  return context;
}

export function DateFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize with default dates (last 30 days) synchronously
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const defaultStart = thirtyDaysAgo.toISOString().split("T")[0];
  const defaultEnd = today.toISOString().split("T")[0];

  const [startDate, setStartDateState] = React.useState<string>(defaultStart);
  const [endDate, setEndDateState] = React.useState<string>(defaultEnd);
  const [chartData, setChartData] = React.useState<DataPoint[]>([]);

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
      chartData,
      setChartData,
      setStartDate,
      setEndDate,
    }),
    [startDate, endDate, chartData, setStartDate, setEndDate],
  );

  return (
    <DateFilterContext.Provider value={value}>
      {children}
    </DateFilterContext.Provider>
  );
}
