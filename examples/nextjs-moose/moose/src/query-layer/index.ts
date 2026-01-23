/**
 * Query Layer - Type-safe SQL query building for Moose + ClickHouse
 *
 * This module provides a semantic layer for building type-safe SQL queries
 * that accelerates dashboard development on top of ClickHouse OLAP databases.
 *
 * ## Quick Start
 *
 * 1. Define a QueryModel in your Moose project:
 * ```typescript
 * import { defineQueryModel } from "./query-layer";
 *
 * export const statsModel = defineQueryModel({
 *   table: Events,
 *   dimensions: { status: { column: "status" } },
 *   metrics: { totalEvents: { agg: sql`count(*)`, as: "total_events" } },
 *   filters: { status: { column: "status", operators: ["eq", "in"] as const } },
 *   sortable: ["total_events"] as const,
 * });
 * ```
 *
 * 2. Query using the model:
 * ```typescript
 * const { client } = await getMooseClients();
 * const results = await statsModel.query(
 *   { dimensions: ["status"], metrics: ["totalEvents"] },
 *   client.query
 * );
 * ```
 *
 * @module query-layer
 */

// =============================================================================
// Primary API
// =============================================================================

export {
  defineQueryModel,
  type QueryModel,
  type QueryModelConfig,
} from "./query-model";

// =============================================================================
// Types
// =============================================================================

export type {
  // Request types
  QueryRequest,
  QueryParts,
  FilterParams,

  // Field definitions
  DimensionDef,
  MetricDef,
  ModelFilterDef,

  // Filter types
  FilterOperator,
  FilterInputTypeHint,
  FilterDefBase,

  // Basic types
  SortDir,
  SqlValue,
  ColRef,

  // Type helpers
  Names,
  OperatorValueType,
} from "./types";

export { deriveInputTypeFromDataType } from "./utils";

// =============================================================================
// Fluent Query Builder (Optional)
// =============================================================================

export { buildQuery, type QueryBuilder } from "./query-builder";

// =============================================================================
// SQL Utilities (Advanced)
// =============================================================================

export {
  // Core utilities
  raw,
  empty,
  join,
  isEmpty,

  // Filter function
  filter,
  type FilterOp,

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

  // Validation utilities
  BadRequestError,
  assertValid,
  createQueryHandler,
  type ValidationError,
  type QueryHandler,
} from "./sql-utils";
