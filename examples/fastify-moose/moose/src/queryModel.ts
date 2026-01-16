import { sql, Sql, OlapTable } from "@514labs/moose-lib";
import {
  raw,
  empty,
  join,
  and,
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
  type SqlValue,
  type ColRef,
} from "./utils";

// =============================================================================
// Layer 2: Semantic Layer Types
// =============================================================================

/** Supported filter operators */
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

/** Sort direction */
export type SortDir = "ASC" | "DESC";

/** Filter definition for a field - generic over value type TValue */
export interface FilterDef<TValue = SqlValue> {
  column: ColRef;
  operators: readonly FilterOperator[];
  /** Optional transform applied to values (e.g., wrap in %...% for LIKE) */
  transform?: (value: TValue) => SqlValue;
}

/** Extract value type from FilterDef or ModelFilterDef */
type FilterValueType<T> =
  T extends FilterDef<infer V> ? V
  : T extends ModelFilterDef<infer M, infer K> ? M[K]
  : SqlValue;

/** Field definition for select - can be a column or an aggregate/expression */
export interface FieldDef {
  /** Column reference (for simple fields) */
  column?: ColRef;
  /** SQL expression (for computed fields) */
  expression?: Sql;
  /** Aggregate function result (for metrics) */
  agg?: Sql;
  /** Output alias */
  as?: string;
  /** @deprecated Use 'as' instead */
  alias?: string;
}

// =============================================================================
// Dimensions & Metrics
// =============================================================================

/** Dimension definition - a column or expression used for grouping/filtering */
export interface DimensionDef {
  /** Column reference */
  column?: ColRef;
  /** SQL expression (for computed dimensions like toDate(timestamp)) */
  expression?: Sql;
  /** Output alias */
  as?: string;
}

/** Metric definition - an aggregate or computed value */
export interface MetricDef {
  /** Aggregate function (e.g., count(), sum(amount)) */
  agg: Sql;
  /** Output alias */
  as: string;
}

// =============================================================================
// Layer 2: Derived Types
// =============================================================================

/** Infer the value type for a given operator and base value type */
type OperatorValueType<Op extends FilterOperator, TValue = SqlValue> =
  Op extends "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" ?
    TValue
  : Op extends "in" | "notIn" ? TValue[]
  : Op extends "between" ? [TValue, TValue]
  : Op extends "isNull" | "isNotNull" ? boolean
  : never;

/**
 * Minimal filter definition for type inference (no column = no Column type leak)
 */
export interface FilterOps<TValue = SqlValue> {
  operators: readonly FilterOperator[];
  /** Phantom type marker - not used at runtime */
  readonly __valueType?: TValue;
}

/** Base constraint for filter definitions - just needs operators */
type FilterDefBase = { operators: readonly FilterOperator[] };

/**
 * Filter params structure derived from filter definitions.
 * Uses the filter's value type for type-safe filter values.
 * @example { status: { eq: "active" }, amount: { gte: 100, lte: 500 } }
 */
export type FilterParams<TFilters extends Record<string, FilterDefBase>> = {
  [K in keyof TFilters]?: {
    [Op in TFilters[K]["operators"][number]]?: OperatorValueType<
      Op,
      FilterValueType<TFilters[K]>
    >;
  };
};

/**
 * Query params - filter structure + pagination/sorting/grouping.
 */
export type QueryParams<
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TGroupable extends string = string,
> = {
  filters?: FilterParams<TFilters>;
  select?: string[];
  groupBy?: TGroupable[];
  orderBy?: Array<[TSortable, SortDir]>;
  sortBy?: TSortable;
  sortDir?: SortDir;
  limit?: number;
  page?: number;
  offset?: number;
};

// =============================================================================
// Layer 2: Query Model Configuration
// =============================================================================

export interface QueryModelConfig<
  TTable,
  TFields extends Record<string, FieldDef | ColRef>,
  TFilters extends Record<string, ModelFilterDef<TTable, keyof TTable>>,
  TSortable extends string,
  TGroupable extends string = string,
> {
  /** The OlapTable to query */
  table: OlapTable<TTable>;

  /**
   * Selectable fields - maps field names to columns or expressions.
   * For clearer semantic modeling, use `dimensions` + `metrics` instead.
   * Cannot be combined with dimensions/metrics.
   */
  fields?: TFields;

  /**
   * Dimension fields - columns used for grouping, filtering, and display.
   * All dimensions are automatically groupable (no separate `groupable` needed).
   * @example { status: Events.columns.status, day: { expression: sql`toDate(timestamp)`, as: "day" } }
   */
  dimensions?: Record<string, DimensionDef | ColRef>;

  /**
   * Metric fields - aggregate values computed over dimensions.
   * @example { totalAmount: { agg: sum(Events.columns.amount), as: "total_amount" } }
   */
  metrics?: Record<string, MetricDef>;

  /** Filterable fields with allowed operators. Column must be a key of TTable. */
  filters: TFilters;
  /** Which fields can be sorted */
  sortable: readonly TSortable[];
  /**
   * Which fields can be grouped by (only needed when using `fields`).
   * When using `dimensions`, all dimensions are automatically groupable.
   */
  groupable?: readonly TGroupable[];
  /** Default query behavior */
  defaults?: {
    orderBy?: Array<[TSortable, SortDir]>;
    groupBy?: TGroupable[];
    limit?: number;
    maxLimit?: number;
  };
}

// =============================================================================
// Layer 2: Query Parts
// =============================================================================

/** Individual SQL clauses for custom assembly */
export interface QueryParts {
  /** Full SELECT clause (dimensions + metrics) */
  select: Sql;
  /** Just dimension fields (for custom SELECT with custom metrics) */
  dimensions: Sql;
  /** Just metric fields (aggregates) */
  metrics: Sql;
  from: Sql;
  conditions: Sql[];
  where: Sql;
  groupBy: Sql;
  orderBy: Sql;
  pagination: Sql;
  limit: Sql;
  offset: Sql;
}

// =============================================================================
// Layer 2: Query Model Interface
// =============================================================================

export interface QueryModel<
  TFilters extends Record<string, { operators: readonly FilterOperator[] }>,
  TSortable extends string,
  TResult,
  TGroupable extends string = string,
  TMetric extends string = string,
> {
  /** Filter definitions (for type inference) */
  readonly filters: TFilters;
  /** Sortable fields (for type inference) */
  readonly sortable: readonly TSortable[];
  /** Dimension field names (for type inference) */
  readonly dimensions: readonly TGroupable[];
  /** Metric field names (for type inference) */
  readonly metrics: readonly TMetric[];
  /** @deprecated Use `dimensions` instead */
  readonly groupable: readonly TGroupable[];
  /** Execute query with params */
  query: (
    params: QueryParams<TFilters, TSortable, TGroupable>,
    execute: (query: Sql) => Promise<TResult[]>,
  ) => Promise<TResult[]>;
  /** Build complete SQL query */
  toSql: (params: QueryParams<TFilters, TSortable, TGroupable>) => Sql;
  /** Get individual SQL parts for custom assembly */
  toParts: (params: QueryParams<TFilters, TSortable, TGroupable>) => QueryParts;
  /** Build SQL with custom assembly function */
  build: (
    params: QueryParams<TFilters, TSortable, TGroupable>,
    assemble: (parts: QueryParts) => Sql,
  ) => Sql;
}

/** Infer QueryParams type from a QueryModel */
export type InferParams<T> =
  T extends QueryModel<infer F, infer S, unknown, infer G> ?
    QueryParams<F, S, G>
  : never;

/** Infer dimension field names from a QueryModel */
export type InferDimensions<T> =
  T extends QueryModel<infer _F, infer _S, unknown, infer G, infer _M> ? G
  : never;

/** Infer metric field names from a QueryModel */
export type InferMetrics<T> =
  T extends QueryModel<infer _F, infer _S, unknown, infer _G, infer M> ? M
  : never;

/**
 * Infer the result type from a QueryModel.
 * Dimensions are typed as `string | undefined` (may not be selected).
 * Metrics are typed as `number` (aggregates).
 */
export type InferResult<T> =
  T extends QueryModel<infer _F, infer _S, unknown, infer G, infer M> ?
    { [K in G]?: string } & { [K in M]: number }
  : never;

/** @deprecated Use InferDimensions instead */
export type InferGroupable<T> = InferDimensions<T>;

// =============================================================================
// Layer 2: Fluent Query Builder
// =============================================================================

/**
 * Fluent builder for constructing and executing queries.
 * The `filter()` method automatically ignores undefined/null values.
 *
 * @example
 * // Build and execute
 * const results = await paramsFor(model)
 *   .filter("amount", "gte", params.minAmount)
 *   .filter("status", "eq", params.status)
 *   .sort("amount", "DESC")
 *   .limit(10)
 *   .query(executeQuery);
 *
 * // Or just build SQL
 * const query = paramsFor(model)
 *   .filter("amount", "gte", 1000)
 *   .toSql();
 */
export interface ParamBuilder<
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
  TGroupable extends string = string,
> {
  /** Add a filter (skips if value is undefined/null) */
  filter<K extends keyof TFilters, Op extends TFilters[K]["operators"][number]>(
    filterName: K,
    op: Op,
    value: OperatorValueType<Op, FilterValueType<TFilters[K]>> | undefined,
  ): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set sort field and direction */
  sort(
    field: TSortable,
    dir?: SortDir,
  ): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set multi-column sort */
  orderBy(
    ...orders: Array<[TSortable, SortDir]>
  ): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set group by fields (for aggregate queries) */
  groupBy(
    ...fields: TGroupable[]
  ): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set limit */
  limit(n: number): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set page (0-indexed) */
  page(n: number): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set offset */
  offset(n: number): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Set fields to select */
  select(
    fields?: string[],
  ): ParamBuilder<TFilters, TSortable, TResult, TGroupable>;

  /** Build the params object */
  build(): QueryParams<TFilters, TSortable, TGroupable>;

  /** Build the SQL query */
  toSql(): Sql;

  /** Get query parts for custom assembly */
  toParts(): QueryParts;

  /** Build with custom assembly function */
  assemble(fn: (parts: QueryParts) => Sql): Sql;

  /** Execute the query */
  execute(execute: (query: Sql) => Promise<TResult[]>): Promise<TResult[]>;
}

/** Create a fluent query builder for a model */
export function buildQuery<
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
  TGroupable extends string = string,
>(
  model: QueryModel<TFilters, TSortable, TResult, TGroupable>,
): ParamBuilder<TFilters, TSortable, TResult, TGroupable> {
  const state: {
    filters: Record<string, Record<string, unknown>>;
    groupBy?: TGroupable[];
    orderBy?: Array<[TSortable, SortDir]>;
    sortBy?: TSortable;
    sortDir?: SortDir;
    limit?: number;
    page?: number;
    offset?: number;
    select?: string[];
  } = { filters: {} };

  const buildParams = (): QueryParams<TFilters, TSortable, TGroupable> =>
    ({
      filters:
        Object.keys(state.filters).length > 0 ? state.filters : undefined,
      groupBy: state.groupBy,
      orderBy: state.orderBy,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      limit: state.limit,
      page: state.page,
      offset: state.offset,
      select: state.select,
    }) as QueryParams<TFilters, TSortable, TGroupable>;

  const builder: ParamBuilder<TFilters, TSortable, TResult, TGroupable> = {
    filter(filterName, op, value) {
      if (value === undefined || value === null) return builder;
      const key = String(filterName);
      if (!state.filters[key]) state.filters[key] = {};
      state.filters[key][op] = value;
      return builder;
    },

    sort(field, dir = "DESC") {
      state.sortBy = field;
      state.sortDir = dir;
      return builder;
    },

    orderBy(...orders) {
      state.orderBy = orders;
      return builder;
    },

    groupBy(...fields) {
      state.groupBy = fields;
      return builder;
    },

    limit(n) {
      state.limit = n;
      return builder;
    },

    page(n) {
      state.page = n;
      return builder;
    },

    offset(n) {
      state.offset = n;
      return builder;
    },

    select(fields) {
      if (fields && fields.length > 0) state.select = fields;
      return builder;
    },

    build: buildParams,
    toSql: () => model.toSql(buildParams()),
    toParts: () => model.toParts(buildParams()),
    assemble: (fn) => model.build(buildParams(), fn),
    execute: (execute) => model.query(buildParams(), execute),
  };

  return builder;
}

// =============================================================================
// Layer 2: Define Query Model
// =============================================================================

/**
 * Filter definition for use in defineQueryModel.
 * Column must be a key of the table's model type.
 */
export interface ModelFilterDef<
  TModel,
  TKey extends keyof TModel = keyof TModel,
> {
  /** Column name - must be a key of the table's model */
  column: TKey;
  /** Allowed filter operators */
  operators: readonly FilterOperator[];
  /** Optional transform applied to values (e.g., wrap in %...% for LIKE) */
  transform?: (value: TModel[TKey]) => SqlValue;
}

/**
 * Define a query model with controlled field selection, filtering, and sorting.
 *
 * @example
 * const model = defineQueryModel({
 *   table: Events,
 *   fields: {
 *     id: Events.columns.event_id,
 *     amount: Events.columns.amount,
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
  TFields extends Record<string, FieldDef | ColRef>,
  TFilters extends Record<string, ModelFilterDef<TTable, keyof TTable>>,
  TSortable extends string,
  TGroupable extends string = string,
  TMetric extends string = string,
  TResult = TTable,
>(
  config: QueryModelConfig<TTable, TFields, TFilters, TSortable, TGroupable>,
): QueryModel<TFilters, TSortable, TResult, TGroupable, TMetric> {
  const {
    table,
    fields,
    dimensions,
    metrics,
    filters,
    sortable,
    defaults = {},
  } = config;
  const { maxLimit = 1000 } = defaults;

  // Derive dimension names from dimensions config
  const dimensionNames =
    dimensions ?
      (Object.keys(dimensions) as TGroupable[])
    : ((config.groupable ?? []) as TGroupable[]);

  // Derive metric names from metrics config
  const metricNames =
    metrics ? (Object.keys(metrics) as TMetric[]) : ([] as TMetric[]);

  // Resolve column names to actual column references
  const resolvedFilters: Record<string, FilterDef<any>> = {};
  for (const [name, def] of Object.entries(filters)) {
    resolvedFilters[name] = {
      column: (table.columns as Record<string, ColRef>)[def.column as string],
      operators: def.operators,
      transform: def.transform as any,
    };
  }

  // Normalize dimensions
  const normalizedDimensions: Record<string, FieldDef> = {};
  if (dimensions) {
    for (const [name, def] of Object.entries(dimensions)) {
      if (typeof def === "object" && ("column" in def || "expression" in def)) {
        normalizedDimensions[name] = def as FieldDef;
      } else {
        normalizedDimensions[name] = { column: def };
      }
    }
  }

  // Normalize metrics (already have the right shape)
  const normalizedMetrics: Record<string, FieldDef> = {};
  if (metrics) {
    for (const [name, def] of Object.entries(metrics)) {
      normalizedMetrics[name] = { agg: def.agg, as: def.as };
    }
  }

  // Combine into normalizedFields for backward compatibility
  // If using dimensions/metrics, combine them; otherwise use fields and auto-detect
  const normalizedFields: Record<string, FieldDef> = {};
  if (dimensions || metrics) {
    Object.assign(normalizedFields, normalizedDimensions, normalizedMetrics);
  } else if (fields) {
    // Auto-detect metrics (fields with `agg`) vs dimensions (fields without)
    for (const [name, def] of Object.entries(fields)) {
      if (
        typeof def === "object" &&
        ("column" in def || "agg" in def || "expression" in def)
      ) {
        const fieldDef = def as FieldDef;
        normalizedFields[name] = fieldDef;
        // Auto-categorize: if it has `agg`, it's a metric; otherwise a dimension
        if (fieldDef.agg) {
          normalizedMetrics[name] = fieldDef;
        } else {
          normalizedDimensions[name] = fieldDef;
        }
      } else {
        // Simple column reference = dimension
        normalizedFields[name] = { column: def };
        normalizedDimensions[name] = { column: def };
      }
    }
  }

  // Track which fields are dimensions vs metrics (as Sets for lookup)
  const dimensionNamesSet = new Set(Object.keys(normalizedDimensions));
  const metricNamesSet = new Set(Object.keys(normalizedMetrics));

  // Update dimension/metric name arrays if using fields API
  if (fields && !dimensions && !metrics) {
    dimensionNames.push(
      ...(Object.keys(normalizedDimensions).filter(
        (n) => !dimensionNames.includes(n as TGroupable),
      ) as TGroupable[]),
    );
    metricNames.push(
      ...(Object.keys(normalizedMetrics).filter(
        (n) => !metricNames.includes(n as TMetric),
      ) as TMetric[]),
    );
  }

  function buildFieldList(
    fieldDefs: Record<string, FieldDef>,
    selectFields?: string[],
  ): Sql[] {
    const fieldNames = selectFields ?? Object.keys(fieldDefs);
    return fieldNames
      .map((name) => {
        const field = fieldDefs[name];
        if (!field) return empty;
        const expr = field.agg ?? field.expression ?? sql`${field.column}`;
        const alias = field.as ?? field.alias ?? name;
        return sql`${expr} AS ${raw(String(alias))}`;
      })
      .filter((s) => s !== empty);
  }

  function buildSelectClause(selectFields?: string[]): Sql {
    const fieldNames = selectFields ?? Object.keys(normalizedFields);
    const parts = fieldNames.map((name) => {
      const field = normalizedFields[name];
      if (!field) return empty;
      // Priority: agg > expression > column
      const expr = field.agg ?? field.expression ?? sql`${field.column}`;
      const alias = field.as ?? field.alias ?? name;
      return sql`${expr} AS ${raw(String(alias))}`;
    });
    return sql`SELECT ${join(parts)}`;
  }

  function applyOperator(
    col: ColRef,
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

  function buildFilterConditions(filterParams?: FilterParams<TFilters>): Sql[] {
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

  function buildOrderByClause(params: QueryParams<TFilters, TSortable>): Sql {
    let orderBySpec: Array<[TSortable, SortDir]> | undefined;

    if (params.orderBy && params.orderBy.length > 0) {
      orderBySpec = params.orderBy;
    } else if (params.sortBy) {
      orderBySpec = [[params.sortBy, params.sortDir ?? "DESC"]];
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
      const col = fieldDef.expression ?? sql`${fieldDef.column}`;
      return sql`${col} ${raw(dir)}`;
    });

    return sql`ORDER BY ${join(parts)}`;
  }

  function buildGroupByClause(
    params: QueryParams<TFilters, TSortable, TGroupable>,
  ): Sql {
    const groupByFields = params.groupBy ?? defaults.groupBy;
    if (!groupByFields || groupByFields.length === 0) return empty;

    // Map field names to their actual column/expression
    const groupExprs = groupByFields.map((fieldName) => {
      const field = normalizedFields[fieldName];
      if (!field) return raw(fieldName);
      // For grouping, use the column directly (not the alias)
      if (field.column) return sql`${field.column}`;
      if (field.expression) return field.expression;
      return raw(fieldName);
    });

    return groupByClause(...groupExprs);
  }

  function toParts(
    params: QueryParams<TFilters, TSortable, TGroupable>,
  ): QueryParts {
    const limitVal = Math.min(params.limit ?? defaults.limit ?? 100, maxLimit);
    const offsetVal =
      params.page != null ? params.page * limitVal : (params.offset ?? 0);

    // Filter selected fields into dimensions vs metrics
    const selectedFields = params.select ?? Object.keys(normalizedFields);
    const selectedDimensions = selectedFields.filter((f) =>
      dimensionNamesSet.has(f),
    );
    const selectedMetrics = selectedFields.filter((f) => metricNamesSet.has(f));

    // Build separate dimension and metric clauses
    const dimensionParts = buildFieldList(
      normalizedDimensions,
      selectedDimensions.length > 0 ? selectedDimensions : undefined,
    );
    const metricParts = buildFieldList(
      normalizedMetrics,
      selectedMetrics.length > 0 ? selectedMetrics : undefined,
    );

    const selectClause = buildSelectClause(params.select);
    const conditions = buildFilterConditions(params.filters);
    const whereClause = conditions.length > 0 ? where(...conditions) : empty;
    const groupByPart = buildGroupByClause(params);
    const orderByPart = buildOrderByClause(params);

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

  function toSql(params: QueryParams<TFilters, TSortable, TGroupable>): Sql {
    const parts = toParts(params);
    return sql`
      ${parts.select}
      ${parts.from}
      ${parts.where}
      ${parts.groupBy}
      ${parts.orderBy}
      ${parts.pagination}
    `;
  }

  return {
    filters,
    sortable,
    dimensions: dimensionNames,
    metrics: metricNames,
    groupable: dimensionNames, // deprecated alias
    query: async (params, execute) => execute(toSql(params)),
    toSql,
    toParts,
    build: (params, assemble) => assemble(toParts(params)),
  };
}

// =============================================================================
// Layer 3: API → Query Params Mapping
// =============================================================================

/** Pass-through param types */
type PassThroughParam =
  | "sortBy"
  | "sortDir"
  | "groupBy"
  | "limit"
  | "page"
  | "offset"
  | "select";

/** Filter mapping with type-safe filter names */
type FilterMapping<TFilterNames extends string> =
  | [TFilterNames, string]
  | { filter: TFilterNames; op: string; transform?: (v: unknown) => unknown };

/** Defaults for the mapper */
interface MapperDefaults {
  sortBy?: string;
  sortDir?: SortDir;
  limit?: number;
}

/**
 * Define a mapper that converts API params to QueryParams.
 * Filter names are type-checked against the model's filter definitions.
 *
 * @example
 * const toQueryParams = defineMapper<GetEventsParams>()(model, {
 *   minAmount: ["amount", "gte"],
 *   maxAmount: ["amount", "lte"],
 *   status: ["status", "eq"],
 *   search: { filter: "name", op: "ilike", transform: v => `%${v}%` },
 *   sortBy: "sortBy",
 *   limit: "limit",
 * }, { sortBy: "timestamp", sortDir: "DESC", limit: 100 });
 *
 * // Usage
 * const params = toQueryParams(apiParams);
 * const results = await model.query(params, execute);
 */
export function defineMapper<TApi>() {
  return <
    TFilters extends Record<string, FilterDefBase>,
    TSortable extends string,
    TResult,
    TGroupable extends string = string,
  >(
    _model: QueryModel<TFilters, TSortable, TResult, TGroupable>,
    mappings: {
      [K in keyof TApi]?:
        | FilterMapping<Extract<keyof TFilters, string>>
        | PassThroughParam;
    },
    defaults: MapperDefaults = {},
  ): ((api: TApi) => QueryParams<TFilters, TSortable, TGroupable>) => {
    return (api: TApi): QueryParams<TFilters, TSortable, TGroupable> => {
      const apiRecord = api as Record<string, unknown>;
      const filters: Record<string, Record<string, unknown>> = {};
      const result: Record<string, unknown> = {};

      for (const [paramName, mapDef] of Object.entries(mappings)) {
        if (!mapDef) continue;
        const value = apiRecord[paramName];

        // Direct pass-through for pagination/sort params
        if (typeof mapDef === "string") {
          if (value !== undefined) result[mapDef] = value;
          continue;
        }

        // Filter mapping
        if (value === undefined) continue;

        let filterName: string;
        let op: string;
        let transform: ((v: unknown) => unknown) | undefined;

        if (Array.isArray(mapDef)) {
          [filterName, op] = mapDef;
        } else {
          const obj = mapDef as {
            filter: string;
            op: string;
            transform?: (v: unknown) => unknown;
          };
          filterName = obj.filter;
          op = obj.op;
          transform = obj.transform;
        }

        if (!filters[filterName]) filters[filterName] = {};
        filters[filterName][op] = transform ? transform(value) : value;
      }

      // Apply defaults
      if (defaults.sortBy && result.sortBy === undefined)
        result.sortBy = defaults.sortBy;
      if (defaults.sortDir && result.sortDir === undefined)
        result.sortDir = defaults.sortDir;
      if (defaults.limit && result.limit === undefined)
        result.limit = defaults.limit;

      return {
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        ...result,
      } as QueryParams<TFilters, TSortable, TGroupable>;
    };
  };
}
