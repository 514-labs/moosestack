"use client";

/**
 * Dashboard Query Hooks
 *
 * Hooks that automatically use global dashboard filters.
 * Must be used within DashboardProvider.
 */

import { useQuery } from "@tanstack/react-query";
import { useDashboardFilters } from "./dashboard-provider";
import {
  getMetrics,
  getEventsByStatusAction,
  getEventsOverTimeAction,
  type BucketSize,
} from "@/app/actions";

// =============================================================================
// Query Keys
// =============================================================================

export const dashboardQueryKeys = {
  metrics: (startDate: string, endDate: string) =>
    ["dashboard", "metrics", startDate, endDate] as const,
  eventsByStatus: (startDate: string, endDate: string) =>
    ["dashboard", "eventsByStatus", startDate, endDate] as const,
  timeseries: (startDate: string, endDate: string, bucket: BucketSize) =>
    ["dashboard", "timeseries", startDate, endDate, bucket] as const,
} as const;

// =============================================================================
// Helpers
// =============================================================================

function computeBucket(startDate: string, endDate: string): BucketSize {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil(
    Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diffDays <= 2 ? "day" : "month";
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch dashboard metrics using global filters.
 */
export function useMetrics() {
  const { filters } = useDashboardFilters();
  const { startDate, endDate } = filters;

  return useQuery({
    queryKey: dashboardQueryKeys.metrics(startDate, endDate),
    queryFn: () => getMetrics(startDate, endDate),
    enabled: !!startDate && !!endDate,
  });
}

/**
 * Fetch events by status using global filters.
 */
export function useEventsByStatus() {
  const { filters } = useDashboardFilters();
  const { startDate, endDate } = filters;

  return useQuery({
    queryKey: dashboardQueryKeys.eventsByStatus(startDate, endDate),
    queryFn: () => getEventsByStatusAction(startDate, endDate),
    enabled: !!startDate && !!endDate,
  });
}

/**
 * Fetch timeseries data using global filters.
 * @param bucket - Optional bucket size override. Defaults to auto-computed from date range.
 */
export function useTimeseries(bucket?: BucketSize) {
  const { filters } = useDashboardFilters();
  const { startDate, endDate } = filters;

  const resolvedBucket =
    bucket ??
    (startDate && endDate ? computeBucket(startDate, endDate) : "day");

  return useQuery({
    queryKey: dashboardQueryKeys.timeseries(startDate, endDate, resolvedBucket),
    queryFn: () => getEventsOverTimeAction(startDate, endDate, resolvedBucket),
    enabled: !!startDate && !!endDate,
  });
}
