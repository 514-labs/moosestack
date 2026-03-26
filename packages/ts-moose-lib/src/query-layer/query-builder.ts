/**
 * Fluent Query Builder API
 *
 * Provides a chainable API for building QueryRequest objects.
 *
 * @module query-layer/query-builder
 */

import type { Sql } from "../sqlHelpers";
import type { QueryClient } from "../consumption-apis/helpers";
import type {
  SortDir,
  SqlValue,
  FilterDefBase,
  QueryRequest,
  QueryParts,
  Names,
  OperatorValueType,
  ColumnDef,
  DimensionDef,
  MetricDef,
} from "./types";
import type { QueryModel } from "./query-model";

/**
 * Fluent builder for constructing query requests.
 *
 * @example
 * const results = await buildQuery(model)
 *   .dimensions(["status"])
 *   .metrics(["totalEvents", "totalAmount"])
 *   .filter("status", "eq", "active")
 *   .orderBy(["totalAmount", "DESC"])
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
  TColumns extends string = string,
> {
  /** Add a filter condition. Automatically skips if value is undefined or null. */
  filter<K extends keyof TFilters, Op extends TFilters[K]["operators"][number]>(
    filterName: K,
    op: Op,
    value: OperatorValueType<Op, SqlValue> | undefined,
  ): this;

  /** Set dimensions to include in query (aggregate mode) */
  dimensions(fields: TDimensions[]): this;

  /** Set metrics to include in query (aggregate mode) */
  metrics(fields: TMetrics[]): this;

  /** Set columns for detail mode (no aggregation, no GROUP BY) */
  columns(fields: TColumns[]): this;

  /** Set multi-column sort */
  orderBy(...orders: Array<[TSortable, SortDir]>): this;

  /** Set maximum number of rows to return */
  limit(n: number): this;

  /** Set page number (0-indexed) for pagination */
  page(n: number): this;

  /** Set row offset for pagination */
  offset(n: number): this;

  /** Build the QueryRequest object */
  build(): QueryRequest<
    TMetrics,
    TDimensions,
    TFilters,
    TSortable,
    TColumns,
    TTable
  >;

  /** Build the SQL query */
  toSql(): Sql;

  /** Get query parts for custom assembly */
  toParts(): QueryParts;

  /** Build SQL with custom assembly function */
  assemble(fn: (parts: QueryParts) => Sql): Sql;

  /** Execute the query with Moose QueryClient. */
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
 *   .orderBy(["totalAmount", "DESC"])
 *   .limit(10)
 *   .execute(client.query);
 */
export function buildQuery<
  TTable,
  TMetrics extends Record<string, MetricDef>,
  TDimensions extends Record<string, DimensionDef>,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
  TColumns extends Record<string, ColumnDef> = Record<string, never>,
>(
  model: QueryModel<
    TTable,
    TMetrics,
    TDimensions,
    TFilters,
    TSortable,
    TResult,
    TColumns
  >,
): QueryBuilder<
  Names<TMetrics>,
  Names<TDimensions>,
  TFilters,
  TSortable,
  TResult,
  TTable,
  Names<TColumns>
> {
  const state: {
    filters: Record<string, Record<string, unknown>>;
    dimensions?: Array<Names<TDimensions>>;
    metrics?: Array<Names<TMetrics>>;
    columns?: Array<Names<TColumns>>;
    orderBy?: Array<[TSortable, SortDir]>;
    limit?: number;
    page?: number;
    offset?: number;
  } = {
    filters: Object.create(null) as Record<string, Record<string, unknown>>,
  };

  const buildRequest = (): QueryRequest<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    Names<TColumns>,
    TTable
  > =>
    ({
      filters:
        Object.keys(state.filters).length > 0 ? state.filters : undefined,
      dimensions: state.dimensions,
      metrics: state.metrics,
      columns: state.columns,
      orderBy: state.orderBy,
      limit: state.limit,
      page: state.page,
      offset: state.offset,
    }) as QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >;

  const builder: QueryBuilder<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    TResult,
    TTable,
    Names<TColumns>
  > = {
    filter(filterName, op, value) {
      if (value === undefined || value === null) return builder;
      const key = String(filterName);
      if (!Object.hasOwn(state.filters, key)) state.filters[key] = {};
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

    columns(fields) {
      state.columns = fields;
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
      state.offset = undefined;
      return builder;
    },

    offset(n) {
      state.offset = n;
      state.page = undefined;
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
