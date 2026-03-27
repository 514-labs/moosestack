import {
  type MooseUtils,
  type RowPolicyOptions,
  type Sql,
  toQuery,
} from "@514labs/moose-lib";

type QueryClient = MooseUtils["client"]["query"];

function formatClickHouseDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function isRowPolicyOptions(value: unknown): value is RowPolicyOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    typeof value.role === "string" &&
    "clickhouse_settings" in value &&
    typeof value.clickhouse_settings === "object" &&
    value.clickhouse_settings !== null
  );
}

function getRowPolicyOptions(
  queryClient: QueryClient,
): RowPolicyOptions | undefined {
  const rowPolicyOptions = Reflect.get(
    queryClient as object,
    "rowPolicyOptions",
  );

  return isRowPolicyOptions(rowPolicyOptions) ? rowPolicyOptions : undefined;
}

async function executeReadonlyQuery<T>(
  queryClient: QueryClient,
  query: string,
  queryParams: Record<string, unknown>,
  limit?: number,
): Promise<T[]> {
  const rowPolicyOptions = getRowPolicyOptions(queryClient);
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
      readonly: "2",
      ...(typeof limit === "number" ?
        {
          max_result_rows: limit.toString(),
          result_overflow_mode: "break",
        }
      : {}),
      ...rowPolicyOptions?.clickhouse_settings,
    },
    ...(rowPolicyOptions && {
      role: rowPolicyOptions.role,
    }),
  });

  const data = await result.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function executeReadonlySql<T>(
  queryClient: QueryClient,
  sql: Sql,
  limit?: number,
): Promise<T[]> {
  const [query, queryParams] = toQuery(sql);
  return await executeReadonlyQuery<T>(queryClient, query, queryParams, limit);
}

export async function executeReadonlyStatement<T>(
  queryClient: QueryClient,
  query: string,
  limit?: number,
): Promise<T[]> {
  return await executeReadonlyQuery<T>(queryClient, query, {}, limit);
}
