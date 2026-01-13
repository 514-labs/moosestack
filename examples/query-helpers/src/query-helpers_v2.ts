/**
 * Query Helpers v2 for MooseStack
 *
 * A three-layer architecture for building type-safe query APIs:
 * - Layer 1: Validation (Typia-based)
 * - Layer 2: Param-to-Column Mapping
 * - Layer 3: SQL Generation
 */

import {
  sql,
  Sql,
  OlapTable,
  ApiHelpers,
  quoteIdentifier,
} from "@514labs/moose-lib";
import typia, { tags } from "typia";

// ============================================
// Layer 1: Validation Types
// ============================================

/**
 * Reusable pagination params with Typia constraints.
 */
export interface PaginationParams {
  limit?: number &
    tags.Type<"int32"> &
    tags.Minimum<1> &
    tags.Maximum<1000> &
    tags.Default<50>;
  offset?: number & tags.Type<"int32"> & tags.Minimum<0> & tags.Default<0>;
}

/**
 * Reusable date range params.
 */
export interface DateRangeParams {
  startDate?: string & tags.Format<"date-time">;
  endDate?: string & tags.Format<"date-time">;
}

/**
 * Base query params combining pagination and date range.
 */
export interface BaseQueryParams extends PaginationParams {
  dateRange?: DateRangeParams;
}

/**
 * Validation result type - either success with data or failure with errors.
 */
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ValidationError[] };

/**
 * Validation error details.
 */
export interface ValidationError {
  path: string;
  expected: string;
  value: unknown;
}

/**
 * Create a validator that throws on invalid input.
 * Typia generates the actual validation code at compile time.
 *
 * @example
 * const validate = createParamValidator<MyParams>();
 * const params = validate(req.body); // throws if invalid
 */
export function createParamValidator<T>(): (input: unknown) => T {
  return typia.createAssert<T>();
}

/**
 * Create a validator that returns a result object instead of throwing.
 * Returns { ok: true, data } on success or { ok: false, errors } on failure.
 *
 * @example
 * const validate = createParamValidatorSafe<MyParams>();
 * const result = validate(req.body);
 * if (!result.ok) {
 *   return res.status(400).json({ errors: result.errors });
 * }
 * // result.data is typed as MyParams
 */
export function createParamValidatorSafe<T>(): (
  input: unknown,
) => ValidationResult<T> {
  const validate = typia.createValidate<T>();
  return (input: unknown): ValidationResult<T> => {
    const result = validate(input);
    if (result.success) {
      return { ok: true, data: result.data };
    }
    return {
      ok: false,
      errors: result.errors.map((e) => ({
        path: e.path,
        expected: e.expected,
        value: e.value,
      })),
    };
  };
}

// ============================================
// Layer 2: Param-to-Column Mapping Types
// ============================================

/**
 * Filter operators for WHERE clause generation.
 */
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull";

/**
 * Simple column mapping - maps param directly to column with optional operator.
 */
export interface ColumnMapping<TTable> {
  column: keyof TTable & string;
  operator?: FilterOperator;
}

/**
 * Transform mapping - transforms the value before using in query.
 */
export interface TransformMapping<TParam, TTable> {
  column: keyof TTable & string;
  operator?: FilterOperator;
  transform: (value: TParam) => unknown;
}

/**
 * SQL expression mapping - generates custom SQL for complex filters.
 */
export interface SqlMapping<TParam, TTable> {
  toSql: (value: TParam, table: OlapTable<TTable>) => Sql;
}

/**
 * Union of all filter mapping types.
 */
export type FilterMapping<TParam, TTable> =
  | ColumnMapping<TTable>
  | TransformMapping<TParam, TTable>
  | SqlMapping<TParam, TTable>;

/**
 * Configuration for creating a param map.
 */
export interface ParamMapConfig<TFilters, TTable> {
  /** Mapping from filter param names to column configurations */
  filters: { [K in keyof TFilters]?: FilterMapping<TFilters[K], TTable> };
  /** Default columns to SELECT when none specified */
  defaultSelect?: (keyof TTable & string)[];
  /** Default ORDER BY when none specified */
  defaultOrderBy?: OrderByColumn<TTable>[];
}

/**
 * A single WHERE condition.
 */
export interface WhereCondition<T> {
  column: keyof T & string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * A single ORDER BY column.
 */
export interface OrderByColumn<T> {
  column: keyof T & string;
  direction: "ASC" | "DESC";
}

/**
 * SELECT intent - what columns to select and optional aliases.
 */
export interface SelectIntent<T> {
  columns: (keyof T & string)[];
  aliases?: Record<string, string>;
}

/**
 * Query intent - the complete intent for a query, output of mapping layer.
 */
export interface QueryIntent<T> {
  select: SelectIntent<T>;
  where: (WhereCondition<T> | Sql)[];
  orderBy: OrderByColumn<T>[];
  pagination: { limit: number; offset: number };
}

/**
 * Type guard for SqlMapping
 */
function isSqlMapping<TParam, TTable>(
  mapping: FilterMapping<TParam, TTable>,
): mapping is SqlMapping<TParam, TTable> {
  return "toSql" in mapping;
}

/**
 * Type guard for TransformMapping
 */
function isTransformMapping<TParam, TTable>(
  mapping: FilterMapping<TParam, TTable>,
): mapping is TransformMapping<TParam, TTable> {
  return "transform" in mapping;
}

/**
 * ParamMap class - maps validated params to query intent.
 */
export class ParamMap<TFilters, TTable> {
  private table: OlapTable<TTable>;
  private config: ParamMapConfig<TFilters, TTable>;

  constructor(
    table: OlapTable<TTable>,
    config: ParamMapConfig<TFilters, TTable>,
  ) {
    this.table = table;
    this.config = config;
    this.validateColumns();
  }

  /**
   * Validate that all mapped columns exist in the table.
   */
  private validateColumns(): void {
    const tableColumns = new Set(this.table.columnArray.map((c) => c.name));

    for (const [param, mapping] of Object.entries(this.config.filters) as [
      string,
      FilterMapping<unknown, TTable>,
    ][]) {
      if (mapping && "column" in mapping && !tableColumns.has(mapping.column)) {
        throw new Error(
          `Column "${mapping.column}" (mapped from param "${param}") not found in table "${this.table.name}". ` +
            `Available columns: ${[...tableColumns].join(", ")}`,
        );
      }
    }

    // Validate defaultSelect columns
    if (this.config.defaultSelect) {
      for (const col of this.config.defaultSelect) {
        if (!tableColumns.has(col)) {
          throw new Error(
            `Default select column "${col}" not found in table "${this.table.name}"`,
          );
        }
      }
    }

    // Validate defaultOrderBy columns
    if (this.config.defaultOrderBy) {
      for (const { column } of this.config.defaultOrderBy) {
        if (!tableColumns.has(column)) {
          throw new Error(
            `Default order by column "${column}" not found in table "${this.table.name}"`,
          );
        }
      }
    }
  }

  /**
   * Convert validated params to query intent.
   */
  toIntent<
    TParams extends {
      filters?: TFilters;
      pagination?: { limit?: number; offset?: number };
      orderBy?: OrderByColumn<TTable>[];
      select?: (keyof TTable & string)[];
    },
  >(params: TParams): QueryIntent<TTable> {
    const where: (WhereCondition<TTable> | Sql)[] = [];

    // Process filters
    if (params.filters) {
      for (const [paramName, value] of Object.entries(params.filters) as [
        keyof TFilters & string,
        unknown,
      ][]) {
        if (value === undefined || value === null) {
          continue;
        }

        const mapping = this.config.filters[paramName];
        if (!mapping) {
          continue;
        }

        if (isSqlMapping(mapping)) {
          // Custom SQL expression
          const sqlFragment = mapping.toSql(value, this.table);
          where.push(sqlFragment);
        } else if (isTransformMapping(mapping)) {
          // Transform the value
          where.push({
            column: mapping.column,
            operator: mapping.operator ?? "eq",
            value: mapping.transform(value),
          });
        } else {
          // Simple column mapping
          where.push({
            column: mapping.column,
            operator: mapping.operator ?? "eq",
            value,
          });
        }
      }
    }

    // Determine columns to select
    const selectColumns: (keyof TTable & string)[] =
      params.select ??
      this.config.defaultSelect ??
      (this.table.columnArray.map((c) => c.name) as (keyof TTable & string)[]);

    // Determine order by
    const orderBy: OrderByColumn<TTable>[] =
      params.orderBy ?? this.config.defaultOrderBy ?? [];

    // Determine pagination
    const pagination = {
      limit: params.pagination?.limit ?? 50,
      offset: params.pagination?.offset ?? 0,
    };

    return {
      select: { columns: selectColumns },
      where,
      orderBy,
      pagination,
    };
  }
}

/**
 * Create a param map for mapping filter params to table columns.
 *
 * @example
 * const paramMap = createParamMap<OrderFilters, OrderRow>(OrdersTable, {
 *   filters: {
 *     orderId: { column: "order_id" },
 *     minAmount: { column: "amount", operator: "gte" },
 *   },
 *   defaultSelect: ["order_id", "amount", "status"],
 *   defaultOrderBy: [{ column: "created_at", direction: "DESC" }],
 * });
 */
export function createParamMap<TFilters, TTable>(
  table: OlapTable<TTable>,
  config: ParamMapConfig<TFilters, TTable>,
): ParamMap<TFilters, TTable> {
  return new ParamMap(table, config);
}

// ============================================
// Layer 3: SQL Generation
// ============================================

/**
 * Build SELECT clause from columns.
 */
export function toSelectSql<T>(
  _table: OlapTable<T>,
  select: SelectIntent<T>,
): Sql {
  if (select.columns.length === 0) {
    throw new Error("At least one column is required for SELECT");
  }

  const parts: Sql[] = select.columns.map((col) => {
    const colId = ApiHelpers.column(col as string);
    const alias = select.aliases?.[col as string];
    if (alias) {
      return sql`${colId} AS ${quoteIdentifier(alias)}`;
    }
    return sql`${colId}`;
  });

  return joinSqlFragments(parts, ", ");
}

/**
 * Build a single WHERE condition.
 */
function buildCondition<T>(
  _table: OlapTable<T>,
  condition: WhereCondition<T>,
): Sql {
  const colId = ApiHelpers.column(condition.column as string);

  switch (condition.operator) {
    case "eq":
      return sql`${colId} = ${condition.value}`;
    case "neq":
      return sql`${colId} != ${condition.value}`;
    case "gt":
      return sql`${colId} > ${condition.value}`;
    case "gte":
      return sql`${colId} >= ${condition.value}`;
    case "lt":
      return sql`${colId} < ${condition.value}`;
    case "lte":
      return sql`${colId} <= ${condition.value}`;
    case "in":
      if (!Array.isArray(condition.value)) {
        throw new Error("IN operator requires an array value");
      }
      // Build IN clause with parameterized values
      const inValues = condition.value.map((v) => sql`${v}`);
      return sql`${colId} IN (${joinSqlFragments(inValues, ", ")})`;
    case "notIn":
      if (!Array.isArray(condition.value)) {
        throw new Error("NOT IN operator requires an array value");
      }
      const notInValues = condition.value.map((v) => sql`${v}`);
      return sql`${colId} NOT IN (${joinSqlFragments(notInValues, ", ")})`;
    case "contains":
      return sql`${colId} ILIKE ${"%" + condition.value + "%"}`;
    case "startsWith":
      return sql`${colId} ILIKE ${condition.value + "%"}`;
    case "endsWith":
      return sql`${colId} ILIKE ${"%" + condition.value}`;
    case "isNull":
      return sql`${colId} IS NULL`;
    case "isNotNull":
      return sql`${colId} IS NOT NULL`;
    default:
      throw new Error(`Unknown operator: ${condition.operator}`);
  }
}

/**
 * Type guard to check if a where entry is a WhereCondition (not raw Sql).
 */
function isWhereCondition<T>(
  entry: WhereCondition<T> | Sql,
): entry is WhereCondition<T> {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "column" in entry &&
    "operator" in entry
  );
}

/**
 * Build WHERE clause from conditions.
 */
export function toWhereSql<T>(
  table: OlapTable<T>,
  conditions: (WhereCondition<T> | Sql)[],
): Sql {
  if (conditions.length === 0) {
    return sql`1 = 1`; // No conditions = always true
  }

  const parts: Sql[] = conditions.map((condition) => {
    if (isWhereCondition(condition)) {
      return buildCondition(table, condition);
    }
    // It's a raw Sql fragment
    return condition;
  });

  return joinSqlFragments(parts, " AND ");
}

/**
 * Build ORDER BY clause.
 */
export function toOrderBySql<T>(orderBy: OrderByColumn<T>[]): Sql {
  if (orderBy.length === 0) {
    return sql``;
  }

  const parts: Sql[] = orderBy.map(({ column, direction }) => {
    const colId = ApiHelpers.column(column as string);
    return sql`${colId} ${new Sql([direction], [])}`;
  });

  return sql`ORDER BY ${joinSqlFragments(parts, ", ")}`;
}

/**
 * Build a complete query from query intent.
 *
 * @example
 * const intent = paramMap.toIntent(validatedParams);
 * const query = toQuerySql(OrdersTable, intent);
 * const result = await client.query.execute(query);
 */
export function toQuerySql<T>(
  table: OlapTable<T>,
  intent: QueryIntent<T>,
): Sql {
  const selectClause = toSelectSql(table, intent.select);

  const whereClause =
    intent.where.length > 0 ?
      sql`WHERE ${toWhereSql(table, intent.where)}`
    : sql``;

  const orderByClause =
    intent.orderBy.length > 0 ? toOrderBySql(intent.orderBy) : sql``;

  return sql`
    SELECT ${selectClause}
    FROM ${table}
    ${whereClause}
    ${orderByClause}
    LIMIT ${intent.pagination.limit}
    OFFSET ${intent.pagination.offset}
  `;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Join multiple Sql fragments with a separator.
 */
function joinSqlFragments(fragments: Sql[], separator: string): Sql {
  if (fragments.length === 0) {
    return sql``;
  }
  if (fragments.length === 1) {
    return fragments[0];
  }

  return fragments.reduce((acc, fragment, idx) => {
    if (idx === 0) {
      return fragment;
    }
    return sql`${acc}${new Sql([separator], [])}${fragment}`;
  });
}

/**
 * Merge request params from query string and body.
 * Body takes precedence for nested objects.
 */
export function mergeRequestParams(
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return { ...query, ...body };
}
