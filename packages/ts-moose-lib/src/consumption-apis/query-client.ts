import { ClickHouseClient, CommandResult, ResultSet } from "@clickhouse/client";
import { randomUUID } from "node:crypto";
import { performance } from "perf_hooks";
import { Sql, toQuery, toQueryPreview } from "../sqlHelpers";

/**
 * Format elapsed milliseconds into a human-readable string.
 * Matches Python's format_timespan behavior.
 */
function formatElapsedTime(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} minutes and ${remainingSeconds.toFixed(2)} seconds`;
}

/**
 * Options for per-query ClickHouse row policy enforcement.
 * When provided, each query activates the specified role and injects
 * custom settings (e.g., tenant ID) that row policies evaluate via getSetting().
 */
export interface RowPolicyOptions {
  role: string;
  clickhouse_settings: Record<string, string>;
}

export class QueryClient {
  client: ClickHouseClient;
  query_id_prefix: string;
  private rowPolicyOptions?: RowPolicyOptions;

  constructor(
    client: ClickHouseClient,
    query_id_prefix: string,
    rowPolicyOptions?: RowPolicyOptions,
  ) {
    this.client = client;
    this.query_id_prefix = query_id_prefix;
    this.rowPolicyOptions = rowPolicyOptions;
  }

  async execute<T = any>(
    sql: Sql,
  ): Promise<ResultSet<"JSONEachRow"> & { __query_result_t?: T[] }> {
    const [query, query_params] = toQuery(sql);

    console.log(`[QueryClient] | Query: ${toQueryPreview(sql)}`);
    const start = performance.now();
    const result = await this.client.query({
      query,
      query_params,
      format: "JSONEachRow",
      query_id: this.query_id_prefix + randomUUID(),
      // Note: wait_end_of_query deliberately NOT set here as this is used for SELECT queries
      // where response buffering would harm streaming performance and concurrency
      clickhouse_settings: {
        asterisk_include_materialized_columns: 1,
        asterisk_include_alias_columns: 1,
        ...this.rowPolicyOptions?.clickhouse_settings,
      },
      ...(this.rowPolicyOptions && {
        role: this.rowPolicyOptions.role,
      }),
    });
    const elapsedMs = performance.now() - start;
    console.log(
      `[QueryClient] | Query completed: ${formatElapsedTime(elapsedMs)}`,
    );
    return result;
  }

  async command(sql: Sql): Promise<CommandResult> {
    const [query, query_params] = toQuery(sql);

    console.log(`[QueryClient] | Command: ${toQueryPreview(sql)}`);
    const start = performance.now();
    const result = await this.client.command({
      query,
      query_params,
      query_id: this.query_id_prefix + randomUUID(),
    });
    const elapsedMs = performance.now() - start;
    console.log(
      `[QueryClient] | Command completed: ${formatElapsedTime(elapsedMs)}`,
    );
    return result;
  }
}
