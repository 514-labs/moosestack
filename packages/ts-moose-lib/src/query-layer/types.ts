/**
 * Query Layer Types
 *
 * Consolidated type definitions for the query layer.
 *
 * @module query-layer/types
 */

import type { Column } from "../dataModels/dataModelTypes";
import type { Sql } from "../sqlHelpers";
import type { OlapTable, MaterializedView } from "../dmv2";

// --- Basic Types ---

export type { Column };

/** Valid SQL values that can be parameterized */
export type SqlValue = string | number | boolean | Date;

/**
 * Column reference — a Column object from OlapTable.columns.* or a raw Sql expression.
 *
 * @example
 * const col = Events.columns.amount;   // Column
 * const expr = sql`CASE WHEN ... END`; // Sql
 */
export type ColRef = Column | Sql;

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

// --- Field Definitions ---

/**
 * Dimension definition — a column or expression used for grouping.
 *
 * @template TModel - The table's model type
 * @template TKey - The column key (must be a key of TModel)
 *
 * @example
 * dimensions: {
 *   status: { column: "status" },
 *   day: { expression: sql`toDate(timestamp)`, as: "day" },
 * }
 */
export interface DimensionDef<
  TModel = any,
  TKey extends keyof TModel = keyof TModel,
> {
  column?: TKey;
  expression?: Sql;
  as?: string;
  description?: string;
}

/**
 * Metric definition — an aggregate or computed value.
 *
 * @example
 * metrics: {
 *   totalAmount: { agg: sql`sum(amount)` },
 *   totalEvents: { agg: sql`count(*)` },
 *   revenue: { agg: sql`sum(amount)`, as: "total_revenue" },
 * }
 */
export interface MetricDef {
  agg: Sql;
  as?: string;
  description?: string;
}

/**
 * Column definition for detail (non-aggregated) queries.
 *
 * @template TModel - The table's model type
 * @template TKey - The column key (must be a key of TModel)
 *
 * @example
 * columns: {
 *   visitId: { column: "id" },
 *   firstName: { join: "user", column: "first_name" },
 * }
 */
export interface ColumnDef<
  TModel = any,
  TKey extends keyof TModel = keyof TModel,
> {
  column: TKey | string;
  join?: string;
  as?: string;
}

/**
 * Join definition for lookup JOINs.
 *
 * @example
 * joins: {
 *   user: {
 *     table: UsersTable,
 *     leftKey: "user_id",
 *     rightKey: "id",
 *     type: "LEFT",
 *   },
 * }
 */
export interface JoinDef {
  table: OlapTable<any> | MaterializedView<any>;
  on?: Sql;
  leftKey?: string;
  rightKey?: string;
  type?: "LEFT" | "INNER";
}

// --- Filter Definitions ---

/** Input type hint for filter UI rendering */
export type FilterInputTypeHint =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multiselect";

/**
 * Filter definition for use in defineQueryModel configuration.
 *
 * @template TModel - The table's model type
 * @template TKey - The column key (must be a key of TModel)
 *
 * @example
 * filters: {
 *   status: { column: "status", operators: ["eq", "in"] as const },
 *   amount: { column: "amount", operators: ["gte", "lte"] as const },
 * }
 */
export interface ModelFilterDef<
  TModel,
  TKey extends keyof TModel = keyof TModel,
> {
  column?: TKey;
  /** Metric name — filters referencing a metric are auto-routed to HAVING */
  metric?: string;
  operators: readonly FilterOperator[];
  transform?: (value: TModel[TKey]) => SqlValue;
  inputType?: FilterInputTypeHint;
  /** When true, this filter's `eq` param is required in MCP tool schemas */
  required?: true;
  description?: string;
}

// --- Type Inference Helpers ---

/** Extract string keys from a record type */
export type Names<T> = Extract<keyof T, string>;

/**
 * Infer the value type for a given operator and base value type.
 *
 * Maps filter operators to their required value types:
 * - Scalar operators: single value
 * - List operators (in, notIn): array of values
 * - Range operators (between): tuple [low, high]
 * - Null operators (isNull, isNotNull): boolean flag
 */
export type OperatorValueType<Op extends FilterOperator, TValue = SqlValue> =
  Op extends "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" ?
    TValue
  : Op extends "in" | "notIn" ? TValue[]
  : Op extends "between" ? [TValue, TValue]
  : Op extends "isNull" | "isNotNull" ? boolean
  : never;

// --- Query Request Types ---

/** Base constraint for filter definitions */
export type FilterDefBase = { operators: readonly FilterOperator[] };

/** Filter parameters structure derived from filter definitions */
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
 * Users specify dimensions and metrics — semantic concepts, not SQL concepts.
 * The query model handles the translation to actual SQL.
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
  TColumns extends string = string,
  TTable = any,
> = {
  filters?: FilterParams<TFilters, TTable>;
  dimensions?: TDimensions[];
  metrics?: TMetrics[];
  /** Columns for detail mode (no aggregation). Mutually exclusive with dimensions/metrics. */
  columns?: TColumns[];
  orderBy?: Array<[TSortable, SortDir]>;
  limit?: number;
  /** Page number (0-indexed). Mutually exclusive with offset. */
  page?: number;
  /** Row offset. Mutually exclusive with page. */
  offset?: number;
};

/** Individual SQL clauses for custom query assembly */
export interface QueryParts {
  select: Sql;
  dimensions: Sql;
  metrics: Sql;
  columns: Sql;
  from: Sql;
  conditions: Sql[];
  where: Sql;
  groupBy: Sql;
  having: Sql;
  orderBy: Sql;
  /** Composed LIMIT + OFFSET clause */
  pagination: Sql;
}
