/**
 * Query request types.
 * Defines the user-facing structure for query requests with dimensions and metrics.
 */

import type { SortDir } from "./types";
import type { FilterDefBase, FilterValueType } from "./filters";
import type { OperatorValueType } from "./type-helpers";
import type { Sql } from "@514labs/moose-lib";

/**
 * Filter parameters structure derived from filter definitions.
 * Provides type-safe filter values based on the allowed operators for each filter.
 *
 * @template TFilters - Record of filter definitions
 *
 * @example
 * // Given filters: { status: { operators: ["eq", "in"] }, amount: { operators: ["gte", "lte"] } }
 * // Result type: {
 * //   status?: { eq?: string; in?: string[] };
 * //   amount?: { gte?: number; lte?: number };
 * // }
 */
export type FilterParams<TFilters extends Record<string, FilterDefBase>> = {
  [K in keyof TFilters]?: {
    [Op in TFilters[K]["operators"][number]]?: OperatorValueType<
      Op,
      FilterValueType<TFilters[K]>
    >;
  };
};

/**
 * User-facing query request specification.
 * Users specify dimensions and metrics - semantic concepts, not SQL concepts.
 *
 * @template TMetrics - Union type of metric field names
 * @template TDimensions - Union type of dimension field names
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 *
 * @example
 * const request: QueryRequest = {
 *   dimensions: ["status", "day"],
 *   metrics: ["totalEvents", "totalAmount"],
 *   filters: { status: { eq: "active" } },
 *   sortBy: "totalAmount",
 *   sortDir: "DESC",
 *   limit: 10,
 * };
 */
export type QueryRequest<
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
> = {
  /** Filter conditions keyed by filter name */
  filters?: FilterParams<TFilters>;

  /** Dimensions to include in query (user-facing semantic concept) */
  dimensions?: TDimensions[];

  /** Metrics to include in query (user-facing semantic concept) */
  metrics?: TMetrics[];

  /** Multi-column sort specification */
  orderBy?: Array<[TSortable, SortDir]>;
  /** Single column sort field (alternative to orderBy) */
  sortBy?: TSortable;
  /** Sort direction (used with sortBy) */
  sortDir?: SortDir;
  /** Maximum number of rows to return */
  limit?: number;
  /** Page number (0-indexed, used with limit for pagination) */
  page?: number;
  /** Row offset (alternative to page) */
  offset?: number;
};

/**
 * Individual SQL clauses for custom query assembly.
 * Use this when you need full control over SQL structure (e.g., custom SELECT ordering).
 *
 * @example
 * const parts = model.toParts(request);
 * const customQuery = sql`
 *   SELECT ${parts.dimensions}, ${parts.metrics}
 *   ${parts.from}
 *   ${parts.where}
 *   ${parts.groupBy}
 *   ${parts.orderBy}
 * `;
 */
export interface QueryParts {
  /** Full SELECT clause (dimensions + metrics combined) */
  select: Sql;
  /** Just dimension fields (for custom SELECT with custom metrics) */
  dimensions: Sql;
  /** Just metric fields (aggregates only) */
  metrics: Sql;
  /** FROM clause */
  from: Sql;
  /** Individual filter conditions (before combining with WHERE) */
  conditions: Sql[];
  /** Complete WHERE clause (includes "WHERE" keyword) */
  where: Sql;
  /** GROUP BY clause (includes "GROUP BY" keyword) */
  groupBy: Sql;
  /** ORDER BY clause (includes "ORDER BY" keyword) */
  orderBy: Sql;
  /** Combined LIMIT + OFFSET clause for pagination */
  pagination: Sql;
  /** LIMIT clause only */
  limit: Sql;
  /** OFFSET clause only */
  offset: Sql;
}
