"use server";

import {
  getTotalEventsCount,
  getActiveEventsCount,
  getCompletedEventsCount,
  getTotalAmount,
  getEventsByStatus,
} from "moose";

export async function getMetrics(startDate?: string, endDate?: string) {
  const start = startDate ? new Date(startDate) : undefined;
  const end = endDate ? new Date(endDate) : undefined;

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
