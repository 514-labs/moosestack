// Note: this file defines/exports Moose resources (OlapTable, etc.) as plain TS modules
// so it can be imported directly by a runtime server without an extra build step.

import { OlapTable, Sql, sql } from "@514labs/moose-lib";
import typia, { tags } from "typia";
import { executeQuery } from "./client";

// Re-export typia tags for consumers to define their own validated types
export { tags };

// ============================================================================
// Validation helpers
// ============================================================================

export class ValidationError extends Error {
  constructor(
    public readonly errors: Array<{
      path: string;
      expected: string;
      value: unknown;
    }>,
  ) {
    super(
      `Validation failed: ${errors.map((e) => `${e.path}: expected ${e.expected}`).join(", ")}`,
    );
    this.name = "ValidationError";
  }
}

/**
 * Assert that validation succeeded, throw ValidationError if not.
 */
export function assertValid<T>(result: typia.IValidation<T>): T {
  if (!result.success) {
    throw new ValidationError(
      result.errors.map((e) => ({
        path: e.path,
        expected: e.expected,
        value: e.value,
      })),
    );
  }
  return result.data;
}

// ============================================================================
// Data Models
// ============================================================================

export interface EventModel {
  id: string;
  amount: number;
  event_time: Date;
  status: "completed" | "active" | "inactive";
}

export const Events = new OlapTable<EventModel>("events", {
  orderByFields: ["event_time"],
});

// ============================================================================
// Query: getEvents
// ============================================================================

export interface GetEventsParams {
  minAmount?: number & tags.Type<"uint32"> & tags.Minimum<0>;
  maxAmount?: number & tags.Type<"uint32">;
  status?: "completed" | "active" | "inactive";
  limit?: number & tags.Type<"uint32"> & tags.Minimum<1> & tags.Maximum<100>;
  offset?: number & tags.Type<"uint32"> & tags.Minimum<0>;
}

export const getEventsRequest = typia.http.createQuery<GetEventsParams>();
export const getEventsValidated = typia.functional.assertParameters(getEvents);

export async function getEvents(
  params: GetEventsParams,
): Promise<EventModel[]> {
  //params = assertValid(typia.validate<GetEventsParams>(params));

  const conditions: Sql[] = [];

  if (params.minAmount !== undefined) {
    conditions.push(sql`${Events.columns.amount} >= ${params.minAmount}`);
  }

  if (params.maxAmount !== undefined) {
    conditions.push(sql`${Events.columns.amount} <= ${params.maxAmount}`);
  }

  if (params.status) {
    conditions.push(sql`${Events.columns.status} = ${params.status}`);
  }

  let query = sql`SELECT * FROM ${Events}`;

  if (conditions.length > 0) {
    query = query.append(sql` WHERE ${sql.join(conditions, "AND")}`);
  }

  query = query.append(sql` ORDER BY ${Events.columns.event_time} DESC`);

  if (params.limit) {
    query = query.append(sql` LIMIT ${params.limit}`);
  }

  if (params.offset) {
    query = query.append(sql` OFFSET ${params.offset}`);
  }

  return await executeQuery<EventModel>(query);
}
