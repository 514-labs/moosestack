import { Events, type EventModel } from "./models";
import { executeQuery } from "./client";
import { sql } from "@514labs/moose-lib";

/**
 * Minimal example query used by the Fastify app.
 * Keep this free of query-helper / Typia dependencies so `moose dev` can load it
 * directly via ts-node without requiring additional TS transforms/config.
 */
export async function getEvents(limit: number = 10): Promise<EventModel[]> {
  const query = sql`
    SELECT *
    FROM ${Events}
    ORDER BY ${Events.columns.event_time} DESC
    LIMIT ${limit}
  `;

  return await executeQuery<EventModel>(query);
}
