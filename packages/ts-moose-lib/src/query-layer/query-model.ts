/**
 * Query Model — Core query building interface and implementation.
 *
 * @module query-layer/query-model
 */

import { sql, Sql } from "../sqlHelpers";
import { OlapTable } from "../dmv2";
import { QueryClient } from "../consumption-apis/helpers";
import {
  raw,
  empty,
  join,
  isEmpty,
  filter as filterSql,
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
  type ColumnDef,
  type JoinDef,
  type DimensionDef,
  type MetricDef,
  type ModelFilterDef,
  type FilterDefBase,
  type FilterInputTypeHint,
  type Names,
  type QueryRequest,
  type QueryParts,
  type FilterParams,
} from "./types";
import { deriveInputTypeFromDataType } from "./helpers";

// Type-widen filter for dynamic operator dispatch within buildFilterConditions.
// The overloaded signatures on filterSql require a specific op literal, but here
// the operator is determined at runtime via iteration.
const applyFilter = filterSql as (
  col: ColRef,
  op: FilterOperator,
  value: unknown,
) => Sql;

/**
 * Apply a transform function to a filter value, respecting operator-specific
 * value shapes (scalar, list, tuple, boolean).
 * @internal
 */
function transformFilterValue(
  op: FilterOperator,
  value: unknown,
  transform: (v: SqlValue) => SqlValue,
): unknown {
  switch (op) {
    case "in":
    case "notIn":
      return (value as SqlValue[]).map(transform);
    case "between": {
      const [low, high] = value as [SqlValue, SqlValue];
      return [transform(low), transform(high)];
    }
    case "isNull":
    case "isNotNull":
      return value;
    default:
      return transform(value as SqlValue);
  }
}

// --- Internal Types ---

/**
 * Field definition for SELECT clauses (internal runtime type).
 * @internal
 */
interface FieldDef {
  column?: ColRef;
  expression?: Sql;
  agg?: Sql;
  as?: string;
}

/**
 * Runtime filter definition (internal).
 * @internal
 */
interface FilterDef<TValue = SqlValue> {
  column: ColRef;
  operators: readonly FilterOperator[];
  transform?: (value: TValue) => SqlValue;
}

/**
 * Resolved query specification (internal).
 * @internal
 */
type ResolvedQuerySpec<
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TTable = any,
  TColumns extends string = string,
> = {
  filters?: FilterParams<TFilters, TTable>;
  select?: Array<TMetrics | TDimensions | TColumns>;
  groupBy?: TDimensions[];
  orderBy?: Array<[TSortable, SortDir]>;
  limit?: number;
  page?: number;
  offset?: number;
  detailMode?: boolean;
};

// --- Query Model Configuration ---

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
  TColumns extends Record<string, ColumnDef<TTable>> = Record<string, never>,
  TJoins extends Record<string, JoinDef> = Record<string, never>,
> {
  /** Tool name used by registerModelTools (e.g. "query_visits") */
  name?: string;
  /** Tool description used by registerModelTools */
  description?: string;
  /** The OlapTable to query */
  table: OlapTable<TTable>;

  /**
   * Dimension fields — columns used for grouping, filtering, and display.
   *
   * @example
   * dimensions: {
   *   status: { column: "status" },
   *   day: { expression: sql`toDate(timestamp)`, as: "day" },
   * }
   */
  dimensions?: TDimensions;

  /**
   * Metric fields — aggregate values computed over dimensions.
   *
   * @example
   * metrics: {
   *   totalAmount: { agg: sum(Events.columns.amount), as: "total_amount" },
   *   totalEvents: { agg: count(), as: "total_events" },
   * }
   */
  metrics?: TMetrics;

  /**
   * Column fields for detail (non-aggregated) queries.
   *
   * @example
   * columns: {
   *   visitId: { column: "id" },
   *   firstName: { join: "user", column: "first_name" },
   * }
   */
  columns?: TColumns;

  /**
   * Lookup JOIN definitions.
   *
   * @example
   * joins: {
   *   user: {
   *     table: UsersTable,
   *     leftKey: "user_id",
   *     rightKey: "id",
   *     type: "LEFT",
   *   },
   * }
   */
  joins?: TJoins;

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
    dimensions?: string[];
    metrics?: string[];
    columns?: string[];
  };
}

// --- Query Model Interface ---

/**
 * Query model interface providing type-safe query building and execution.
 */
export interface QueryModel<
  TTable,
  TMetrics extends Record<string, MetricDef>,
  TDimensions extends Record<string, DimensionDef<any, any>>,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
  TColumns extends Record<string, ColumnDef<any>> = Record<string, never>,
> {
  readonly name?: string;
  readonly description?: string;
  readonly defaults: {
    orderBy?: Array<[TSortable, SortDir]>;
    groupBy?: string[];
    limit?: number;
    maxLimit?: number;
    dimensions?: string[];
    metrics?: string[];
    columns?: string[];
  };
  readonly filters: TFilters;
  readonly sortable: readonly TSortable[];
  readonly dimensions?: TDimensions;
  readonly metrics?: TMetrics;
  readonly columns?: TColumns;

  readonly dimensionNames: readonly string[];
  readonly metricNames: readonly string[];
  readonly columnNames: readonly string[];

  /** Type inference helpers (similar to Drizzle's $inferSelect pattern). */
  readonly $inferDimensions: Names<TDimensions>;
  readonly $inferMetrics: Names<TMetrics>;
  readonly $inferColumns: Names<TColumns>;
  readonly $inferFilters: FilterParams<TFilters, TTable>;
  readonly $inferRequest: QueryRequest<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    Names<TColumns>,
    TTable
  >;
  readonly $inferResult: TResult;

  /** Execute query with Moose QueryClient. */
  query: (
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
    client: QueryClient,
  ) => Promise<TResult[]>;

  /** Build complete SQL query from request. */
  toSql: (
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
  ) => Sql;

  /** Get individual SQL parts for custom assembly. */
  toParts: (
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
  ) => QueryParts;
}

// --- defineQueryModel Implementation ---

/**
 * Define a query model with controlled field selection, filtering, and sorting.
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
  TColumns extends Record<string, ColumnDef<TTable>> = Record<string, never>,
  TJoins extends Record<string, JoinDef> = Record<string, never>,
  TResult = TTable,
>(
  config: QueryModelConfig<
    TTable,
    TMetrics,
    TDimensions,
    TFilters,
    TSortable,
    TColumns,
    TJoins
  >,
): QueryModel<
  TTable,
  TMetrics,
  TDimensions,
  TFilters,
  TSortable,
  TResult,
  TColumns
> {
  const {
    table,
    dimensions,
    metrics,
    columns: columnDefs,
    joins: joinDefs,
    filters,
    sortable,
    defaults = {},
  } = config;
  const { maxLimit = 1000 } = defaults;

  const primaryTableName = table.name;
  const hasJoins = joinDefs != null && Object.keys(joinDefs).length > 0;

  // --- Resolve filters ---

  const resolvedFilters: Record<
    string,
    FilterDef<any> & { inputType?: FilterInputTypeHint }
  > = {};
  for (const [name, def] of Object.entries(filters)) {
    const columnRef = table.columns[def.column] as ColRef & {
      data_type?: unknown;
    };

    const inputType =
      def.inputType ??
      (columnRef.data_type ?
        deriveInputTypeFromDataType(columnRef.data_type)
      : undefined);

    const resolvedColumn =
      hasJoins ?
        (raw(`${primaryTableName}.${String(def.column)}`) as ColRef)
      : columnRef;

    resolvedFilters[name] = {
      column: resolvedColumn,
      operators: def.operators,
      transform: def.transform as ((value: any) => SqlValue) | undefined,
      inputType,
    };
  }

  // --- Normalize dimensions ---

  const normalizedDimensions: Record<string, FieldDef> = {};
  if (dimensions) {
    for (const [name, def] of Object.entries(dimensions)) {
      const d = def as DimensionDef<TTable, keyof TTable>;
      normalizedDimensions[name] = {
        column: d.column ? (table.columns[d.column] as ColRef) : undefined,
        expression: d.expression,
        as: d.as,
      };
    }
  }

  // --- Normalize metrics ---

  const normalizedMetrics: Record<string, FieldDef> = {};
  if (metrics) {
    for (const [name, def] of Object.entries(metrics) as [
      string,
      MetricDef,
    ][]) {
      normalizedMetrics[name] = { agg: def.agg, as: def.as };
    }
  }

  // --- Normalize columns (detail queries) ---

  const normalizedColumns: Record<string, FieldDef> = {};
  if (columnDefs) {
    for (const [name, def] of Object.entries(columnDefs) as [
      string,
      ColumnDef<TTable>,
    ][]) {
      if (def.join && joinDefs) {
        const joinDef = joinDefs[def.join];
        if (joinDef) {
          const joinTableName = joinDef.table.name;
          normalizedColumns[name] = {
            expression: raw(`${joinTableName}.${String(def.column)}`),
            as: def.as,
          };
        }
      } else if (hasJoins) {
        normalizedColumns[name] = {
          expression: raw(`${primaryTableName}.${String(def.column)}`),
          as: def.as,
        };
      } else {
        normalizedColumns[name] = {
          column: table.columns[def.column as keyof TTable] as ColRef,
          as: def.as,
        };
      }
    }
  }

  // --- Combined field map ---

  const normalizedFields: Record<string, FieldDef> = {};
  Object.assign(
    normalizedFields,
    normalizedDimensions,
    normalizedMetrics,
    normalizedColumns,
  );

  const dimensionNamesSet = new Set(Object.keys(normalizedDimensions));
  const metricNamesSet = new Set(Object.keys(normalizedMetrics));
  const columnNamesSet = new Set(Object.keys(normalizedColumns));

  const dimensionNames = Object.keys(normalizedDimensions) as readonly string[];
  const metricNames = Object.keys(normalizedMetrics) as readonly string[];
  const columnNames = Object.keys(normalizedColumns) as readonly string[];

  // --- SQL building helpers ---

  function buildFieldExpr(field: FieldDef, defaultAlias: string): Sql {
    const expr =
      field.agg ??
      field.expression ??
      (field.column ? sql`${field.column}` : empty);
    if (!expr || isEmpty(expr)) return empty;
    const alias = field.as ?? defaultAlias;
    return sql`${expr} AS ${raw(String(alias))}`;
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
        return buildFieldExpr(field, name);
      })
      .filter((s) => s !== empty);
  }

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

  function buildFilterConditions(
    filterParams?: FilterParams<TFilters, TTable>,
  ): Sql[] {
    if (!filterParams) return [];

    const conditions: Sql[] = [];
    for (const [filterName, ops] of Object.entries(filterParams)) {
      const filterDef = resolvedFilters[filterName];
      if (!filterDef) {
        throw new Error(`Unknown filter '${filterName}'`);
      }
      if (!ops) continue;

      for (const [op, value] of Object.entries(
        ops as Record<string, unknown>,
      )) {
        if (value === undefined) continue;
        if (!filterDef.operators.includes(op as FilterOperator)) {
          throw new Error(
            `Operator '${op}' not allowed for filter '${filterName}'`,
          );
        }

        const t = filterDef.transform ?? ((v: SqlValue) => v);
        const transformed = transformFilterValue(
          op as FilterOperator,
          value,
          t,
        );
        const condition = applyFilter(
          filterDef.column,
          op as FilterOperator,
          transformed,
        );
        if (!isEmpty(condition)) conditions.push(condition);
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
    selectedFieldSet?: Set<string>,
  ): Sql {
    const orderBySpec =
      spec.orderBy && spec.orderBy.length > 0 ? spec.orderBy : defaults.orderBy;

    if (!orderBySpec || orderBySpec.length === 0) return empty;

    for (const [field] of orderBySpec) {
      if (!sortable.includes(field)) {
        throw new Error(`Field '${field}' is not sortable`);
      }
    }

    const parts = orderBySpec
      .map(([field, dir]) => {
        if (dir !== "ASC" && dir !== "DESC") {
          throw new Error(`Invalid sort direction '${dir}'`);
        }

        const fieldDef = normalizedFields[field];
        if (!fieldDef) return empty;

        // Skip dimension-based ORDER BY fields that aren't in the current
        // SELECT list — ClickHouse rejects non-aggregate expressions that
        // aren't part of GROUP BY.
        if (
          selectedFieldSet &&
          dimensionNamesSet.has(field) &&
          !selectedFieldSet.has(field)
        ) {
          return empty;
        }

        const alias = fieldDef.as ?? String(field);
        const col =
          fieldDef.expression ??
          (fieldDef.column ? sql`${fieldDef.column}` : empty);

        // For aggregate metrics, ORDER BY the SELECT alias.
        const orderExpr = fieldDef.agg ? raw(alias) : col;
        if (isEmpty(orderExpr)) return empty;

        return sql`${orderExpr} ${raw(dir)}`;
      })
      .filter((p) => !isEmpty(p));

    return parts.length > 0 ? sql`ORDER BY ${join(parts)}` : empty;
  }

  function buildFromClause(): Sql {
    if (!joinDefs || Object.keys(joinDefs).length === 0) {
      return sql`FROM ${table}`;
    }

    let fromClause = sql`FROM ${table}`;
    for (const [, joinDef] of Object.entries(joinDefs)) {
      const joinType = joinDef.type ?? "LEFT";

      let onClause: Sql;
      if (joinDef.leftKey && joinDef.rightKey) {
        const joinTableName = joinDef.table.name;
        onClause = raw(
          `${primaryTableName}.${joinDef.leftKey} = ${joinTableName}.${joinDef.rightKey}`,
        );
      } else if (joinDef.on) {
        onClause = joinDef.on;
      } else {
        throw new Error("JoinDef must specify either leftKey/rightKey or on");
      }

      fromClause = sql`${fromClause} ${raw(joinType)} JOIN ${joinDef.table} ON ${onClause}`;
    }
    return fromClause;
  }

  function resolveQuerySpec(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
  ): ResolvedQuerySpec<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    TTable,
    Names<TColumns>
  > {
    if (request.columns && request.columns.length > 0) {
      return {
        select: request.columns as Array<Names<TColumns>>,
        groupBy: undefined,
        filters: request.filters,
        orderBy: request.orderBy,
        limit: request.limit,
        page: request.page,
        offset: request.offset,
        detailMode: true,
      };
    }

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
      limit: request.limit,
      page: request.page,
      offset: request.offset,
      detailMode: false,
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
      if (!dimensionNamesSet.has(fieldName)) {
        throw new Error(`Field '${fieldName}' is not a valid dimension`);
      }

      const field = normalizedFields[fieldName];
      if (!field) {
        throw new Error(`Field '${fieldName}' is not a valid dimension`);
      }
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
      Names<TColumns>,
      TTable
    >,
  ): QueryParts {
    const spec = resolveQuerySpec(request);

    const limitVal = Math.min(spec.limit ?? defaults.limit ?? 100, maxLimit);
    const offsetVal = spec.offset ?? (spec.page ?? 0) * limitVal;
    const pagination =
      spec.offset != null ?
        sql`LIMIT ${limitVal} OFFSET ${offsetVal}`
      : paginate(limitVal, spec.page ?? 0);

    const selectedFields = spec.select ?? Object.keys(normalizedFields);
    const selectedColumns = selectedFields.filter((f) => columnNamesSet.has(f));
    const selectedDimensions = selectedFields.filter((f) =>
      dimensionNamesSet.has(f),
    );
    const selectedMetrics = selectedFields.filter((f) => metricNamesSet.has(f));

    const columnParts = buildFieldList(
      normalizedColumns,
      selectedColumns.length > 0 ? selectedColumns : undefined,
    );
    const dimensionParts = buildFieldList(
      normalizedDimensions,
      selectedDimensions.length > 0 ? selectedDimensions : undefined,
    );
    const metricParts = buildFieldList(
      normalizedMetrics,
      selectedMetrics.length > 0 ? selectedMetrics : undefined,
    );

    const selectedFieldSet = new Set(selectedFields);
    const selectClause = buildSelectClause(spec.select);
    const conditions = buildFilterConditions(spec.filters);
    const whereClause = conditions.length > 0 ? where(...conditions) : empty;
    const groupByPart = spec.detailMode ? empty : buildGroupByClause(spec);
    const orderByPart = buildOrderByClause(spec, selectedFieldSet);

    return {
      select: selectClause,
      dimensions: dimensionParts.length > 0 ? join(dimensionParts) : empty,
      metrics: metricParts.length > 0 ? join(metricParts) : empty,
      columns: columnParts.length > 0 ? join(columnParts) : empty,
      from: buildFromClause(),
      conditions,
      where: whereClause,
      groupBy: groupByPart,
      orderBy: orderByPart,
      pagination,
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
      Names<TColumns>,
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

  // Build filters with auto-derived inputType for the public API
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
    name: config.name,
    description: config.description,
    defaults,
    filters: filtersWithInputType as TFilters &
      Record<string, { inputType?: FilterInputTypeHint }>,
    sortable,
    dimensions: dimensions as TDimensions | undefined,
    metrics: metrics as TMetrics | undefined,
    columns: columnDefs as TColumns | undefined,
    dimensionNames,
    metricNames,
    columnNames,
    query: async (request, client: QueryClient) => {
      const result = await client.execute(toSql(request));
      return result.json();
    },
    toSql,
    toParts,
    $inferDimensions: undefined as never,
    $inferMetrics: undefined as never,
    $inferColumns: undefined as never,
    $inferFilters: undefined as never,
    $inferRequest: undefined as never,
    $inferResult: undefined as never,
  } satisfies QueryModel<
    TTable,
    TMetrics,
    TDimensions,
    TFilters,
    TSortable,
    TResult,
    TColumns
  >;

  return model;
}
