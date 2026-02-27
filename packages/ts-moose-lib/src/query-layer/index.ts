/**
 * Query Layer — Type-safe SQL query building for Moose + ClickHouse
 *
 * @example
 * import { defineQueryModel } from "@514labs/moose-lib";
 *
 * export const statsModel = defineQueryModel({
 *   table: Events,
 *   dimensions: { status: { column: "status" } },
 *   metrics: { totalEvents: { agg: sql`count(*)`, as: "total_events" } },
 *   filters: { status: { column: "status", operators: ["eq", "in"] as const } },
 *   sortable: ["total_events"] as const,
 * });
 *
 * @module query-layer
 */

// --- Primary API ---

export {
  defineQueryModel,
  type QueryModel,
  type QueryModelConfig,
} from "./query-model";

// --- Types ---

export type {
  QueryRequest,
  QueryParts,
  FilterParams,
  ColumnDef,
  JoinDef,
  DimensionDef,
  MetricDef,
  ModelFilterDef,
  FilterOperator,
  FilterInputTypeHint,
  FilterDefBase,
  SortDir,
  SqlValue,
  ColRef,
  Column,
  Names,
  OperatorValueType,
} from "./types";

// --- Composable Helpers ---

export {
  timeDimensions,
  columnsFromTable,
  filtersFromTable,
  deriveInputTypeFromDataType,
} from "./helpers";

// --- Fluent Query Builder ---

export { buildQuery, type QueryBuilder } from "./query-builder";

// --- MCP Utilities ---

export {
  createModelTool,
  registerModelTools,
  type QueryModelBase,
  type QueryModelFilter,
  type ModelToolOptions,
  type ModelToolResult,
} from "./model-tools";

// --- SQL Utilities ---

export {
  raw,
  empty,
  join,
  isEmpty,

  // Filter function
  filter,

  // Comparison operators
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inList,
  notIn,
  between,
  isNull,
  isNotNull,

  // Logical combinators
  and,
  or,
  not,

  // SQL clauses
  where,
  orderBy,
  limit,
  offset,
  paginate,
  groupBy,
  having,

  // Aggregation functions
  count,
  countDistinct,
  sum,
  avg,
  min,
  max,

  // Select helpers
  select,
  as,
  type Expr,
} from "./sql-utils";

// --- Validation Utilities (re-exported from consumption-apis) ---

export {
  BadRequestError,
  assertValid,
  createQueryHandler,
  type ValidationError,
  type QueryHandler,
} from "../consumption-apis/validation";
