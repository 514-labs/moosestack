/**
 * Query Layer Types
 *
 * Consolidated type definitions for the query layer.
 * This file contains all public types used by developers building
 * dashboard UIs on top of ClickHouse queries.
 *
 * @module query-layer/types
 */

import type { Sql } from "@514labs/moose-lib";

// =============================================================================
// Basic Types
// =============================================================================

/** Valid SQL values that can be parameterized */
export type SqlValue = string | number | boolean | Date;

/**
 * Column reference - accepts actual Column objects from OlapTable.columns.* or raw Sql.
 *
 * @example
 * const col = Events.columns.amount;
 * const expr = sql`CASE WHEN ${Events.columns.amount} > 100 THEN 'high' ELSE 'low' END`;
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ColRef<TModel> = Sql | any;

/**
 * Supported filter operators for building WHERE conditions.
 *
 * Each operator has specific value type requirements:
 * - Scalar operators (eq, ne, gt, gte, lt, lte, like, ilike): single value
 * - List operators (in, notIn): array of values
 * - Range operators (between): tuple [low, high]
 * - Null operators (isNull, isNotNull): boolean flag
 */
export type FilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "notIn"
  | "between"
  | "isNull"
  | "isNotNull";

/** Sort direction for ORDER BY clauses */
export type SortDir = "ASC" | "DESC";

// =============================================================================
// Field Definitions
// =============================================================================

/**
 * Dimension definition - a column or expression used for grouping and filtering.
 *
 * Dimensions represent categorical or temporal attributes that can be used to
 * segment data (e.g., status, day, month). Column names are validated against
 * the table's model type at compile time.
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
  /** Column name - must be a key of the table's model type */
  column?: TKey;
  /** SQL expression (for computed dimensions like toDate(timestamp)) */
  expression?: Sql;
  /** Output alias for the dimension */
  as?: string;
}

/**
 * Metric definition - an aggregate or computed value.
 *
 * Metrics represent quantitative measures computed over dimensions
 * (e.g., totalEvents, totalAmount, avgAmount).
 *
 * @example
 * metrics: {
 *   // Key name is used as alias automatically
 *   totalAmount: { agg: sql`sum(amount)` },
 *   totalEvents: { agg: sql`count(*)` },
 *   // Or specify explicit alias if different from key
 *   revenue: { agg: sql`sum(amount)`, as: "total_revenue" },
 * }
 */
export interface MetricDef {
  /** Aggregate function (e.g., count(), sum(amount), avg(amount)) */
  agg: Sql;
  /** Output alias for the metric (defaults to the key name if not specified) */
  as?: string;
}

// =============================================================================
// Filter Definitions
// =============================================================================

/**
 * Input type hint for filter UI rendering.
 * Used to determine the appropriate input component.
 */
export type FilterInputTypeHint =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multiselect";

/**
 * Filter definition for use in defineQueryModel configuration.
 *
 * Uses column names (keys of the table model) instead of column references,
 * which provides better type safety and cleaner configuration syntax.
 *
 * @template TModel - The table's model type
 * @template TKey - The column key (must be a key of TModel)
 *
 * @example
 * filters: {
 *   status: { column: "status", operators: ["eq", "in"] as const },
 *   amount: { column: "amount", operators: ["gte", "lte"] as const },
 *   timestamp: { column: "event_time", operators: ["gte", "lte"] as const, inputType: "date" },
 * }
 */
export interface ModelFilterDef<
  TModel,
  TKey extends keyof TModel = keyof TModel,
> {
  /** Column name - must be a key of the table's model type */
  column: TKey;
  /** Allowed filter operators for this column */
  operators: readonly FilterOperator[];
  /** Optional transform applied to filter values */
  transform?: (value: TModel[TKey]) => SqlValue;
  /**
   * Optional input type hint for UI rendering.
   * If not specified, will be inferred from the column's ClickHouse data type.
   */
  inputType?: FilterInputTypeHint;
}

// =============================================================================
// Type Inference Helpers
// =============================================================================

/**
 * Extract string keys from a record type.
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
 *
 * Maps filter operators to their required value types:
 * - Scalar operators (eq, ne, gt, etc.): single value
 * - List operators (in, notIn): array of values
 * - Range operators (between): tuple [low, high]
 * - Null operators (isNull, isNotNull): boolean flag
 *
 * @template Op - Filter operator
 * @template TValue - Base value type
 */
export type OperatorValueType<Op extends FilterOperator, TValue = SqlValue> =
  Op extends "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" ?
    TValue
  : Op extends "in" | "notIn" ? TValue[]
  : Op extends "between" ? [TValue, TValue]
  : Op extends "isNull" | "isNotNull" ? boolean
  : never;

// =============================================================================
// Query Request Types
// =============================================================================

/** Base constraint for filter definitions */
export type FilterDefBase = { operators: readonly FilterOperator[] };

/**
 * Filter parameters structure derived from filter definitions.
 *
 * @template TFilters - Record of filter definitions
 * @template TTable - Table model type for column type lookups
 */
export type FilterParams<
  TFilters extends Record<string, FilterDefBase>,
  TTable = any,
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

/**
 * User-facing query request specification.
 *
 * Users specify dimensions and metrics - semantic concepts, not SQL concepts.
 * The query model handles the translation to actual SQL.
 *
 * @template TMetrics - Union type of metric field names
 * @template TDimensions - Union type of dimension field names
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 * @template TTable - Table model type for filter value inference
 *
 * @example
 * const request: QueryRequest = {
 *   dimensions: ["status", "day"],
 *   metrics: ["totalEvents", "totalAmount"],
 *   filters: { status: { eq: "active" } },
 *   orderBy: [["totalAmount", "DESC"]],
 *   limit: 10,
 * };
 */
export type QueryRequest<
  TMetrics extends string = string,
  TDimensions extends string = string,
  TFilters extends Record<string, FilterDefBase> = Record<
    string,
    FilterDefBase
  >,
  TSortable extends string = string,
  TTable = any,
> = {
  /** Filter conditions keyed by filter name */
  filters?: FilterParams<TFilters, TTable>;

  /** Dimensions to include in query */
  dimensions?: TDimensions[];

  /** Metrics to include in query */
  metrics?: TMetrics[];

  /**
   * Multi-column sort specification.
   */
  orderBy?: Array<[TSortable, SortDir]>;
  /** Maximum number of rows to return */
  limit?: number;
  /** Page number (0-indexed, used with limit for pagination) */
  page?: number;
  /** Row offset (alternative to page) */
  offset?: number;
};

/**
 * Individual SQL clauses for custom query assembly.
 *
 * Use this when you need full control over SQL structure (e.g., custom SELECT ordering,
 * CTEs, unions, or other advanced patterns).
 *
 * @example
 * const parts = model.toParts(request);
 * const customQuery = sql`
 *   SELECT ${parts.dimensions}, ${parts.metrics}
 *   ${parts.from}
 *   ${parts.where}
 *   ${parts.groupBy}
 *   ORDER BY custom_column DESC
 * `;
 */
export interface QueryParts {
  /** Full SELECT clause (dimensions + metrics combined) */
  select: Sql;
  /** Just dimension fields (for custom SELECT) */
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
