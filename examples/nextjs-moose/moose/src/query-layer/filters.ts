/**
 * Filter-related types and utilities.
 * Defines how filters are configured and applied to queries.
 */

import type { SqlValue, FilterOperator, ColRef } from "./types";

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
 * Input type hint for filter UI rendering.
 * Used by buildFiltersFromModel to determine the appropriate input component.
 */
export type FilterInputTypeHint =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multiselect";

/**
 * Derive FilterInputTypeHint from a ClickHouse column data_type string.
 *
 * Maps ClickHouse types to appropriate UI input types:
 * - DateTime64, DateTime, Date → "date"
 * - Int*, UInt*, Float*, Decimal → "number"
 * - Enum* → "select"
 * - String, FixedString → "text"
 *
 * @param dataType - The column's data_type (string or nullable wrapper)
 * @returns The appropriate FilterInputTypeHint
 */
export function deriveInputTypeFromDataType(
  dataType: string | { nullable: unknown } | unknown,
): FilterInputTypeHint {
  // Unwrap nullable types
  let typeStr: string;
  if (typeof dataType === "string") {
    typeStr = dataType;
  } else if (
    dataType &&
    typeof dataType === "object" &&
    "nullable" in dataType
  ) {
    return deriveInputTypeFromDataType(
      (dataType as { nullable: unknown }).nullable,
    );
  } else {
    return "text";
  }

  const lower = typeStr.toLowerCase();

  // Date/DateTime types
  if (lower.startsWith("datetime") || lower.startsWith("date")) {
    return "date";
  }

  // Numeric types (Int8, Int16, Int32, Int64, UInt*, Float32, Float64, Decimal)
  if (
    lower.startsWith("int") ||
    lower.startsWith("uint") ||
    lower.startsWith("float") ||
    lower.startsWith("decimal")
  ) {
    return "number";
  }

  // Enum types → select (for dropdowns)
  if (lower.startsWith("enum")) {
    return "select";
  }

  // Boolean → select (true/false dropdown)
  if (lower === "bool" || lower === "boolean") {
    return "select";
  }

  // Default to text for String, FixedString, and unknown types
  return "text";
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
 * // User-friendly configuration with auto-inferred input types
 * filters: {
 *   status: { column: "status", operators: ["eq", "in"] as const },
 *   amount: { column: "amount", operators: ["gte", "lte"] as const },
 *   timestamp: { column: "event_time", operators: ["gte", "lte"] as const, inputType: "date" },
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
  /**
   * Optional input type hint for UI rendering.
   * If not specified, will be inferred from column name patterns and operators.
   * Providing this explicitly ensures correct input type regardless of naming.
   */
  inputType?: FilterInputTypeHint;
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
