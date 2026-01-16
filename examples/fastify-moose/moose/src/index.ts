// Note: this file defines/exports Moose resources (OlapTable, etc.) as plain TS modules
// so it can be imported directly by a runtime server without an extra build step.

// Models
export * from "./models";

// =============================================================================
// Query Examples (see each file for documentation)
// =============================================================================
// 01 - Basic Query: raw SQL with filter/where helpers
export * from "./queries/01-basic-query";
// 02 - Query Model: defineQueryModel with typed filters (not exported - internal example)
// 03 - API Mapping: defineMapper for API → QueryParams
export * from "./queries/03-api-mapping";
// 04 - Aggregations: metrics, GROUP BY, custom assembly
export * from "./queries/04-aggregations";
// 05 - Fluent Builder: paramsFor() builder pattern
export * from "./queries/05-fluent-builder";

// =============================================================================
// Layer 2: Semantic Layer (Query Models)
// =============================================================================
export {
  defineQueryModel,
  defineMapper,
  buildQuery,
  type QueryModel,
  type QueryParams,
  type QueryParts,
  type FilterDef,
  type ModelFilterDef,
  type FieldDef,
  type DimensionDef,
  type MetricDef,
  type FilterOperator,
  type SortDir,
  type InferParams,
  type InferDimensions,
  type InferMetrics,
  type InferResult,
  type InferGroupable,
  type ParamBuilder,
} from "./queryModel";

// =============================================================================
// Layer 1: SQL Utilities
// =============================================================================
export {
  // Core
  raw,
  empty,
  join,
  isEmpty,
  // Filter (primary API for conditional WHERE)
  filter,
  // Comparison operators (advanced use)
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
  // Aggregations
  count,
  countDistinct,
  sum,
  avg,
  min,
  max,
  // Select helpers
  select,
  as,
  // Query handler (Layer 1)
  createQueryHandler,
  type QueryHandler,
  // Types
  type SqlValue,
  type ColRef,
  type FilterOp,
  type Expr,
  // Validation
  BadRequestError,
  assertValid,
  type ValidationError,
} from "./utils";
