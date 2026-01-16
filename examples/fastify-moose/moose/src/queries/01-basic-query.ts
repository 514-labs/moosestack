/**
 * 01 - Basic Query
 *
 * The simplest approach: write SQL directly with helper utilities.
 * Use this when you need full control or for one-off queries.
 */

import { sql } from "@514labs/moose-lib";
import typia, { tags } from "typia";
import { executeQuery } from "../client";
import { EventModel, Events } from "../models";
import { filter, where, orderBy, paginate } from "../utils";

// =============================================================================
// Define API params with validation
// =============================================================================

export interface GetEventsParams {
  minAmount?: number & tags.Type<"uint32">;
  maxAmount?: number & tags.Type<"uint32">;
  status?: "completed" | "active" | "inactive";
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<100>;
  page?: number & tags.Type<"uint32"> & tags.Minimum<0>;
}

// =============================================================================
// Query function
// =============================================================================

export async function getEvents(
  params: GetEventsParams,
): Promise<EventModel[]> {
  const { columns } = Events;

  const query = sql`
    SELECT * FROM ${Events}
    ${where(
      // filter() skips undefined values automatically
      filter(columns.amount, "gte", params.minAmount),
      filter(columns.amount, "lte", params.maxAmount),
      filter(columns.status, "eq", params.status),
    )}
    ${orderBy([columns.event_time, "DESC"])}
    ${paginate(params.limit ?? 100, params.page ?? 0)}
  `;

  return executeQuery<EventModel>(query);
}

// =============================================================================
// Usage
// =============================================================================

/*
await getEvents({
  minAmount: 100,
  status: "active",
  limit: 10,
});

// Generated SQL:
// SELECT * FROM events
// WHERE amount >= 100 AND status = 'active'
// ORDER BY event_time DESC
// LIMIT 10 OFFSET 0
*/
