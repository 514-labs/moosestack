/**
 * Field, Dimension, and Metric definitions.
 * These types define how columns, expressions, and aggregates are represented
 * in the query model.
 */

import type { Sql } from "@514labs/moose-lib";
import type { ColRef } from "./utils";

/**
 * Field definition for SELECT clauses (internal runtime type).
 * A field can be a simple column, a computed expression, or an aggregate.
 *
 * This is the internal type used after normalization - it uses ColRef objects
 * for actual SQL generation.
 *
 * @internal - Users should use DimensionDef or MetricDef in their configurations
 */
export interface FieldDef {
  /** Column reference (for simple fields) - resolved ColRef object */
  column?: ColRef<any>;
  /** SQL expression (for computed fields like toDate(timestamp)) */
  expression?: Sql;
  /** Aggregate function result (for metrics like count(), sum(amount)) */
  agg?: Sql;
  /** Output alias for the field */
  as?: string;
  /** @deprecated Use 'as' instead */
  alias?: string;
}

/**
 * Dimension definition - a column or expression used for grouping and filtering.
 * Dimensions represent categorical or temporal attributes that can be used to
 * segment data (e.g., status, day, month).
 *
 * Uses type-safe string column names (matching ModelFilterDef style).
 * Column names are validated against the table's model type at compile time.
 *
 * @template TModel - The table's model type
 * @template TKey - The column key (must be a key of TModel)
 *
 * @example
 * dimensions: {
 *   status: { column: "status" },  // Simple column
 *   day: { expression: sql`toDate(timestamp)`, as: "day" },  // Computed
 * }
 */
export interface DimensionDef<
  TModel = any,
  TKey extends keyof TModel = keyof TModel,
> {
  /** Column name - must be a key of the table's model type (type-checked!) */
  column?: TKey;
  /** SQL expression (for computed dimensions like toDate(timestamp)) */
  expression?: Sql;
  /** Output alias for the dimension */
  as?: string;
}

/**
 * Metric definition - an aggregate or computed value.
 * Metrics represent quantitative measures computed over dimensions
 * (e.g., totalEvents, totalAmount, avgAmount).
 */
export interface MetricDef {
  /** Aggregate function (e.g., count(), sum(amount), avg(amount)) */
  agg: Sql;
  /** Output alias for the metric */
  as: string;
}
