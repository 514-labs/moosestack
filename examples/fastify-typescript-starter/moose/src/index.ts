// Note: this file defines/exports Moose resources (OlapTable, etc.) as plain TS modules
// so it can be imported directly by a runtime server without an extra build step.

import { OlapTable, sql } from "@514labs/moose-lib";
import { executeQuery } from "./client";

export interface EventModel {
  id: string;
  amount: number;
  event_time: Date;
  status: "completed" | "active" | "inactive";
}

export const Events = new OlapTable<EventModel>("events", {
  orderByFields: ["event_time"],
});

export async function getEvents(limit: number = 10): Promise<EventModel[]> {
  return await executeQuery<EventModel>(
    sql`SELECT * FROM ${Events} ORDER BY ${Events.columns.event_time} DESC LIMIT ${limit}`,
  );
}
