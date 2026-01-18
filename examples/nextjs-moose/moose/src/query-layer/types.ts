/**
 * Core type definitions for the query layer.
 * These are fundamental types used throughout the query building system.
 */

import type { SqlValue, ColRef } from "./utils";

/**
 * Supported filter operators for building WHERE conditions.
 * Each operator has specific value type requirements:
 * - Scalar operators (eq, ne, gt, etc.): single value
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

/**
 * Sort direction for ORDER BY clauses.
 */
export type SortDir = "ASC" | "DESC";

// Re-export commonly used types
export type { SqlValue, ColRef };
