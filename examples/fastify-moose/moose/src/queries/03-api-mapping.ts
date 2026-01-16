/**
 * 03 - API Parameter Mapping
 *
 * Map user-friendly API params to the query model's filter structure.
 * This creates a clean separation between your API and the query layer.
 */

import typia, { tags } from "typia";
import { executeQuery } from "../client";
import { EventModel, Events } from "../models";
import { defineQueryModel, defineMapper } from "../queryModel";
import { assertValid } from "../utils";

// =============================================================================
// Query Model (same as 02-query-model.ts)
// =============================================================================

const eventsModel = defineQueryModel({
  table: Events,
  fields: {
    id: Events.columns.event_id,
    timestamp: Events.columns.event_time,
    userId: Events.columns.user_id,
    amount: Events.columns.amount,
    status: Events.columns.status,
  },
  filters: {
    status: { column: "status", operators: ["eq", "in"] as const },
    amount: { column: "amount", operators: ["gte", "lte"] as const },
    timestamp: { column: "event_time", operators: ["gte", "lte"] as const },
    userSearch: {
      column: "user_id",
      operators: ["ilike"] as const,
      transform: (v) => `%${v}%`, // Auto-wrap search terms
    },
  },
  sortable: ["timestamp", "amount"] as const,
  defaults: { orderBy: [["timestamp", "DESC"]], limit: 50 },
});

// =============================================================================
// User-Friendly API Params (validated with typia)
// =============================================================================

export interface EventsApiParams {
  // Friendly param names that map to filters
  status?: "completed" | "active" | "inactive";
  statuses?: ("completed" | "active" | "inactive")[];
  minAmount?: number & tags.Type<"uint32">;
  maxAmount?: number & tags.Type<"uint32">;
  startDate?: string & tags.Format<"date">;
  endDate?: string & tags.Format<"date">;
  search?: string;

  // Pass-through params
  sortBy?: "timestamp" | "amount";
  sortDir?: "ASC" | "DESC";
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<100>;
  page?: number & tags.Type<"uint32">;
}

// =============================================================================
// Define the Mapping
// =============================================================================

/**
 * Maps API param names → [filter, operator] or pass-through params.
 *
 * - ["status", "eq"]  → filters.status.eq = value
 * - "sortBy"          → sortBy = value (pass-through)
 */
const toQueryParams = defineMapper<EventsApiParams>()(
  eventsModel,
  {
    // Filter mappings: API param → [filterName, operator]
    status: ["status", "eq"],
    statuses: ["status", "in"],
    minAmount: ["amount", "gte"],
    maxAmount: ["amount", "lte"],
    startDate: ["timestamp", "gte"],
    endDate: ["timestamp", "lte"],
    search: ["userSearch", "ilike"],

    // Pass-through params (sortBy, sortDir, limit, page, etc.)
    sortBy: "sortBy",
    sortDir: "sortDir",
    limit: "limit",
    page: "page",
  },
  {
    // Defaults when params are undefined
    sortBy: "timestamp",
    sortDir: "DESC",
    limit: 50,
  },
);

// =============================================================================
// Query Functions
// =============================================================================

/** Query with API params */
export async function queryEvents(
  params: EventsApiParams,
): Promise<EventModel[]> {
  return eventsModel.query(toQueryParams(params), executeQuery<EventModel>);
}

/** Query from URL (validates and parses query string) */
export async function queryEventsFromUrl(
  url: string | URL,
): Promise<EventModel[]> {
  const search =
    typeof url === "string" ?
      new URL(url, "http://localhost").search
    : url.search;
  const params = assertValid(
    typia.http.createValidateQuery<EventsApiParams>()(search),
  );
  return queryEvents(params);
}

// =============================================================================
// Usage
// =============================================================================

/*
// Clean API params
await queryEvents({
  status: "active",
  minAmount: 100,
  startDate: "2024-01-01",
  sortBy: "amount",
});

// From URL query string
await queryEventsFromUrl("/events?status=active&minAmount=100&sortBy=amount");

// Both produce:
// SELECT ... FROM events
// WHERE status = 'active' AND amount >= 100 AND event_time >= '2024-01-01'
// ORDER BY amount DESC
// LIMIT 50
*/
