import {
  type MooseUtils,
  type RowPolicyOptions,
  type Sql,
  toQuery,
} from "@514labs/moose-lib";

type ScopedQueryClient = MooseUtils["client"]["query"];
type ReadonlyQueryOptions = {
  limit?: number;
  rowPolicyOptions?: RowPolicyOptions;
};

export function formatClickHouseDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeReadonlyQueryOptions(
  limitOrOptions?: number | ReadonlyQueryOptions,
): ReadonlyQueryOptions {
  if (typeof limitOrOptions === "number") {
    return { limit: limitOrOptions };
  }

  return limitOrOptions ?? {};
}

async function executeReadonlyQuery<T>(
  queryClient: ScopedQueryClient,
  query: string,
  queryParams: Record<string, unknown>,
  options: ReadonlyQueryOptions,
): Promise<T[]> {
  const { limit, rowPolicyOptions } = options;
  const result = await queryClient.client.query({
    query,
    query_params: Object.fromEntries(
      Object.entries(queryParams).map(([key, value]) => [
        key,
        value instanceof Date ? formatClickHouseDateTime(value) : value,
      ]),
    ),
    format: "JSONEachRow",
    clickhouse_settings: {
      ...rowPolicyOptions?.clickhouse_settings,
      ...(typeof limit === "number" ?
        {
          max_result_rows: limit.toString(),
          result_overflow_mode: "break",
        }
      : {}),
      readonly: "2",
    },
    ...(rowPolicyOptions && {
      role: rowPolicyOptions.role,
    }),
  });

  const data = await result.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function executeReadonlySql<T>(
  queryClient: ScopedQueryClient,
  sql: Sql,
  limitOrOptions?: number | ReadonlyQueryOptions,
): Promise<T[]> {
  const [query, queryParams] = toQuery(sql);
  return await executeReadonlyQuery<T>(
    queryClient,
    query,
    queryParams,
    normalizeReadonlyQueryOptions(limitOrOptions),
  );
}

export async function executeReadonlyStatement<T>(
  queryClient: ScopedQueryClient,
  query: string,
  limitOrOptions?: number | ReadonlyQueryOptions,
): Promise<T[]> {
  return await executeReadonlyQuery<T>(
    queryClient,
    query,
    {},
    normalizeReadonlyQueryOptions(limitOrOptions),
  );
}

export async function executeScopedSql<T>(
  queryClient: ScopedQueryClient,
  sql: Sql,
): Promise<T[]> {
  const internalQueryClient = queryClient as unknown as {
    client: {
      query: (params: {
        query: string;
        query_params: Record<string, unknown>;
        format: "JSONEachRow";
        clickhouse_settings: Record<string, string | number>;
        role?: string;
      }) => Promise<{
        json: () => Promise<unknown>;
      }>;
    };
    rowPolicyOptions?: RowPolicyOptions;
  };
  const [query, queryParams] = toQuery(sql);
  const result = await internalQueryClient.client.query({
    query,
    query_params: queryParams,
    format: "JSONEachRow",
    clickhouse_settings: {
      asterisk_include_materialized_columns: 1,
      asterisk_include_alias_columns: 1,
      ...internalQueryClient.rowPolicyOptions?.clickhouse_settings,
      readonly: "2",
    },
    ...(internalQueryClient.rowPolicyOptions && {
      role: internalQueryClient.rowPolicyOptions.role,
    }),
  });
  const data = await result.json();
  return Array.isArray(data) ? (data as T[]) : [];
}
