/**
 * SQL Utilities
 *
 * Low-level SQL building utilities for constructing type-safe queries.
 * These are the building blocks used by QueryModel and can also be used
 * directly for custom query construction.
 *
 * @module query-layer/sql-utils
 */

import { sql, Sql } from "../sqlHelpers";
import type { SqlValue, ColRef, FilterOperator } from "./types";

// --- Core SQL Utilities ---

/**
 * Create raw SQL (literal string, no parameterization).
 * WARNING: Only use with trusted input — SQL injection risk.
 */
export function raw(text: string): Sql {
  return new Sql([text], []);
}

/** Empty SQL fragment — useful as a no-op. */
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

// --- Filter Function ---

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
export function filter(
  col: ColRef,
  op: "between",
  value: [SqlValue, SqlValue] | undefined,
): Sql;
export function filter(
  col: ColRef,
  op: "in" | "notIn",
  value: SqlValue[] | undefined,
): Sql;
export function filter(
  col: ColRef,
  op: Exclude<
    FilterOperator,
    "between" | "in" | "notIn" | "isNull" | "isNotNull"
  >,
  value: SqlValue | undefined,
): Sql;
export function filter(col: ColRef, op: FilterOperator, value: unknown): Sql {
  if (value === undefined || value === null) return empty;

  switch (op) {
    case "eq":
      return eq(col, value as SqlValue);
    case "ne":
      return ne(col, value as SqlValue);
    case "gt":
      return gt(col, value as SqlValue);
    case "gte":
      return gte(col, value as SqlValue);
    case "lt":
      return lt(col, value as SqlValue);
    case "lte":
      return lte(col, value as SqlValue);
    case "like":
      return like(col, value as string);
    case "ilike":
      return ilike(col, value as string);
    case "in":
      return inList(col, value as SqlValue[]);
    case "notIn":
      return notIn(col, value as SqlValue[]);
    case "between": {
      const [low, high] = value as [SqlValue, SqlValue];
      return between(col, low, high);
    }
    case "isNull":
      return value ? isNull(col) : empty;
    case "isNotNull":
      return value ? isNotNull(col) : empty;
  }
}

// --- Comparison Operators ---

/** Equal: column = value */
export function eq(col: ColRef, value: SqlValue): Sql {
  return sql`${col} = ${value}`;
}

/** Not equal: column != value */
export function ne(col: ColRef, value: SqlValue): Sql {
  return sql`${col} != ${value}`;
}

/** Greater than: column > value */
export function gt(col: ColRef, value: SqlValue): Sql {
  return sql`${col} > ${value}`;
}

/** Greater than or equal: column >= value */
export function gte(col: ColRef, value: SqlValue): Sql {
  return sql`${col} >= ${value}`;
}

/** Less than: column < value */
export function lt(col: ColRef, value: SqlValue): Sql {
  return sql`${col} < ${value}`;
}

/** Less than or equal: column <= value */
export function lte(col: ColRef, value: SqlValue): Sql {
  return sql`${col} <= ${value}`;
}

/** LIKE pattern match (case-sensitive) */
export function like(col: ColRef, pattern: string): Sql {
  return sql`${col} LIKE ${pattern}`;
}

/** ILIKE pattern match (case-insensitive, ClickHouse) */
export function ilike(col: ColRef, pattern: string): Sql {
  return sql`${col} ILIKE ${pattern}`;
}

/** IN list: column IN (a, b, c) */
export function inList(col: ColRef, values: SqlValue[]): Sql {
  if (values.length === 0) return sql`1 = 0`;
  return sql`${col} IN (${join(values.map((v) => sql`${v}`))})`;
}

/** NOT IN list */
export function notIn(col: ColRef, values: SqlValue[]): Sql {
  if (values.length === 0) return sql`1 = 1`;
  return sql`${col} NOT IN (${join(values.map((v) => sql`${v}`))})`;
}

/** BETWEEN: column BETWEEN low AND high */
export function between(col: ColRef, low: SqlValue, high: SqlValue): Sql {
  return sql`${col} BETWEEN ${low} AND ${high}`;
}

/** IS NULL */
export function isNull(col: ColRef): Sql {
  return sql`${col} IS NULL`;
}

/** IS NOT NULL */
export function isNotNull(col: ColRef): Sql {
  return sql`${col} IS NOT NULL`;
}

// --- Logical Combinators ---

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

// --- SQL Clauses ---

/** Build WHERE clause — returns empty if no conditions */
export function where(...conditions: Sql[]): Sql {
  const combined = and(...conditions);
  return isEmpty(combined) ? empty : sql`WHERE ${combined}`;
}

/** Build ORDER BY clause */
export function orderBy(
  ...cols: Array<ColRef | [ColRef, "ASC" | "DESC"]>
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
export function groupBy(...cols: ColRef[]): Sql {
  if (cols.length === 0) return empty;
  return sql`GROUP BY ${join(cols.map((c) => sql`${c}`))}`;
}

/** Build HAVING clause */
export function having(...conditions: Sql[]): Sql {
  const combined = and(...conditions);
  return isEmpty(combined) ? empty : sql`HAVING ${combined}`;
}

// --- Expression with Fluent Alias ---

/** SQL expression with fluent `.as()` method */
export interface Expr extends Sql {
  as(alias: string): Sql;
}

/** Augment a Sql fragment with a fluent .as() method */
function expr(fragment: Sql): Expr {
  return Object.assign(fragment, {
    as: (alias: string) => sql`${fragment} AS ${raw(alias)}`,
  }) as Expr;
}

// --- Aggregation Functions ---

/** COUNT(*) or COUNT(column) */
export function count(col?: ColRef): Expr {
  return expr(col ? sql`count(${col})` : sql`count(*)`);
}

/** COUNT(DISTINCT column) */
export function countDistinct(col: ColRef): Expr {
  return expr(sql`count(DISTINCT ${col})`);
}

/** SUM(column) */
export function sum(col: ColRef): Expr {
  return expr(sql`sum(${col})`);
}

/** AVG(column) */
export function avg(col: ColRef): Expr {
  return expr(sql`avg(${col})`);
}

/** MIN(column) */
export function min(col: ColRef): Expr {
  return expr(sql`min(${col})`);
}

/** MAX(column) */
export function max(col: ColRef): Expr {
  return expr(sql`max(${col})`);
}

// --- Select Helpers ---

/** Build SELECT clause with columns */
export function select(...cols: Array<ColRef | [ColRef, string]>): Sql {
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
export function as(expression: Sql, alias: string): Sql {
  return sql`${expression} AS ${raw(alias)}`;
}
