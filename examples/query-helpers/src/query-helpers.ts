/**
 * Query Helpers for MooseStack
 *
 * Type-safe SQL query building utilities for MooseStack consumption APIs.
 *
 * Features:
 * - SELECT clause generation with field aliasing
 * - ORDER BY clause generation
 * - Computed columns support
 * - Type-safe field validation via Typia
 */

import {
  sql,
  Sql,
  ApiHelpers,
  OlapTable,
  quoteIdentifier,
} from "@514labs/moose-lib";

// ============================================
// Column Configuration Types
// ============================================

/**
 * Configuration for a table column in the SELECT clause.
 */
export type SelectColumnConfig = {
  /** Optional alias for the column (defaults to column name) */
  alias?: string;
};

/**
 * Column configuration for a table. Use `as const` when defining for literal type inference.
 * Keys must be valid column names from T. Aliases must not conflict with column names.
 *
 * @example
 * const columnConfig = {
 *   id: { alias: "ID" },
 *   createdAt: { alias: "Created At" },
 * } as const satisfies ColumnConfig<Row>;
 */
export type ColumnConfig<T> = {
  [K in keyof T]?: { readonly alias?: string };
};

/**
 * Helper type to extract alias string literals from config.
 */
type ExtractAliases<A> = {
  [K in keyof A]: A[K] extends { readonly alias: infer V extends string } ? V
  : never;
}[keyof A];

/**
 * Detects aliases that conflict with column names.
 * Returns the conflicting names, or `never` if no conflicts.
 */
type ConflictingAliases<T, A> = ExtractAliases<A> & keyof T;

/**
 * Valid field names for API parameters.
 * Includes all column names from T, plus non-conflicting aliases from A.
 * If any alias conflicts with a column name, this type becomes `never` (compile error).
 *
 * @example
 * // No aliases - just column names
 * type Fields = ValidFields<Row>;
 *
 * @example
 * // With aliases
 * const config = { id: { alias: "ID" } } as const;
 * type Fields = ValidFields<Row, typeof config>;
 *
 * @example
 * // Conflict - alias "id" matches column name
 * const badConfig = { createdAt: { alias: "id" } } as const; // ERROR when used
 * type Fields = ValidFields<Row, typeof badConfig>;
 */
export type ValidFields<T, A extends ColumnConfig<T> = {}> =
  ConflictingAliases<T, A> extends never ?
    (keyof T & string) | ExtractAliases<A>
  : never;

/**
 * A computed column with a SQL expression.
 */
export type ComputedColumn = {
  /** SQL expression for the computed value */
  expression: string;
  /** Alias for the result */
  alias: string;
};

// ============================================
// SELECT Helpers
// ============================================

/**
 * Builds a SELECT clause from an OlapTable and field list.
 * Type-safe: only allows fields that exist in the table's model.
 *
 * @param table - The table to select from
 * @param fields - Array of field names from the model
 * @param config - Optional aliases for fields
 * @param computed - Optional computed columns with expressions
 */
export function buildSelect<T>(
  table: OlapTable<T>,
  fields: (keyof T & string)[],
  config?: Partial<Record<keyof T & string, SelectColumnConfig>>,
  computed?: ComputedColumn[],
): Sql {
  const parts: Sql[] = [];

  // Add table fields
  for (const field of fields) {
    const colConfig = config?.[field];
    const alias = colConfig?.alias ?? field;
    const fieldId = ApiHelpers.column(field);
    parts.push(sql`${fieldId} AS "${alias}"`);
  }

  // Add computed columns
  if (computed) {
    for (const col of computed) {
      parts.push(new Sql([`${col.expression} AS "${col.alias}"`], []));
    }
  }

  if (parts.length === 0) {
    throw new Error("At least one field is required for SELECT");
  }

  return parts.reduce((acc, part, idx) =>
    idx === 0 ? part : sql`${acc}, ${part}`,
  );
}

/**
 * Maps field names (which may include aliases) to actual column names.
 * Assumes your API layer has already validated `requested` against `ValidFields<T, A>`.
 */
export function mapAliasedFields<T, A extends ColumnConfig<T>>(
  requested: ValidFields<T, A>[] | undefined,
  columnConfig: A,
  defaultFields: (keyof T & string)[],
): (keyof T & string)[] {
  if (!requested || requested.length === 0) {
    return defaultFields;
  }

  // Build reverse mapping: alias -> actual column name
  const aliasToColumn: Record<string, keyof T & string> = {};
  for (const [column, config] of Object.entries(columnConfig) as [
    keyof T & string,
    { alias?: string },
  ][]) {
    if (config?.alias) {
      aliasToColumn[config.alias] = column;
    }
  }

  // Map each field: if it's an alias, convert to column name; otherwise keep as-is
  return requested.map(
    (field) => aliasToColumn[field as string] ?? (field as keyof T & string),
  );
}

/**
 * Gets all column names from a table.
 */
export function getTableFields<T>(table: OlapTable<T>): (keyof T & string)[] {
  return table.columnArray.map((col) => col.name as keyof T & string);
}

/**
 * Options for buildSelectFromFields.
 */
export type BuildSelectOptions<T, A extends ColumnConfig<T>> = {
  /** Column config for column display names and other column metadata */
  columnConfig?: A;
  /** Computed columns to add */
  computed?: ComputedColumn[];
};

/**
 * Combined helper that maps aliased fields and builds a SELECT clause in one call.
 * Handles alias-to-column mapping internally.
 */
export function buildSelectFromFields<T, A extends ColumnConfig<T> = {}>(
  table: OlapTable<T>,
  fields: ValidFields<T, A>[],
  options: BuildSelectOptions<T, A> = {},
): Sql {
  const { columnConfig = {} as A, computed } = options;

  // Map aliases to column names
  const columnFields = mapAliasedFields<T, A>(fields, columnConfig, []);

  // Build and return SELECT clause
  return buildSelect(table, columnFields, columnConfig, computed);
}

// ============================================
// API Parameter Type Utilities
// ============================================

/**
 * Base query parameters common to table-querying APIs.
 * These are pagination and caching params that don't depend on the table schema.
 */
export type BaseQueryParams = {
  limit?: string;
  offset?: string;
};

/**
 * Ordering params. Uses string format `"[ColumnName] ASC|DESC"` (or equivalent) for compatibility.
 */
export type OrderableFields = {
  orderby?: string;
};

/**
 * Type-safe query params derived from a table model type.
 * Includes base params (limit, offset), orderby, and strict field selection.
 *
 * @param T - The table model type
 * @param A - Optional column config. Keys must be column names; aliases must not conflict with columns.
 */
export type QueryParams<T, A extends ColumnConfig<T> = {}> = BaseQueryParams &
  OrderableFields & {
    fields?: ValidFields<T, A>[];
  };

// ============================================
// ORDER BY Helper
// ============================================

export type OrderByDirection = "ASC" | "DESC";

/**
 * Type-safe order by column specification.
 * The column must be a valid field name from the table's type.
 */
export type OrderByColumn<T> = {
  column: keyof T & string;
  direction?: OrderByDirection; // defaults to ASC
};

/**
 * Build an ORDER BY clause from a table and array of columns.
 * Type-safe: only allows columns that exist in the table's model.
 *
 * @param table - The table to validate columns against
 * @param columns - Array of column specifications with optional direction
 * @param columnConfig - Optional column config (same mapping as buildSelect) to use aliased names
 */
export function buildOrderBy<T>(
  table: OlapTable<T>,
  columns: OrderByColumn<T>[],
  columnConfig?: Partial<Record<keyof T & string, SelectColumnConfig>>,
): Sql {
  if (columns.length === 0) {
    throw new Error("At least one column is required for ORDER BY");
  }

  const orderByParts = columns.map(({ column, direction = "ASC" }) => {
    const colName = columnConfig?.[column]?.alias ?? column;
    return `${quoteIdentifier(colName)} ${direction}`;
  });

  return new Sql([`ORDER BY ${orderByParts.join(", ")}`], []);
}
