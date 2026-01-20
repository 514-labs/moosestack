/**
 * Resolved query specification.
 * Internal representation used by query compilation layer for SQL generation.
 * Contains select/groupBy (SQL concepts) derived from QueryRequest (dimensions/metrics).
 * Users should never interact with this type directly.
 */

import type { SortDir } from "./types";
import type { FilterDefBase } from "./filters";
import type { FilterParams } from "./query-request";

/**
 * Resolved query specification.
 * Internal representation used by query compilation layer for SQL generation.
 * Contains select/groupBy (SQL concepts) derived from QueryRequest (dimensions/metrics).
 * Users should never interact with this type directly.
 *
 * @template TMetrics - Union type of metric field names
 * @template TDimensions - Union type of dimension field names
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 */
export type ResolvedQuerySpec<
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
> = {
  /** Filter conditions keyed by filter name */
  filters?: FilterParams<TFilters>;

  /** Fields to select (auto-derived from dimensions + metrics) */
  select?: Array<TMetrics | TDimensions>;

  /** Dimensions to group by (auto-derived from dimensions) */
  groupBy?: TDimensions[];

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
