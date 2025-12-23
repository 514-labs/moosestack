import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getEventsOverTimeAction } from "@/app/actions/events";
import { getMetrics } from "@/app/actions/metrics";
import type { EventsOverTimeBucket } from "@/app/actions/events";
import { DateFilterContext } from "@/components/dashboard-date-context";

// Internal query key factory - exported for components that need to access cache directly
export const queryKeys = {
  metrics: (startDate?: string, endDate?: string) =>
    ["metrics", startDate, endDate] as const,
  eventsOverTime: (startDate?: string, endDate?: string, bucket?: string) =>
    ["eventsOverTime", startDate, endDate, bucket] as const,
} as const;

export function useMetrics(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: queryKeys.metrics(startDate, endDate),
    queryFn: () => getMetrics(startDate, endDate),
    enabled: !!startDate && !!endDate,
  });
}

export function useEventsOverTime(
  startDate?: string,
  endDate?: string,
  bucket?: EventsOverTimeBucket,
) {
  return useQuery({
    queryKey: queryKeys.eventsOverTime(startDate, endDate, bucket),
    queryFn: () => getEventsOverTimeAction(startDate, endDate, bucket),
    enabled: !!startDate && !!endDate,
  });
}

export function useDateFilter() {
  const context = React.useContext(DateFilterContext);
  if (!context) {
    throw new Error("useDateFilter must be used within DateFilterProvider");
  }
  return context;
}
