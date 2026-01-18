/**
 * 02 - Query Model
 *
 * Define a reusable query model with typed filters and sorting.
 * The model enforces which columns can be filtered/sorted and how.
 */

import { executeQuery } from "../client";
import { EventModel, Events } from "../models";
import { defineQueryModel, InferRequest } from "../query-layer";

// =============================================================================
// Define the Query Model
// =============================================================================

const eventsModel = defineQueryModel({
  table: Events,

  // Dimensions available in SELECT (can be columns or expressions)
  dimensions: {
    id: { column: "id" },
    timestamp: { column: "event_time" },
    amount: { column: "amount" },
    status: { column: "status" },
  },

  // Allowed filters with their operators
  // column: must be a key of the table's model type
  filters: {
    status: { column: "status", operators: ["eq", "ne", "in"] as const },
    amount: { column: "amount", operators: ["gte", "lte", "between"] as const },
    timestamp: { column: "event_time", operators: ["gte", "lte"] as const },
  },

  // Fields that can be sorted
  sortable: ["timestamp", "amount", "status"] as const,

  // Default behavior
  defaults: {
    orderBy: [["timestamp", "DESC"]],
    limit: 50,
    maxLimit: 500,
  },
});

// =============================================================================
// Infer the QueryRequest type from the model
// =============================================================================

// This gives you fully typed request:
// - filters.amount.gte is `number | undefined`
// - sortBy is `"timestamp" | "amount" | "status" | undefined`
// - dimensions and metrics are typed based on model configuration
type EventsQueryRequest = InferRequest<typeof eventsModel>;

// =============================================================================
// Query function using the model
// =============================================================================

async function queryEvents(request: EventsQueryRequest): Promise<EventModel[]> {
  return eventsModel.query(request, executeQuery<EventModel>);
}

// =============================================================================
// Usage
// =============================================================================

/*
await queryEvents({
  filters: {
    status: { eq: "active" },        // typed as string
    amount: { gte: 100, lte: 1000 }, // typed as number
  },
  sortBy: "amount",
  sortDir: "DESC",
  limit: 10,
});

// Generated SQL:
// SELECT event_id AS id, event_time AS timestamp, user_id AS userId, amount, status
// FROM events
// WHERE status = 'active' AND amount >= 100 AND amount <= 1000
// ORDER BY amount DESC
// LIMIT 10

// Invalid usage (TypeScript errors):
// queryEvents({ filters: { status: { gte: "x" } } })  // ❌ 'gte' not allowed for status
// queryEvents({ sortBy: "invalid" })                   // ❌ invalid sort field
*/
