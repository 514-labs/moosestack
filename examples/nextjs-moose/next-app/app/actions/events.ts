"use server";

import { getEventsOverTime } from "moose";

export type EventsOverTimeBucket = "minute" | "hour" | "day";

export interface EventsOverTimePoint {
  time: string;
  value: number;
}

export async function getEventsOverTimeAction(
  startDate?: string,
  endDate?: string,
  bucketSize: EventsOverTimeBucket = "day",
): Promise<EventsOverTimePoint[]> {
  const start = startDate ? new Date(startDate) : undefined;
  const end = endDate ? new Date(endDate) : undefined;

  const rows = await getEventsOverTime(start, end, bucketSize);

  // `getEventsOverTime` returns `{ time, count }`; normalize to chart `{ time, value }`.
  return (
    rows
      .map((r) => ({
        time: String(r.time),
        value: Number(r.count) || 0,
      }))
      // The query orders DESC; chart reads left-to-right better in ASC.
      .reverse()
  );
}
