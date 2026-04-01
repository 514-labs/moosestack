/**
 * ClickHouse diagnostic helpers for benchmarking and profiling queries.
 *
 * Provides utilities to:
 *   - EXPLAIN a query and extract index/granule stats
 *   - Profile query execution via system.query_log
 *   - Benchmark a query over N runs with p50/p95 percentiles
 *   - Get row count, part count, and disk size for a table
 */

import { type Sql, sql, toQueryPreview, quoteIdentifier } from "../sqlHelpers";
import { type QueryClient } from "../consumption-apis/query-client";
import { validateRuns } from "./shared";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  readonly profiles: readonly ProfileResult[];
  readonly p50: number;
  readonly p95: number;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

// ---------------------------------------------------------------------------
// Explain
// ---------------------------------------------------------------------------

export interface ExplainResult {
  readonly indexCondition: string;
  readonly selectedGranules: number;
  readonly totalGranules: number;
  readonly granuleSkipPct: number;
  readonly rawPlan: string;
}

/**
 * Run EXPLAIN indexes=1 on a query and extract index condition and granule stats.
 *
 * Note: The query is rendered via `toQueryPreview` and re-wrapped with `sql.raw`.
 * This bakes parameterized values into the EXPLAIN string as literals, which
 * matches ClickHouse EXPLAIN behavior (it does not support parameterized queries).
 */
export async function explain(
  queryClient: QueryClient,
  query: Sql,
): Promise<ExplainResult> {
  const sqlString = toQueryPreview(query);
  const explainSql = sql.raw(`EXPLAIN indexes = 1 ${sqlString}`);
  const result = await queryClient.execute(explainSql);
  const rows = (await result.json()) as {
    explain?: string;
    EXPLAIN?: string;
  }[];

  const lines = rows.map((r) => r.explain ?? r.EXPLAIN ?? "");
  const full = lines.join("\n");

  const conditionMatch = full.match(/Condition:\s*(.+)/);
  const granulesMatch = full.match(/Granules:\s*(\d+)\/(\d+)/);

  const selected = granulesMatch ? parseInt(granulesMatch[1], 10) : 0;
  const total = granulesMatch ? parseInt(granulesMatch[2], 10) : 0;
  const skipPct = total > 0 ? ((total - selected) / total) * 100 : 0;

  return {
    indexCondition: conditionMatch?.[1]?.trim() ?? "unknown",
    selectedGranules: selected,
    totalGranules: total,
    granuleSkipPct: Math.round(skipPct),
    rawPlan: full,
  };
}

// ---------------------------------------------------------------------------
// Profile (batched)
// ---------------------------------------------------------------------------

export interface ProfileResult {
  readonly queryId: string;
  readonly readRows: number;
  readonly readBytes: number;
  readonly memoryUsage: number;
  readonly durationMs: number;
  readonly resultRows: number;
  readonly diskReadUs: number;
  readonly osReadBytes: number;
}

/**
 * Execute a query and return its query_id for later profile resolution.
 * Does NOT flush logs or read system.query_log — call resolveProfiles() after all runs.
 */
export async function profileQuery(
  queryClient: QueryClient,
  query: Sql,
): Promise<string> {
  const result = await queryClient.execute(query);
  await result.json();
  return result.query_id;
}

/**
 * Flush logs once and batch-resolve all query_ids from system.query_log.
 * Call this after all profileQuery() calls are complete.
 *
 * Query IDs are parameterized via the `sql` template tag to prevent injection.
 */
export async function resolveProfiles(
  queryClient: QueryClient,
  queryIds: string[],
): Promise<ProfileResult[]> {
  if (queryIds.length === 0) return [];

  await queryClient.command(sql.raw("SYSTEM FLUSH LOGS"));

  const idFragments = queryIds.map((id) => sql`${id}`);
  const logQuery = sql`SELECT
    query_id, read_rows, read_bytes, memory_usage, query_duration_ms, result_rows,
    ProfileEvents['DiskReadElapsedMicroseconds'] as disk_read_us,
    ProfileEvents['OSReadChars'] as os_read_bytes
  FROM system.query_log
  WHERE query_id IN (${sql.join(idFragments)}) AND type = 'QueryFinish'
  ORDER BY event_time ASC`;

  const logResult = await queryClient.execute(logQuery);
  const logRows = (await logResult.json()) as {
    query_id: string;
    read_rows?: string;
    read_bytes?: string;
    memory_usage?: string;
    query_duration_ms?: string;
    result_rows?: string;
    disk_read_us?: string;
    os_read_bytes?: string;
  }[];

  const byId = new Map(logRows.map((r) => [r.query_id, r]));

  return queryIds.map((id) => {
    const entry = byId.get(id);
    if (!entry) {
      throw new Error(
        `No query_log entry for query_id=${id}. Check log_queries setting.`,
      );
    }
    return {
      queryId: id,
      readRows: Number(entry.read_rows ?? 0),
      readBytes: Number(entry.read_bytes ?? 0),
      memoryUsage: Number(entry.memory_usage ?? 0),
      durationMs: Number(entry.query_duration_ms ?? 0),
      resultRows: Number(entry.result_rows ?? 0),
      diskReadUs: Number(entry.disk_read_us ?? 0),
      osReadBytes: Number(entry.os_read_bytes ?? 0),
    };
  });
}

/**
 * Run a query N times, then batch-resolve all profiles in one flush + one lookup.
 * Returns profiles with p50/p95 of server-side duration.
 */
export async function profileBenchmark(
  queryClient: QueryClient,
  query: Sql,
  runs: number,
): Promise<BenchmarkResult> {
  validateRuns(runs);

  const queryIds: string[] = [];
  for (let i = 0; i < runs; i++) {
    queryIds.push(await profileQuery(queryClient, query));
  }

  const profiles = await resolveProfiles(queryClient, queryIds);
  const durations = profiles.map((p) => p.durationMs);

  return {
    profiles,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
  };
}

// ---------------------------------------------------------------------------
// Table stats
// ---------------------------------------------------------------------------

// Matches "table" or "database.table" — no trailing/leading/consecutive dots
const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;

export interface TableStats {
  readonly table: string;
  readonly rows: number;
  readonly parts: number;
  readonly diskSize: string;
}

export async function tableStats(
  queryClient: QueryClient,
  table: string,
): Promise<TableStats> {
  if (!TABLE_NAME_RE.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }

  // Split on dot to handle database.table — quote each part separately
  const quoted = table
    .split(".")
    .map((part) => quoteIdentifier(part))
    .join(".");
  // Extract database and bare table name for system.parts lookup
  const parts = table.split(".");
  const bareTable = parts.length > 1 ? parts[parts.length - 1] : table;
  const bareDatabase = parts.length > 1 ? parts[0] : null;

  const [countRows, partsRows] = await Promise.all([
    queryClient
      .execute(sql.raw(`SELECT count() as rows FROM ${quoted}`))
      .then((r) => r.json() as Promise<{ rows: string }[]>),
    queryClient
      .execute(
        bareDatabase ?
          sql`SELECT count() as parts, formatReadableSize(sum(bytes_on_disk)) as disk_size
           FROM system.parts
           WHERE active = 1 AND table = ${bareTable} AND database = ${bareDatabase}`
        : sql`SELECT count() as parts, formatReadableSize(sum(bytes_on_disk)) as disk_size
           FROM system.parts
           WHERE active = 1 AND table = ${bareTable}`,
      )
      .then((r) => r.json() as Promise<{ parts: string; disk_size: string }[]>),
  ]);

  return {
    table,
    rows: Number(countRows[0]?.rows ?? 0),
    parts: Number(partsRows[0]?.parts ?? 0),
    diskSize: partsRows[0]?.disk_size ?? "unknown",
  };
}
