/**
 * Fluent Query Builder API.
 *
 * Provides a chainable API for building QueryRequest objects.
 * Users specify dimensions/metrics - semantic concepts, not SQL concepts.
 * The builder automatically handles undefined/null values and provides type-safe methods.
 *
 * **IMPORTANT**: QueryBuilder and QueryMapper are alternatives - use one OR the other, not both.
 * - Use QueryBuilder when building queries programmatically in code
 * - Use QueryMapper when transforming custom API request shapes
 * Both produce QueryRequest objects that get resolved and executed.
 */

import type { Sql } from "@514labs/moose-lib";
import type { SortDir } from "./types";
import type { FilterDefBase, FilterValueType } from "./filters";
import type { QueryRequest, QueryParts } from "./query-request";
import type { QueryModel } from "./query-model";
import type { MetricDef, DimensionDef } from "./fields";
import type { Names, OperatorValueType } from "./type-helpers";

/**
 * Fluent builder for constructing query requests.
 * Provides a chainable API for building QueryRequest objects.
 * Users specify dimensions/metrics - semantic concepts, not SQL concepts.
 *
 * **Alternative to QueryMapper**: Use QueryBuilder for programmatic query building,
 * or QueryMapper for transforming custom API shapes. Don't use both together.
 *
 * @template TMetrics - Union type of metric field names
 * @template TDimensions - Union type of dimension field names
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 * @template TResult - Result row type
 *
 * @example
 * // Build and execute (programmatic approach)
 * const results = await buildQuery(model)
 *   .dimensions(["status"])
 *   .metrics(["totalEvents", "totalAmount"])
 *   .filter("status", "eq", "active")
 *   .sort("totalAmount", "DESC")
 *   .limit(10)
 *   .execute(executeQuery);
 *
 * // Or build QueryRequest and use later
 * const request = buildQuery(model)
 *   .dimensions(["status"])
 *   .metrics(["totalEvents"])
 *   .build();
 * const results = await model.query(request, executeQuery);
 */
export interface QueryBuilder<
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
> {
  /**
   * Add a filter condition.
   * Automatically skips if value is undefined or null.
   * @param filterName - Name of the filter (must be a key of TFilters)
   * @param op - Filter operator (must be allowed for this filter)
   * @param value - Filter value (type-checked based on operator and filter definition)
   */
  filter<K extends keyof TFilters, Op extends TFilters[K]["operators"][number]>(
    filterName: K,
    op: Op,
    value: OperatorValueType<Op, FilterValueType<TFilters[K]>> | undefined,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set dimensions to include in query (user-facing semantic concept).
   * @param fields - Array of dimension field names
   */
  dimensions(
    fields: TDimensions[],
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set metrics to include in query (user-facing semantic concept).
   * @param fields - Array of metric field names
   */
  metrics(
    fields: TMetrics[],
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set sort field and direction.
   * @param field - Field to sort by (must be in sortable list)
   * @param dir - Sort direction (defaults to "DESC")
   */
  sort(
    field: TSortable,
    dir?: SortDir,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set multi-column sort.
   * @param orders - Array of [field, direction] tuples
   */
  orderBy(
    ...orders: Array<[TSortable, SortDir]>
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set maximum number of rows to return.
   * @param n - Limit value
   */
  limit(
    n: number,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set page number (0-indexed) for pagination.
   * @param n - Page number
   */
  page(
    n: number,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Set row offset for pagination.
   * @param n - Offset value
   */
  offset(
    n: number,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult>;

  /**
   * Build the QueryRequest object from current builder state.
   * @returns QueryRequest ready to pass to QueryModel methods
   */
  build(): QueryRequest<TMetrics, TDimensions, TFilters, TSortable>;

  /**
   * Build the SQL query from current builder state.
   * @returns Complete SQL query
   */
  toSql(): Sql;

  /**
   * Build the SQL query from current builder state.
   * @returns Complete SQL query
   */
  toSql(): Sql;

  /**
   * Get query parts for custom assembly.
   * @returns QueryParts object with individual SQL clauses
   */
  toParts(): QueryParts;

  /**
   * Build SQL with custom assembly function.
   * @param fn - Function to assemble SQL parts into final query
   * @returns Complete SQL query
   */
  assemble(fn: (parts: QueryParts) => Sql): Sql;

  /**
   * Execute the query with current builder state.
   * @param execute - Function to execute the SQL query
   * @returns Promise resolving to array of result rows
   */
  execute(execute: (query: Sql) => Promise<TResult[]>): Promise<TResult[]>;
}

/**
 * Create a fluent query builder for a model.
 * Provides a chainable API for building QueryRequest objects.
 *
 * **Alternative to QueryMapper**: Use this for programmatic query building.
 * If you need to transform custom API shapes, use `defineMapper()` instead.
 *
 * @template TMetrics - Record of metric definitions
 * @template TDimensions - Record of dimension definitions
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 * @template TResult - Result row type
 *
 * @param model - QueryModel instance to build queries for
 * @returns QueryBuilder instance with chainable methods
 *
 * @example
 * // Programmatic query building
 * const results = await buildQuery(model)
 *   .dimensions(["status"])
 *   .metrics(["totalEvents", "totalAmount"])
 *   .filter("status", "eq", "active")
 *   .sort("totalAmount", "DESC")
 *   .limit(10)
 *   .execute(executeQuery);
 */
export function buildQuery<
  TTable,
  TMetrics extends Record<string, MetricDef>,
  TDimensions extends Record<string, DimensionDef<any, any>>,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
>(
  model: QueryModel<
    TTable,
    TMetrics,
    TDimensions,
    TFilters,
    TSortable,
    TResult
  >,
): QueryBuilder<
  Names<TMetrics>,
  Names<TDimensions>,
  TFilters,
  TSortable,
  TResult
> {
  const state: {
    filters: Record<string, Record<string, unknown>>;
    dimensions?: Array<Names<TDimensions>>;
    metrics?: Array<Names<TMetrics>>;
    orderBy?: Array<[TSortable, SortDir]>;
    sortBy?: TSortable;
    sortDir?: SortDir;
    limit?: number;
    page?: number;
    offset?: number;
  } = { filters: {} };

  const buildRequest = (): QueryRequest<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable
  > =>
    ({
      filters:
        Object.keys(state.filters).length > 0 ? state.filters : undefined,
      dimensions: state.dimensions,
      metrics: state.metrics,
      orderBy: state.orderBy,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      limit: state.limit,
      page: state.page,
      offset: state.offset,
    }) as QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable
    >;

  const builder: QueryBuilder<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    TResult
  > = {
    filter(filterName, op, value) {
      if (value === undefined || value === null) return builder;
      const key = String(filterName);
      if (!state.filters[key]) state.filters[key] = {};
      state.filters[key][op] = value;
      return builder;
    },

    dimensions(fields) {
      state.dimensions = fields;
      return builder;
    },

    metrics(fields) {
      state.metrics = fields;
      return builder;
    },

    sort(field, dir = "DESC") {
      state.sortBy = field;
      state.sortDir = dir;
      return builder;
    },

    orderBy(...orders) {
      state.orderBy = orders;
      return builder;
    },

    limit(n) {
      state.limit = n;
      return builder;
    },

    page(n) {
      state.page = n;
      return builder;
    },

    offset(n) {
      state.offset = n;
      return builder;
    },

    build: buildRequest,
    toSql: () => model.toSql(buildRequest()),
    toParts: () => model.toParts(buildRequest()),
    assemble: (fn) => model.build(buildRequest(), fn),
    execute: (execute) => model.query(buildRequest(), execute),
  };

  return builder;
}
