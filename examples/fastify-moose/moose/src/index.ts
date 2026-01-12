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

function isTypiaTypeGuardError(
  err: unknown,
): err is { path: string; expected: string; value: unknown } {
  return (
    typeof err === "object" &&
    err !== null &&
    "path" in err &&
    "expected" in err &&
    "value" in err
  );
}

function toSearchParamsFromUrl(url: string): URLSearchParams {
  const queryString = url.split("?")[1] ?? "";
  return new URLSearchParams(queryString);
}

/**
 * Create a consistent "parse → validate → run" wrapper for query handlers.
 *
 * Why this exists:
 * - Fastify's `request.query` is already-parsed and stringly-typed.
 * - Typia's `http.createQuery<T>()` wants the raw querystring / URLSearchParams so it can parse+coerce.
 * - We want all failures to throw `ValidationError` (not typia's `TypeGuardError`) so API handlers can
 *   respond with a stable error shape.
 *
 * IMPORTANT: Typia requires **concrete** generic types at the callsite (via its TS transform).
 * That means this helper must NOT call `typia.http.createQuery<T>()` / `typia.validate<T>()` using
 * a generic type parameter. Instead, pass in the already-created, concrete parse/validate functions.
 */
export function createQueryHandler<TParams, TResult>(options: {
  parseSearchParams: (searchParams: URLSearchParams) => TParams;
  validate: (input: unknown) => TParams;
  queryFn: (params: TParams) => Promise<TResult>;
}) {
  const parseSearchParams = (searchParams: URLSearchParams): TParams => {
    try {
      return options.parseSearchParams(searchParams);
    } catch (err) {
      if (isTypiaTypeGuardError(err)) {
        throw new ValidationError([
          { path: err.path, expected: err.expected, value: err.value },
        ]);
      }
      throw err;
    }
  };

  const parseFromUrl = (url: string): TParams => {
    return parseSearchParams(toSearchParamsFromUrl(url));
  };

  const validate = (input: unknown): TParams => options.validate(input);

  const run = (params: TParams): Promise<TResult> => options.queryFn(params);

  const runValidated = (input: unknown): Promise<TResult> => {
    return options.queryFn(validate(input));
  };

  const fromUrl = (url: string): Promise<TResult> => {
    return runValidated(parseFromUrl(url));
  };

  return {
    parseSearchParams,
    parseFromUrl,
    validate,
    run,
    runValidated,
    fromUrl,
  };
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

export async function getEvents(
  params: GetEventsParams,
): Promise<EventModel[]> {
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

/**
 * Export a cohesive set of tools for this query:
 * - `parseFromUrl(url)` parses+coerces querystring values using typia tags
 * - `fromUrl(url)` parses, validates, and executes `getEvents`
 */
const parseGetEventsParams = typia.http.createQuery<GetEventsParams>();
const validateGetEventsParams = (input: unknown): GetEventsParams => {
  return assertValid(typia.validate<GetEventsParams>(input));
};

export const getEventsQuery = createQueryHandler<GetEventsParams, EventModel[]>(
  {
    parseSearchParams: parseGetEventsParams,
    validate: validateGetEventsParams,
    queryFn: getEvents,
  },
);

// Back-compat helpers for the Fastify example controller.
export const getEventsRequest = getEventsQuery.parseSearchParams;
export const getEventsValidated = getEventsQuery.run;
export const getEventsFromUrl = getEventsQuery.fromUrl;
