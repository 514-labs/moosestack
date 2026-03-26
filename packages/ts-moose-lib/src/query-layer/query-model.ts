/**
 * Query Model — Core query building interface and implementation.
 *
 * @module query-layer/query-model
 */

import type { Column } from "../dataModels/dataModelTypes";
import { sql, Sql, quoteIdentifier } from "../sqlHelpers";
import { OlapTable, MaterializedView } from "../dmv2";
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
  having as havingClause,
  identifier,
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

// Widen filterSql for dynamic operator dispatch (runtime iteration over ops).
const applyFilter = filterSql as (
  col: ColRef,
  op: FilterOperator,
  value: unknown,
) => Sql;

const identity = (v: SqlValue): SqlValue => v;

function resolveTable<T>(
  tableOrMv: OlapTable<T> | MaterializedView<T>,
): OlapTable<T> {
  return tableOrMv instanceof MaterializedView ?
      tableOrMv.targetTable
    : tableOrMv;
}

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
  isHaving?: boolean;
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
  TTable = unknown,
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
  /** The OlapTable or MaterializedView to query. If a MaterializedView is passed, its targetTable is used. */
  table: OlapTable<TTable> | MaterializedView<TTable>;

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
  TDimensions extends Record<string, DimensionDef>,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
  TResult,
  TColumns extends Record<string, ColumnDef> = Record<string, never>,
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
  query(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
    client: QueryClient,
  ): Promise<TResult[]>;

  /** Build complete SQL query from request. */
  toSql(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
  ): Sql;

  /** Get individual SQL parts for custom assembly. */
  toParts(
    request: QueryRequest<
      Names<TMetrics>,
      Names<TDimensions>,
      TFilters,
      TSortable,
      Names<TColumns>,
      TTable
    >,
  ): QueryParts;
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
  type Req = QueryRequest<
    Names<TMetrics>,
    Names<TDimensions>,
    TFilters,
    TSortable,
    Names<TColumns>,
    TTable
  >;

  const {
    table: tableOrMv,
    dimensions,
    metrics,
    columns: columnDefs,
    joins: joinDefs,
    filters,
    sortable,
    defaults = {},
  } = config;
  const table = resolveTable(tableOrMv);
  const { maxLimit = 1000 } = defaults;

  const primaryTableName = table.name;
  const hasJoins = joinDefs != null && Object.keys(joinDefs).length > 0;

  // --- Normalize dimensions ---

  const normalizedDimensions: Record<string, FieldDef> = {};
  if (dimensions) {
    for (const [name, def] of Object.entries(dimensions)) {
      const column =
        def.column ?
          hasJoins ? undefined
          : table.columns[def.column]
        : undefined;
      const expression =
        def.expression ??
        (def.column && hasJoins ?
          raw(
            `${quoteIdentifier(primaryTableName)}.${quoteIdentifier(String(def.column))}`,
          )
        : undefined);
      normalizedDimensions[name] = { column, expression, as: def.as };
    }
  }

  // --- Normalize metrics ---

  const normalizedMetrics: Record<string, FieldDef> = {};
  if (metrics) {
    for (const [name, def] of Object.entries(metrics)) {
      normalizedMetrics[name] = { agg: def.agg, as: def.as };
    }
  }

  // --- Normalize columns (detail queries) ---

  const normalizedColumns: Record<string, FieldDef> = {};
  if (columnDefs) {
    for (const [name, def] of Object.entries(columnDefs)) {
      if (def.join && joinDefs) {
        const joinDef = joinDefs[def.join];
        if (!joinDef) {
          throw new Error(
            `Column '${name}' references unknown join '${def.join}'`,
          );
        }
        const joinTableName = resolveTable(joinDef.table).name;
        normalizedColumns[name] = {
          expression: raw(
            `${quoteIdentifier(joinTableName)}.${quoteIdentifier(String(def.column))}`,
          ),
          as: def.as,
        };
      } else if (hasJoins) {
        normalizedColumns[name] = {
          expression: raw(
            `${quoteIdentifier(primaryTableName)}.${quoteIdentifier(String(def.column))}`,
          ),
          as: def.as,
        };
      } else {
        normalizedColumns[name] = {
          column: table.columns[def.column as keyof TTable],
          as: def.as,
        };
      }
    }
  }

  // --- Resolve filters ---

  const resolvedFilters: Record<
    string,
    FilterDef & { inputType?: FilterInputTypeHint }
  > = {};
  const filtersWithInputType: Record<
    string,
    ModelFilterDef<TTable, keyof TTable> & { inputType?: FilterInputTypeHint }
  > = {};
  for (const [name, def] of Object.entries(filters)) {
    if (def.metric) {
      // HAVING filter — references a metric by name
      const metricDef = normalizedMetrics[def.metric];
      if (!metricDef) {
        throw new Error(
          `Filter '${name}' references unknown metric '${def.metric}'`,
        );
      }
      const alias = metricDef.as ?? def.metric;
      const inputType = def.inputType ?? "number";

      resolvedFilters[name] = {
        column: identifier(alias),
        operators: def.operators,
        transform: def.transform as ((value: SqlValue) => SqlValue) | undefined,
        inputType,
        isHaving: true,
      };

      filtersWithInputType[name] = { ...def, inputType };
    } else if (def.column != null) {
      // WHERE filter — references a table column
      const columnRef: Column = table.columns[def.column];
      if (!columnRef) {
        throw new Error(
          `Filter '${name}' references unknown column '${String(def.column)}' on table '${primaryTableName}'`,
        );
      }

      const inputType =
        def.inputType ??
        (columnRef.data_type ?
          deriveInputTypeFromDataType(columnRef.data_type)
        : undefined);

      const resolvedColumn: ColRef =
        hasJoins ?
          raw(
            `${quoteIdentifier(primaryTableName)}.${quoteIdentifier(String(def.column))}`,
          )
        : columnRef;

      resolvedFilters[name] = {
        column: resolvedColumn,
        operators: def.operators,
        transform: def.transform as ((value: SqlValue) => SqlValue) | undefined,
        inputType,
      };

      filtersWithInputType[name] = { ...def, inputType };
    } else {
      throw new Error(
        `Filter '${name}' must specify either 'column' or 'metric'`,
      );
    }
  }

  // --- Combined field map ---

  const normalizedFields: Record<string, FieldDef> = {
    ...normalizedDimensions,
    ...normalizedMetrics,
    ...normalizedColumns,
  };

  const dimensionNamesSet = new Set(Object.keys(normalizedDimensions));
  const metricNamesSet = new Set(Object.keys(normalizedMetrics));
  const columnNamesSet = new Set(Object.keys(normalizedColumns));

  const dimensionNames: readonly string[] = Object.keys(normalizedDimensions);
  const metricNames: readonly string[] = Object.keys(normalizedMetrics);
  const columnNames: readonly string[] = Object.keys(normalizedColumns);

  // --- SQL building helpers ---

  function buildFieldExpr(field: FieldDef, defaultAlias: string): Sql {
    const expr =
      field.agg ??
      field.expression ??
      (field.column ? sql`${field.column}` : empty);
    if (!expr || isEmpty(expr)) return empty;
    const alias = field.as ?? defaultAlias;
    return sql`${expr} AS ${identifier(String(alias))}`;
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
      .filter((s) => !isEmpty(s));
  }

  function buildSelectClause(selectFields?: string[]): Sql {
    const parts = buildFieldList(normalizedFields, selectFields);
    return sql`SELECT ${join(parts)}`;
  }

  function buildFilterConditions(
    filterParams?: FilterParams<TFilters, TTable>,
  ): { where: Sql[]; having: Sql[] } {
    if (!filterParams) return { where: [], having: [] };

    const whereConds: Sql[] = [];
    const havingConds: Sql[] = [];
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

        const t = filterDef.transform ?? identity;
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
        if (!isEmpty(condition)) {
          if (filterDef.isHaving) {
            havingConds.push(condition);
          } else {
            whereConds.push(condition);
          }
        }
      }
    }
    return { where: whereConds, having: havingConds };
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
        const orderExpr = fieldDef.agg ? identifier(alias) : col;
        if (isEmpty(orderExpr)) return empty;

        return sql`${orderExpr} ${raw(dir)}`;
      })
      .filter((p) => !isEmpty(p));

    return parts.length > 0 ? sql`ORDER BY ${join(parts)}` : empty;
  }

  function buildFromClause(): Sql {
    if (!hasJoins) {
      return sql`FROM ${table}`;
    }

    let fromClause = sql`FROM ${table}`;
    for (const [, joinDef] of Object.entries(joinDefs!)) {
      const joinType = joinDef.type ?? "LEFT";
      const joinTable = resolveTable(joinDef.table);

      let onClause: Sql;
      if (joinDef.leftKey && joinDef.rightKey) {
        const joinTableName = joinTable.name;
        onClause = raw(
          `${quoteIdentifier(primaryTableName)}.${quoteIdentifier(joinDef.leftKey)} = ${quoteIdentifier(joinTableName)}.${quoteIdentifier(joinDef.rightKey)}`,
        );
      } else if (joinDef.on) {
        onClause = joinDef.on;
      } else {
        throw new Error("JoinDef must specify either leftKey/rightKey or on");
      }

      fromClause = sql`${fromClause} ${raw(joinType)} JOIN ${joinTable} ON ${onClause}`;
    }
    return fromClause;
  }

  function resolveQuerySpec(
    request: Req,
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
        select: request.columns,
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
      if (field.expression) return field.expression;
      if (field.column) return sql`${field.column}`;
      return raw(fieldName);
    });

    return groupByClause(...groupExprs);
  }

  function toParts(request: Req): QueryParts {
    const spec = resolveQuerySpec(request);

    if (spec.offset != null && spec.page != null) {
      throw new Error(
        "Cannot specify both 'offset' and 'page' — they are mutually exclusive",
      );
    }

    const limitVal = Math.min(spec.limit ?? defaults.limit ?? 100, maxLimit);
    const offsetVal = spec.offset ?? (spec.page ?? 0) * limitVal;
    const pagination =
      spec.offset != null ?
        sql`LIMIT ${limitVal} OFFSET ${offsetVal}`
      : paginate(limitVal, spec.page ?? 0);

    const selectedFields =
      spec.select ??
      (spec.detailMode ?
        Object.keys(normalizedFields)
      : [...dimensionNames, ...metricNames]);
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
    const selectClause = buildSelectClause(selectedFields);
    const filterResult = buildFilterConditions(spec.filters);
    const whereClause =
      filterResult.where.length > 0 ? where(...filterResult.where) : empty;
    const havingPart =
      filterResult.having.length > 0 ?
        havingClause(...filterResult.having)
      : empty;
    const groupByPart = spec.detailMode ? empty : buildGroupByClause(spec);
    const orderByPart = buildOrderByClause(spec, selectedFieldSet);

    return {
      select: selectClause,
      dimensions: dimensionParts.length > 0 ? join(dimensionParts) : empty,
      metrics: metricParts.length > 0 ? join(metricParts) : empty,
      columns: columnParts.length > 0 ? join(columnParts) : empty,
      from: buildFromClause(),
      conditions: filterResult.where,
      where: whereClause,
      groupBy: groupByPart,
      having: havingPart,
      orderBy: orderByPart,
      pagination,
    };
  }

  function toSql(request: Req): Sql {
    const parts = toParts(request);
    return sql`
      ${parts.select}
      ${parts.from}
      ${parts.where}
      ${parts.groupBy}
      ${parts.having}
      ${parts.orderBy}
      ${parts.pagination}
    `;
  }

  const model = {
    name: config.name,
    description: config.description,
    defaults,
    filters: filtersWithInputType as TFilters &
      Record<string, { inputType?: FilterInputTypeHint }>,
    sortable,
    dimensions,
    metrics,
    columns: columnDefs,
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
