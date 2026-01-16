"use server";

import {
  getTotalEventsCount,
  getActiveEventsCount,
  getCompletedEventsCount,
  getTotalAmount,
  getEventsByStatus,
} from "moose";

export type Metrics = {
  totalEvents: Awaited<ReturnType<typeof getTotalEventsCount>>;
  activeEvents: Awaited<ReturnType<typeof getActiveEventsCount>>;
  completedEvents: Awaited<ReturnType<typeof getCompletedEventsCount>>;
  revenue: Awaited<ReturnType<typeof getTotalAmount>>;
  eventsByStatus: Awaited<ReturnType<typeof getEventsByStatus>>;
};

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
  return date;
}

export async function getMetrics(
  startDate?: string,
  endDate?: string,
): Promise<Metrics> {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");

  const [totalEvents, activeEvents, completedEvents, revenue, eventsByStatus] =
    await Promise.all([
      getTotalEventsCount(start, end),
      getActiveEventsCount(start, end),
      getCompletedEventsCount(start, end),
      getTotalAmount(start, end),
      getEventsByStatus(start, end),
    ]);

  return {
    totalEvents,
    activeEvents,
    completedEvents,
    revenue,
    eventsByStatus,
  };
}
