"use server";

import { getEventsOverTime } from "moose";

export type EventsOverTimeBucket = "minute" | "hour" | "day";

export type TimeSeriesData = Awaited<ReturnType<typeof getEventsOverTime>>;

export async function getEventsOverTimeAction(
  startDate?: string,
  endDate?: string,
  bucketSize: EventsOverTimeBucket = "day",
): Promise<TimeSeriesData> {
  const start = startDate ? new Date(startDate) : undefined;
  const end = endDate ? new Date(endDate) : undefined;

  const rows = await getEventsOverTime(start, end, bucketSize);

  return rows;
}
