/**
 * SQL Utilities
 *
 * Low-level SQL building utilities for constructing type-safe queries.
 * These are the building blocks used by QueryModel and can also be used
 * directly for custom query construction.
 *
 * @module query-layer/sql-utils
 */

import { sql, Sql } from "@514labs/moose-lib";
import type { IValidation } from "typia";
import type { SqlValue, ColRef } from "./types";

// =============================================================================
// Core SQL Utilities
// =============================================================================

/**
 * Create raw SQL (literal string, no parameterization).
 * WARNING: Only use with trusted input - SQL injection risk.
 */
export function raw(text: string): Sql {
  return new Sql([text], []);
}

/** Empty SQL fragment - useful as a no-op. */
export const empty = sql``;

/** Join SQL fragments with a separator. */
export function join(fragments: Sql[], separator: string = ","): Sql {
  if (fragments.length === 0) return empty;
  if (fragments.length === 1) return fragments[0];

  const sep = raw(separator.includes(" ") ? separator : ` ${separator} `);
  return fragments
    .slice(1)
    .reduce((acc, frag) => sql`${acc}${sep}${frag}`, fragments[0]);
}

/** Check if a Sql fragment is empty */
export function isEmpty(fragment: Sql): boolean {
  return (
    fragment.strings.every((s) => s.trim() === "") &&
    fragment.values.length === 0
  );
}

// =============================================================================
// Filter Operators
// =============================================================================

/** Supported filter operators for the filter() function */
export type FilterOp =
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
  | "between";

/**
 * Create a filter condition. Automatically skips if value is undefined/null.
 * This is the recommended way to build conditional WHERE clauses.
 *
 * @example
 * where(
 *   filter(Events.columns.amount, "gte", params.minAmount),
 *   filter(Events.columns.amount, "lte", params.maxAmount),
 *   filter(Events.columns.status, "eq", params.status),
 * )
 */
export function filter<TModel>(
  col: ColRef<TModel>,
  op: "between",
  value: [SqlValue, SqlValue] | undefined,
): Sql;
export function filter<TModel>(
  col: ColRef<TModel>,
  op: "in" | "notIn",
  value: SqlValue[] | undefined,
): Sql;
export function filter<TModel>(
  col: ColRef<TModel>,
  op: Exclude<FilterOp, "between" | "in" | "notIn">,
  value: SqlValue | undefined,
): Sql;
export function filter<TModel>(
  col: ColRef<TModel>,
  op: FilterOp,
  value: unknown,
): Sql {
  if (value === undefined || value === null) return empty;

  switch (op) {
    case "eq":
      return sql`${col} = ${value as SqlValue}`;
    case "ne":
      return sql`${col} != ${value as SqlValue}`;
    case "gt":
      return sql`${col} > ${value as SqlValue}`;
    case "gte":
      return sql`${col} >= ${value as SqlValue}`;
    case "lt":
      return sql`${col} < ${value as SqlValue}`;
    case "lte":
      return sql`${col} <= ${value as SqlValue}`;
    case "like":
      return sql`${col} LIKE ${value as string}`;
    case "ilike":
      return sql`${col} ILIKE ${value as string}`;
    case "in": {
      const arr = value as SqlValue[];
      if (arr.length === 0) return sql`1 = 0`;
      return sql`${col} IN (${join(arr.map((v) => sql`${v}`))})`;
    }
    case "notIn": {
      const arr = value as SqlValue[];
      if (arr.length === 0) return sql`1 = 1`;
      return sql`${col} NOT IN (${join(arr.map((v) => sql`${v}`))})`;
    }
    case "between": {
      const [low, high] = value as [SqlValue, SqlValue];
      return sql`${col} BETWEEN ${low} AND ${high}`;
    }
  }
}

// =============================================================================
// Comparison Operators
// =============================================================================

/** Equal: column = value */
export function eq<TModel>(col: ColRef<TModel>, value: SqlValue): Sql {
  return sql`${col} = ${value}`;
}

/** Not equal: column != value */
export function ne<TModel>(col: ColRef<TModel>, value: SqlValue): Sql {
  return sql`${col} != ${value}`;
}

/** Greater than: column > value */
export function gt<TModel>(col: ColRef<TModel>, value: SqlValue): Sql {
  return sql`${col} > ${value}`;
}

/** Greater than or equal: column >= value */
export function gte<TModel>(col: ColRef<TModel>, value: SqlValue): Sql {
  return sql`${col} >= ${value}`;
}

/** Less than: column < value */
export function lt<TModel>(col: ColRef<TModel>, value: SqlValue): Sql {
  return sql`${col} < ${value}`;
}

/** Less than or equal: column <= value */
export function lte<TModel>(col: ColRef<TModel>, value: SqlValue): Sql {
  return sql`${col} <= ${value}`;
}

/** LIKE pattern match (case-sensitive) */
export function like<TModel>(col: ColRef<TModel>, pattern: string): Sql {
  return sql`${col} LIKE ${pattern}`;
}

/** ILIKE pattern match (case-insensitive, ClickHouse) */
export function ilike<TModel>(col: ColRef<TModel>, pattern: string): Sql {
  return sql`${col} ILIKE ${pattern}`;
}

/** IN list: column IN (a, b, c) */
export function inList<TModel>(col: ColRef<TModel>, values: SqlValue[]): Sql {
  if (values.length === 0) return sql`1 = 0`;
  return sql`${col} IN (${join(values.map((v) => sql`${v}`))})`;
}

/** NOT IN list */
export function notIn<TModel>(col: ColRef<TModel>, values: SqlValue[]): Sql {
  if (values.length === 0) return sql`1 = 1`;
  return sql`${col} NOT IN (${join(values.map((v) => sql`${v}`))})`;
}

/** BETWEEN: column BETWEEN low AND high */
export function between<TModel>(
  col: ColRef<TModel>,
  low: SqlValue,
  high: SqlValue,
): Sql {
  return sql`${col} BETWEEN ${low} AND ${high}`;
}

/** IS NULL */
export function isNull<TModel>(col: ColRef<TModel>): Sql {
  return sql`${col} IS NULL`;
}

/** IS NOT NULL */
export function isNotNull<TModel>(col: ColRef<TModel>): Sql {
  return sql`${col} IS NOT NULL`;
}

// =============================================================================
// Logical Combinators
// =============================================================================

/** Combine conditions with AND, filtering out empty fragments */
export function and(...conditions: Sql[]): Sql {
  const nonEmpty = conditions.filter((c) => !isEmpty(c));
  return join(nonEmpty, "AND");
}

/** Combine conditions with OR, filtering out empty fragments */
export function or(...conditions: Sql[]): Sql {
  const nonEmpty = conditions.filter((c) => !isEmpty(c));
  if (nonEmpty.length === 0) return empty;
  if (nonEmpty.length === 1) return nonEmpty[0];
  return sql`(${join(nonEmpty, "OR")})`;
}

/** Negate a condition: NOT (condition) */
export function not(condition: Sql): Sql {
  if (isEmpty(condition)) return empty;
  return sql`NOT (${condition})`;
}

// =============================================================================
// SQL Clauses
// =============================================================================

/** Build WHERE clause - returns empty if no conditions */
export function where(...conditions: Sql[]): Sql {
  const combined = and(...conditions);
  return isEmpty(combined) ? empty : sql`WHERE ${combined}`;
}

/** Build ORDER BY clause */
export function orderBy<TModel>(
  ...cols: Array<ColRef<TModel> | [ColRef<TModel>, "ASC" | "DESC"]>
): Sql {
  if (cols.length === 0) return empty;
  const parts = cols.map((c) => {
    if (Array.isArray(c)) {
      const [col, dir] = c;
      return sql`${col} ${raw(dir)}`;
    }
    return sql`${c}`;
  });
  return sql`ORDER BY ${join(parts)}`;
}

/** Build LIMIT clause */
export function limit(n: number): Sql {
  return sql`LIMIT ${n}`;
}

/** Build OFFSET clause */
export function offset(n: number): Sql {
  return sql`OFFSET ${n}`;
}

/** Build LIMIT + OFFSET for pagination */
export function paginate(pageSize: number, page: number = 0): Sql {
  const offsetVal = page * pageSize;
  return offsetVal > 0 ?
      sql`LIMIT ${pageSize} OFFSET ${offsetVal}`
    : sql`LIMIT ${pageSize}`;
}

/** Build GROUP BY clause */
export function groupBy<TModel>(...cols: ColRef<TModel>[]): Sql {
  if (cols.length === 0) return empty;
  return sql`GROUP BY ${join(cols.map((c) => sql`${c}`))}`;
}

/** Build HAVING clause */
export function having(...conditions: Sql[]): Sql {
  const combined = and(...conditions);
  return isEmpty(combined) ? empty : sql`HAVING ${combined}`;
}

// =============================================================================
// Expression with Fluent Alias
// =============================================================================

/** SQL expression with fluent `.as()` method */
export interface Expr extends Sql {
  as(alias: string): Sql;
}

/** Wrap a Sql fragment to add fluent methods */
function expr(fragment: Sql): Expr {
  // Use composition instead of prototype delegation
  return Object.assign(Object.create(Sql.prototype), fragment, {
    as: (alias: string) => sql`${fragment} AS ${raw(alias)}`,
  }) as Expr;
}

// =============================================================================
// Aggregation Functions
// =============================================================================

/** COUNT(*) or COUNT(column) */
export function count<TModel>(col?: ColRef<TModel>): Expr {
  return expr(col ? sql`count(${col})` : sql`count(*)`);
}

/** COUNT(DISTINCT column) */
export function countDistinct<TModel>(col: ColRef<TModel>): Expr {
  return expr(sql`count(DISTINCT ${col})`);
}

/** SUM(column) */
export function sum<TModel>(col: ColRef<TModel>): Expr {
  return expr(sql`sum(${col})`);
}

/** AVG(column) */
export function avg<TModel>(col: ColRef<TModel>): Expr {
  return expr(sql`avg(${col})`);
}

/** MIN(column) */
export function min<TModel>(col: ColRef<TModel>): Expr {
  return expr(sql`min(${col})`);
}

/** MAX(column) */
export function max<TModel>(col: ColRef<TModel>): Expr {
  return expr(sql`max(${col})`);
}

// =============================================================================
// Select Helpers
// =============================================================================

/** Build SELECT clause with columns */
export function select<TModel>(
  ...cols: Array<ColRef<TModel> | [ColRef<TModel>, string]>
): Sql {
  if (cols.length === 0) return sql`SELECT *`;
  const parts = cols.map((c) => {
    if (Array.isArray(c)) {
      const [col, alias] = c;
      return sql`${col} AS ${raw(alias)}`;
    }
    return sql`${c}`;
  });
  return sql`SELECT ${join(parts)}`;
}

/** Alias a column or expression */
export function as(expr: Sql, alias: string): Sql {
  return sql`${expr} AS ${raw(alias)}`;
}

// =============================================================================
// Validation Utilities
// =============================================================================

/** Frontend-friendly validation error structure */
export interface ValidationError {
  path: string;
  message: string;
  expected: string;
  received: string;
}

/** Error thrown when validation fails */
export class BadRequestError extends Error {
  public readonly errors: ValidationError[];

  constructor(typiaErrors: IValidation.IError[]) {
    super("Validation failed");
    this.errors = typiaErrors.map((e) => ({
      path: e.path,
      message: `Expected ${e.expected}`,
      expected: e.expected,
      received: typeof e.value === "undefined" ? "undefined" : String(e.value),
    }));
  }

  toJSON() {
    return { error: this.message, details: this.errors };
  }
}

/** Assert validation result, throw BadRequestError if invalid */
export function assertValid<T>(result: IValidation<T>): T {
  if (!result.success) {
    throw new BadRequestError(result.errors);
  }
  return result.data;
}

// =============================================================================
// Query Handler
// =============================================================================

/**
 * Query handler with three entry points for queries.
 * Use this when writing raw SQL without a query model.
 */
export interface QueryHandler<P, R> {
  run: (params: P) => Promise<R>;
  fromObject: (input: unknown) => Promise<R>;
  fromUrl: (url: string | URL) => Promise<R>;
}

/**
 * Create a simple query handler with validation.
 *
 * @example
 * const handler = createQueryHandler({
 *   fromUrl: typia.http.createValidateQuery<MyParams>(),
 *   fromObject: typia.createValidate<MyParams>(),
 *   queryFn: async (params) => {
 *     const query = sql`SELECT * FROM ${Table} ${where(...)}`
 *     return executeQuery(query);
 *   },
 * });
 */
export function createQueryHandler<P, R>(config: {
  fromUrl: (input: string | URLSearchParams) => IValidation<P>;
  fromObject: (input: unknown) => IValidation<P>;
  queryFn: (params: P) => Promise<R>;
}): QueryHandler<P, R> {
  return {
    run: config.queryFn,
    fromObject: (input) =>
      config.queryFn(assertValid(config.fromObject(input))),
    fromUrl: (url) => {
      const search =
        typeof url === "string" ?
          new URL(url, "http://localhost").search
        : url.search;
      return config.queryFn(assertValid(config.fromUrl(search)));
    },
  };
}
