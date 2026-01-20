/**
 * Type inference helpers for working with query models.
 * These utilities extract types from query model configurations.
 */

import type { FilterOperator, SqlValue } from "./types";
import type { FilterDefBase } from "./filters";
import type { QueryRequest } from "./query-request";
import type { QueryModel } from "./query-model";

/**
 * Extract string keys from a record type.
 * Used to convert dimension/metric record types to union types of their keys.
 *
 * @template T - Record type to extract keys from
 *
 * @example
 * type MyDims = { status: DimensionDef; day: DimensionDef };
 * type DimNames = Names<MyDims>; // "status" | "day"
 */
export type Names<T> = Extract<keyof T, string>;

/**
 * Infer the value type for a given operator and base value type.
 * Maps filter operators to their required value types:
 * - Scalar operators (eq, ne, gt, etc.): single value
 * - List operators (in, notIn): array of values
 * - Range operators (between): tuple [low, high]
 * - Null operators (isNull, isNotNull): boolean flag
 *
 * @template Op - Filter operator
 * @template TValue - Base value type (defaults to SqlValue)
 */
export type OperatorValueType<Op extends FilterOperator, TValue = SqlValue> =
  Op extends "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" ?
    TValue
  : Op extends "in" | "notIn" ? TValue[]
  : Op extends "between" ? [TValue, TValue]
  : Op extends "isNull" | "isNotNull" ? boolean
  : never;

/**
 * Extract dimension names as a union type from a QueryModel.
 *
 * @template TModel - QueryModel instance
 *
 * @example
 * const model = defineQueryModel({ ... });
 * type DimNames = InferDimensionNames<typeof model>; // "status" | "day"
 */
export type InferDimensionNames<TModel> =
  TModel extends (
    QueryModel<any, infer TMetrics, infer TDimensions, any, any, any>
  ) ?
    TDimensions extends Record<string, any> ?
      keyof TDimensions & string
    : never
  : never;

/**
 * Extract metric names as a union type from a QueryModel.
 *
 * @template TModel - QueryModel instance
 *
 * @example
 * const model = defineQueryModel({ ... });
 * type MetricNames = InferMetricNames<typeof model>; // "totalEvents" | "totalAmount"
 */
export type InferMetricNames<TModel> =
  TModel extends QueryModel<any, infer TMetrics, any, any, any, any> ?
    TMetrics extends Record<string, any> ?
      keyof TMetrics & string
    : never
  : never;

/**
 * Infer QueryRequest type from a QueryModel instance.
 * Useful for extracting the request type without manually specifying all generics.
 *
 * @template TModel - QueryModel instance
 *
 * @example
 * const model = defineQueryModel({ ... });
 * type MyRequest = InferRequest<typeof model>;
 * // MyRequest is fully typed based on the model configuration
 */
export type InferRequest<TModel> =
  TModel extends (
    QueryModel<
      any,
      infer TMetrics,
      infer TDimensions,
      infer TFilters,
      infer TSortable,
      any
    >
  ) ?
    QueryRequest<Names<TMetrics>, Names<TDimensions>, TFilters, TSortable>
  : never;

/**
 * Infer result type from a QueryModel instance.
 * This is a placeholder - actual result types depend on the query execution.
 * In practice, you should define result types based on your SELECT fields.
 *
 * @template TModel - QueryModel instance
 */
export type InferResult<TModel> =
  TModel extends QueryModel<any, any, any, any, any, infer TResult> ? TResult
  : never;

/**
 * Infer filter parameters with proper value types from a QueryModel.
 * Uses TTable to look up column types directly from the table model.
 *
 * @template TFilters - Record of filter definitions
 * @template TTable - Table model type for column type lookups
 *
 * @example
 * // Given filters: { status: { column: "status", operators: ["eq", "in"] } }
 * // And table model: { status: "active" | "inactive" }
 * // Result type: { status?: { eq?: "active" | "inactive"; in?: ("active" | "inactive")[] } }
 */
export type InferFilterParamsWithTable<
  TFilters extends Record<string, FilterDefBase>,
  TTable,
> = {
  [K in keyof TFilters]?: {
    [Op in TFilters[K]["operators"][number]]?: OperatorValueType<
      Op,
      TFilters[K] extends { column: infer TKey extends keyof TTable } ?
        TTable[TKey]
      : SqlValue
    >;
  };
};
