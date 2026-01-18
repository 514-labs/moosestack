/**
 * Filter-related types and utilities.
 * Defines how filters are configured and applied to queries.
 */

import type { SqlValue } from "./types";
import type { FilterOperator } from "./types";
import type { ColRef } from "./types";

/**
 * Runtime filter definition.
 * Used internally after configuration is resolved.
 *
 * Uses actual column references (ColRef objects) needed for SQL generation.
 * This is created from ModelFilterDef during model initialization.
 *
 * @template TValue - The value type for this filter
 *
 * @internal - Users should use ModelFilterDef in their configurations
 */
export interface FilterDef<TModel, TValue = SqlValue> {
  /** Column reference to filter on (actual ColRef object from table.columns) */
  column: ColRef<TModel>;
  /** Allowed operators for this filter */
  operators: readonly FilterOperator[];
  /** Optional transform applied to values before filtering (e.g., wrap in %...% for LIKE) */
  transform?: (value: TValue) => SqlValue;
}

/**
 * Filter definition for use in defineQueryModel configuration.
 * Uses column names (keys of the table model) instead of column references,
 * which provides better type safety and cleaner configuration syntax.
 *
 * This is converted to FilterDef internally during model initialization.
 *
 * @template TModel - The table's model type
 * @template TKey - The column key (must be a key of TModel)
 *
 * @example
 * // User-friendly configuration
 * filters: {
 *   status: { column: "status", operators: ["eq", "in"] as const },
 *   amount: { column: "amount", operators: ["gte", "lte"] as const },
 * }
 *
 * // Internally converted to FilterDef with actual ColRef objects:
 * // { column: Events.columns.status, operators: [...], ... }
 */
export interface ModelFilterDef<
  TModel,
  TKey extends keyof TModel = keyof TModel,
> {
  /** Column name - must be a key of the table's model type (type-checked!) */
  column: TKey;
  /** Allowed filter operators for this column */
  operators: readonly FilterOperator[];
  /** Optional transform applied to filter values (e.g., wrap in %...% for LIKE) */
  transform?: (value: TModel[TKey]) => SqlValue;
}

/**
 * Base constraint for filter definitions.
 * Any filter definition must have at least an operators array.
 */
export type FilterDefBase = { operators: readonly FilterOperator[] };

/**
 * Extract the value type from a filter definition.
 * Handles both FilterDef and ModelFilterDef types.
 */
export type FilterValueType<T> =
  T extends FilterDef<infer M, infer V> ? V
  : T extends ModelFilterDef<infer M, infer K> ? M[K]
  : SqlValue;
