/**
 * Query Model - Core query building interface and implementation.
 *
 * The QueryModel provides a type-safe way to build SQL queries with:
 * - Predefined dimensions and metrics
 * - Type-safe filtering
 * - Configurable sorting and pagination
 * - Custom SQL assembly via QueryParts
 *
 * @module query-layer/query-model
 */

import { sql, Sql, OlapTable, QueryClient } from "@514labs/moose-lib";
import {
  raw,
  empty,
  join,
  isEmpty,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inList,
  between,
  isNull,
  isNotNull,
  where,
  orderBy as orderByClause,
  groupBy as groupByClause,
  paginate,
} from "./sql-utils";
import {
  type FilterOperator,
  type SortDir,
  type SqlValue,
  type ColRef,
  type DimensionDef,
  type MetricDef,
  type ModelFilterDef,
  type FilterDefBase,
  type FilterInputTypeHint,
  type Names,
  type OperatorValueType,
  type QueryRequest,
  type QueryParts,
  type FilterParams,
  deriveInputTypeFromDataType,
} from "./types";

// =============================================================================
// Internal Types (not exported)
// =============================================================================

/**
 * Field definition for SELECT clauses (internal runtime type).
 * A field can be a simple column, a computed expression, or an aggregate.
 * @internal
 */
interface FieldDef {
  column?: ColRef<any>;
  expression?: Sql;
  agg?: Sql;
  as?: string;
  alias?: string;
}

/**
 * Runtime filter definition (internal).
 * Created from ModelFilterDef during model initialization.
 * @internal
 */
interface FilterDef<TModel, TValue = SqlValue> {
  column: ColRef<TModel>;
  operators: readonly FilterOperator[];
  transform?: (value: TValue) => SqlValue;
}

/**
 * Resolved query specification (internal).
 * Contains select/groupBy (SQL concepts) derived from QueryRequest (dimensions/metrics).
 * @internal
 */
type ResolvedQuerySpec<
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TTable = any,
> = {
  filters?: FilterParams<TFilters, TTable>;
  select?: Array<TMetrics | TDimensions>;
  groupBy?: TDimensions[];
  orderBy?: Array<[TSortable, SortDir]>;
  sortBy?: TSortable;
  sortDir?: SortDir;
  limit?: number;
  page?: number;
  offset?: number;
};

// =============================================================================
// Query Model Configuration
// =============================================================================

/**
 * Configuration for defining a query model.
 *
 * @template TTable - The table's model type (row type)
 * @template TMetrics - Record of metric definitions
 * @template TDimensions - Record of dimension definitions
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 */
export interface QueryModelConfig<
  TTable,
  TMetrics extends Record<string, MetricDef>,
  TDimensions extends Record<string, DimensionDef<TTable, keyof TTable>>,
  TFilters extends Record<string, ModelFilterDef<TTable, keyof TTable>>,
  TSortable extends string,
> {
  /** The OlapTable to query */
  table: OlapTable<TTable>;

  /**
   * Dimension fields - columns used for grouping, filtering, and display.
   *
   * @example
   * dimensions: {
   *   status: { column: "status" },
   *   day: { expression: sql`toDate(timestamp)`, as: "day" },
   * }
   */
  dimensions?: TDimensions;

  /**
   * Metric fields - aggregate values computed over dimensions.
   *
   * @example
   * metrics: {
   *   totalAmount: { agg: sum(Events.columns.amount), as: "total_amount" },
   *   totalEvents: { agg: count(), as: "total_events" },
   * }
   */
  metrics?: TMetrics;

  /**
   * Filterable fields with allowed operators.
   *
   * @example
   * filters: {
   *   status: { column: "status", operators: ["eq", "in"] as const },
   *   amount: { column: "amount", operators: ["gte", "lte"] as const },
   * }
   */
  filters: TFilters;

  /**
   * Which fields can be sorted.
   *
   * @example
   * sortable: ["timestamp", "amount", "status"] as const
   */
  sortable: readonly TSortable[];

  /** Default query behavior */
  defaults?: {
    orderBy?: Array<[TSortable, SortDir]>;
    groupBy?: string[];
    limit?: number;
    maxLimit?: number;
  };
}

// =============================================================================
// Query Model Interface
// =============================================================================

/**
 * Query model interface providing type-safe query building and execution.
 *
 * @template TTable - The table's model type
 * @template TMetrics - Record of metric definitions
 * @template TDimensions - Record of dimension definitions
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 * @template TResult - Result row type
 */
export interface QueryModel<
  TTable,
  TMetrics extends Record<string, MetricDef>,
  TDimensions extends Record<string, DimensionDef<any, any>>,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
> {
  /** Filter definitions (exposed for type inference) */
  readonly filters: TFilters;
  /** Sortable fields */
  readonly sortable: readonly TSortable[];
  /** Dimension definitions */
  readonly dimensions?: TDimensions;
  /** Metric definitions */
  readonly metrics?: TMetrics;

  /** Available dimension names (runtime access) */
  readonly dimensionNames: readonly string[];
  /** Available metric names (runtime access) */
  readonly metricNames: readonly string[];

  /**
   * Type inference helpers (similar to Drizzle's $inferSelect pattern).
   * These are type-only properties that don't exist at runtime.
   */
  readonly $inferDimensions: Names<TDimensions>;
  readonly $inferMetrics: Names<TMetrics>;
  readonly $inferFilters: FilterParams<TFilters, TTable>;
  readonly $inferRequest: QueryRequest<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    TTable
  >;
  readonly $inferResult: TResult;

  /**
   * Execute query with Moose QueryClient.
   *
   * @param request - Query request (dimensions/metrics)
   * @param client - Moose QueryClient from getMooseClients()
   * @returns Promise resolving to array of result rows
   *
   * @example
   * const { client } = await getMooseClients();
   * const results = await model.query(request, client.query);
   */
  query: (
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
    client: QueryClient,
  ) => Promise<TResult[]>;

  /**
   * Build complete SQL query from request.
   *
   * @param request - Query request (dimensions/metrics)
   * @returns Complete SQL query
   *
   * @example
   * const sql = model.toSql({ dimensions: ["status"], metrics: ["totalEvents"] });
   */
  toSql: (
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
  ) => Sql;

  /**
   * Get individual SQL parts for custom assembly.
   *
   * This is the advanced escape hatch for when you need full control
   * over the SQL structure (CTEs, unions, custom ordering, etc.).
   *
   * @param request - Query request (dimensions/metrics)
   * @returns Object containing individual SQL clauses
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
  toParts: (
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
  ) => QueryParts;
}

// =============================================================================
// defineQueryModel Implementation
// =============================================================================

/**
 * Define a query model with controlled field selection, filtering, and sorting.
 *
 * This function creates a type-safe query model that enforces:
 * - Which columns can be filtered and with which operators
 * - Which fields can be sorted
 * - Which dimensions and metrics are available
 * - Type-safe query parameters based on the model configuration
 *
 * @template TTable - The table's model type (row type)
 * @template TMetrics - Record of metric definitions
 * @template TDimensions - Record of dimension definitions
 * @template TFilters - Record of filter definitions
 * @template TSortable - Union type of sortable field names
 * @template TResult - Result row type (defaults to TTable)
 *
 * @param config - Query model configuration
 * @returns QueryModel instance with type-safe query methods
 *
 * @example
 * const model = defineQueryModel({
 *   table: Events,
 *   dimensions: {
 *     status: { column: "status" },
 *     day: { expression: sql`toDate(timestamp)`, as: "day" },
 *   },
 *   metrics: {
 *     totalEvents: { agg: count(), as: "total_events" },
 *     totalAmount: { agg: sum(Events.columns.amount), as: "total_amount" },
 *   },
 *   filters: {
 *     status: { column: "status", operators: ["eq", "in"] as const },
 *     amount: { column: "amount", operators: ["gte", "lte"] as const },
 *   },
 *   sortable: ["amount", "timestamp"] as const,
 * });
 */
export function defineQueryModel<
  TTable,
  TMetrics extends Record<string, MetricDef>,
  TDimensions extends Record<string, DimensionDef<TTable, keyof TTable>>,
  TFilters extends Record<string, ModelFilterDef<TTable, keyof TTable>>,
  TSortable extends string,
  TResult = TTable,
>(
  config: QueryModelConfig<TTable, TMetrics, TDimensions, TFilters, TSortable>,
): QueryModel<TTable, TMetrics, TDimensions, TFilters, TSortable, TResult> {
  const {
    table,
    dimensions,
    metrics,
    filters,
    sortable,
    defaults = {},
  } = config;
  const { maxLimit = 1000 } = defaults;

  // Resolve column names to actual column references and derive inputType
  const resolvedFilters: Record<
    string,
    FilterDef<TTable, any> & { inputType?: FilterInputTypeHint }
  > = {};
  for (const [name, def] of Object.entries(filters)) {
    const columnRef = table.columns[def.column] as ColRef<TTable> & {
      data_type?: unknown;
    };

    const inputType =
      def.inputType ??
      (columnRef.data_type ?
        deriveInputTypeFromDataType(columnRef.data_type)
      : undefined);

    resolvedFilters[name] = {
      column: columnRef,
      operators: def.operators,
      transform: def.transform as any,
      inputType,
    };
  }

  // Normalize dimension definitions
  const normalizeDimension = (
    name: string,
    def: DimensionDef<TTable, keyof TTable>,
  ): FieldDef => ({
    column:
      def.column ? (table.columns[def.column] as ColRef<TTable>) : undefined,
    expression: def.expression,
    as: def.as,
  });

  const normalizedDimensions: Record<string, FieldDef> = {};
  if (dimensions) {
    for (const [name, def] of Object.entries(dimensions)) {
      normalizedDimensions[name] = normalizeDimension(
        name,
        def as DimensionDef<TTable, keyof TTable>,
      );
    }
  }

  const normalizedMetrics: Record<string, FieldDef> = {};
  if (metrics) {
    for (const [name, def] of Object.entries(metrics) as [
      string,
      MetricDef,
    ][]) {
      normalizedMetrics[name] = { agg: def.agg, as: def.as };
    }
  }

  const normalizedFields: Record<string, FieldDef> = {};
  Object.assign(normalizedFields, normalizedDimensions, normalizedMetrics);

  const dimensionNamesSet = new Set(Object.keys(normalizedDimensions));
  const metricNamesSet = new Set(Object.keys(normalizedMetrics));

  const dimensionNames = Object.keys(normalizedDimensions) as readonly string[];
  const metricNames = Object.keys(normalizedMetrics) as readonly string[];

  // Build field SQL expression with alias
  const buildFieldExpr = (field: FieldDef, defaultAlias: string): Sql => {
    const expr =
      field.agg ??
      field.expression ??
      (field.column ? sql`${field.column}` : empty);
    if (!expr || isEmpty(expr)) return empty;
    const alias = field.as ?? field.alias ?? defaultAlias;
    return sql`${expr} AS ${raw(String(alias))}`;
  };

  // Build list of field SQL expressions
  function buildFieldList(
    fieldDefs: Record<string, FieldDef>,
    selectFields?: string[],
  ): Sql[] {
    const fieldNames = selectFields ?? Object.keys(fieldDefs);
    return fieldNames
      .map((name) => {
        const field = fieldDefs[name];
        if (!field) return empty;
        return buildFieldExpr(field, name);
      })
      .filter((s) => s !== empty);
  }

  // Build complete SELECT clause
  function buildSelectClause(selectFields?: string[]): Sql {
    const fieldNames = selectFields ?? Object.keys(normalizedFields);
    const parts = fieldNames
      .map((name) => {
        const field = normalizedFields[name];
        if (!field) return empty;
        return buildFieldExpr(field, name);
      })
      .filter((s) => s !== empty);
    return sql`SELECT ${join(parts)}`;
  }

  function applyOperator(
    col: ColRef<TTable>,
    op: FilterOperator,
    value: unknown,
    transform?: (v: SqlValue) => SqlValue,
  ): Sql | null {
    const t = transform ?? ((v: SqlValue) => v);
    switch (op) {
      case "eq":
        return eq(col, t(value as SqlValue));
      case "ne":
        return ne(col, t(value as SqlValue));
      case "gt":
        return gt(col, t(value as SqlValue));
      case "gte":
        return gte(col, t(value as SqlValue));
      case "lt":
        return lt(col, t(value as SqlValue));
      case "lte":
        return lte(col, t(value as SqlValue));
      case "like":
        return like(col, t(value as SqlValue) as string);
      case "ilike":
        return ilike(col, t(value as SqlValue) as string);
      case "in":
        return inList(col, (value as SqlValue[]).map(t));
      case "notIn":
        return inList(col, (value as SqlValue[]).map(t));
      case "between": {
        const [low, high] = value as [SqlValue, SqlValue];
        return between(col, t(low), t(high));
      }
      case "isNull":
        return value ? isNull(col) : null;
      case "isNotNull":
        return value ? isNotNull(col) : null;
      default:
        return null;
    }
  }

  function buildFilterConditions(
    filterParams?: FilterParams<TFilters, TTable>,
  ): Sql[] {
    if (!filterParams) return [];

    const conditions: Sql[] = [];
    for (const [filterName, ops] of Object.entries(filterParams)) {
      const filterDef = resolvedFilters[filterName];
      if (!filterDef || !ops) continue;

      for (const [op, value] of Object.entries(
        ops as Record<string, unknown>,
      )) {
        if (value === undefined) continue;
        if (!filterDef.operators.includes(op as FilterOperator)) {
          throw new Error(
            `Operator '${op}' not allowed for filter '${filterName}'`,
          );
        }
        const condition = applyOperator(
          filterDef.column,
          op as FilterOperator,
          value,
          filterDef.transform,
        );
        if (condition) conditions.push(condition);
      }
    }
    return conditions;
  }

  function buildOrderByClause(
    spec: ResolvedQuerySpec<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
  ): Sql {
    let orderBySpec: Array<[TSortable, SortDir]> | undefined;

    if (spec.orderBy && spec.orderBy.length > 0) {
      orderBySpec = spec.orderBy;
    } else if (spec.sortBy) {
      orderBySpec = [[spec.sortBy, spec.sortDir ?? "DESC"]];
    } else {
      orderBySpec = defaults.orderBy;
    }

    if (!orderBySpec || orderBySpec.length === 0) return empty;

    for (const [field] of orderBySpec) {
      if (!sortable.includes(field)) {
        throw new Error(`Field '${field}' is not sortable`);
      }
    }

    const parts = orderBySpec.map(([field, dir]) => {
      const fieldDef = normalizedFields[field];
      if (!fieldDef) return empty;
      const col =
        fieldDef.expression ??
        (fieldDef.column ? sql`${fieldDef.column}` : empty);
      if (isEmpty(col)) return empty;
      return sql`${col} ${raw(dir)}`;
    });

    return sql`ORDER BY ${join(parts)}`;
  }

  function resolveQuerySpec(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
  ): ResolvedQuerySpec<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    TTable
  > {
    const select = [...(request.dimensions ?? []), ...(request.metrics ?? [])];
    const groupBy =
      request.dimensions && request.dimensions.length > 0 ?
        request.dimensions
      : undefined;

    return {
      select: select.length > 0 ? select : undefined,
      groupBy,
      filters: request.filters,
      orderBy: request.orderBy,
      sortBy: request.sortBy,
      sortDir: request.sortDir,
      limit: request.limit,
      page: request.page,
      offset: request.offset,
    };
  }

  function buildGroupByClause(
    spec: ResolvedQuerySpec<
      keyof TMetrics & string,
      keyof TDimensions & string,
      TFilters,
      TSortable,
      TTable
    >,
  ): Sql {
    const groupByFields = spec.groupBy ?? defaults.groupBy;
    if (!groupByFields || groupByFields.length === 0) return empty;

    const groupExprs = groupByFields.map((fieldName) => {
      const field = normalizedFields[fieldName];
      if (!field) return raw(fieldName);
      if (field.column) return sql`${field.column}`;
      if (field.expression) return field.expression;
      return raw(fieldName);
    });

    return groupByClause(...groupExprs);
  }

  function toParts(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
  ): QueryParts {
    const spec = resolveQuerySpec(request);

    const limitVal = Math.min(spec.limit ?? defaults.limit ?? 100, maxLimit);
    const offsetVal =
      spec.page != null ? spec.page * limitVal : (spec.offset ?? 0);

    const selectedFields = spec.select ?? Object.keys(normalizedFields);
    const selectedDimensions = selectedFields.filter((f) =>
      dimensionNamesSet.has(f),
    );
    const selectedMetrics = selectedFields.filter((f) => metricNamesSet.has(f));

    const dimensionParts = buildFieldList(
      normalizedDimensions,
      selectedDimensions.length > 0 ? selectedDimensions : undefined,
    );
    const metricParts = buildFieldList(
      normalizedMetrics,
      selectedMetrics.length > 0 ? selectedMetrics : undefined,
    );

    const selectClause = buildSelectClause(spec.select);
    const conditions = buildFilterConditions(spec.filters);
    const whereClause = conditions.length > 0 ? where(...conditions) : empty;
    const groupByPart = buildGroupByClause(spec);
    const orderByPart = buildOrderByClause(spec);

    return {
      select: selectClause,
      dimensions: dimensionParts.length > 0 ? join(dimensionParts) : empty,
      metrics: metricParts.length > 0 ? join(metricParts) : empty,
      from: sql`FROM ${table}`,
      conditions,
      where: whereClause,
      groupBy: groupByPart,
      orderBy: orderByPart,
      pagination: paginate(limitVal, Math.floor(offsetVal / limitVal)),
      limit: sql`LIMIT ${limitVal}`,
      offset: offsetVal > 0 ? sql`OFFSET ${offsetVal}` : empty,
    };
  }

  function toSql(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      TTable
    >,
  ): Sql {
    const parts = toParts(request);
    return sql`
      ${parts.select}
      ${parts.from}
      ${parts.where}
      ${parts.groupBy}
      ${parts.orderBy}
      ${parts.pagination}
    `;
  }

  // Build filters object with auto-derived inputType for the public API
  const filtersWithInputType: Record<
    string,
    ModelFilterDef<TTable, keyof TTable> & { inputType?: FilterInputTypeHint }
  > = {};
  for (const [name, def] of Object.entries(filters)) {
    const resolved = resolvedFilters[name];
    filtersWithInputType[name] = {
      ...def,
      inputType: resolved?.inputType ?? def.inputType,
    };
  }

  const model = {
    filters: filtersWithInputType as TFilters &
      Record<string, { inputType?: FilterInputTypeHint }>,
    sortable,
    dimensions: dimensions as TDimensions | undefined,
    metrics: metrics as TMetrics | undefined,
    dimensionNames,
    metricNames,
    query: async (request, client: QueryClient) => {
      const result = await client.execute(toSql(request));
      return result.json();
    },
    toSql,
    toParts,
    // Type-only inference helpers
    $inferDimensions: undefined as never,
    $inferMetrics: undefined as never,
    $inferFilters: undefined as never,
    $inferRequest: undefined as never,
    $inferResult: undefined as never,
  } satisfies QueryModel<
    TTable,
    TMetrics,
    TDimensions,
    TFilters,
    TSortable,
    TResult
  >;

  return model;
}
