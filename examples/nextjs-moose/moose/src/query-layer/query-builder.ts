/**
 * Fluent Query Builder API
 *
 * Provides a chainable API for building QueryRequest objects.
 * Users specify dimensions/metrics - semantic concepts, not SQL concepts.
 *
 * @module query-layer/query-builder
 */

import type { Sql, QueryClient } from "@514labs/moose-lib";
import type {
  SortDir,
  FilterDefBase,
  QueryRequest,
  QueryParts,
  Names,
  OperatorValueType,
  DimensionDef,
  MetricDef,
  SqlValue,
} from "./types";
import type { QueryModel } from "./query-model";

/**
 * Extract the value type from a filter definition.
 */
type FilterValueType<T> =
  T extends { column: infer TKey extends string } ?
    T extends { column: TKey } ?
      SqlValue
    : SqlValue
  : SqlValue;

/**
 * Fluent builder for constructing query requests.
 *
 * @template TMetrics - Union type of metric field names
 * @template TDimensions - Union type of dimension field names
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 * @template TResult - Result row type
 *
 * @example
 * const results = await buildQuery(model)
 *   .dimensions(["status"])
 *   .metrics(["totalEvents", "totalAmount"])
 *   .filter("status", "eq", "active")
 *   .sort("totalAmount", "DESC")
 *   .limit(10)
 *   .execute(client.query);
 */
export interface QueryBuilder<
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
  TTable = any,
> {
  /**
   * Add a filter condition.
   * Automatically skips if value is undefined or null.
   */
  filter<K extends keyof TFilters, Op extends TFilters[K]["operators"][number]>(
    filterName: K,
    op: Op,
    value: OperatorValueType<Op, FilterValueType<TFilters[K]>> | undefined,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set dimensions to include in query */
  dimensions(
    fields: TDimensions[],
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set metrics to include in query */
  metrics(
    fields: TMetrics[],
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set sort field and direction */
  sort(
    field: TSortable,
    dir?: SortDir,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set multi-column sort */
  orderBy(
    ...orders: Array<[TSortable, SortDir]>
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set maximum number of rows to return */
  limit(
    n: number,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set page number (0-indexed) for pagination */
  page(
    n: number,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Set row offset for pagination */
  offset(
    n: number,
  ): QueryBuilder<TMetrics, TDimensions, TFilters, TSortable, TResult, TTable>;

  /** Build the QueryRequest object */
  build(): QueryRequest<TMetrics, TDimensions, TFilters, TSortable, TTable>;

  /** Build the SQL query */
  toSql(): Sql;

  /** Get query parts for custom assembly */
  toParts(): QueryParts;

  /** Build SQL with custom assembly function */
  assemble(fn: (parts: QueryParts) => Sql): Sql;

  /**
   * Execute the query with Moose QueryClient.
   * @param client - Moose QueryClient from getMooseClients()
   */
  execute(client: QueryClient): Promise<TResult[]>;
}

/**
 * Create a fluent query builder for a model.
 *
 * @param model - QueryModel instance to build queries for
 * @returns QueryBuilder instance with chainable methods
 *
 * @example
 * const results = await buildQuery(model)
 *   .dimensions(["status"])
 *   .metrics(["totalEvents", "totalAmount"])
 *   .filter("status", "eq", "active")
 *   .sort("totalAmount", "DESC")
 *   .limit(10)
 *   .execute(client.query);
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
  TResult,
  TTable
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
    TSortable,
    TTable
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
      TSortable,
      TTable
    >;

  const builder: QueryBuilder<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    TResult,
    TTable
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
    assemble: (fn) => fn(model.toParts(buildRequest())),
    execute: (client) => model.query(buildRequest(), client),
  };

  return builder;
}
