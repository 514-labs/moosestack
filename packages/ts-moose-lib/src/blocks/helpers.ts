import { quoteIdentifier } from "../sqlHelpers";

interface AggregationCreateOptions {
  tableCreateOptions: TableCreateOptions;
  materializedViewName: string;
  select: string;
}

interface AggregationDropOptions {
  viewName: string;
  tableName: string;
}

interface MaterializedViewCreateOptions {
  name: string;
  destinationTable: string;
  select: string;
}

interface PopulateTableOptions {
  destinationTable: string;
  select: string;
}

interface TableCreateOptions {
  name: string;
  columns: Record<string, string>;
  engine?: ClickHouseEngines;
  orderBy?: string;
}

export interface Blocks {
  setup: string[];
  teardown: string[];
}

export enum ClickHouseEngines {
  MergeTree = "MergeTree",
  ReplacingMergeTree = "ReplacingMergeTree",
  SummingMergeTree = "SummingMergeTree",
  AggregatingMergeTree = "AggregatingMergeTree",
  CollapsingMergeTree = "CollapsingMergeTree",
  VersionedCollapsingMergeTree = "VersionedCollapsingMergeTree",
  GraphiteMergeTree = "GraphiteMergeTree",
  S3Queue = "S3Queue",
  // Replicated engine variants for high-availability clusters
  ReplicatedMergeTree = "ReplicatedMergeTree",
  ReplicatedReplacingMergeTree = "ReplicatedReplacingMergeTree",
  ReplicatedAggregatingMergeTree = "ReplicatedAggregatingMergeTree",
  ReplicatedSummingMergeTree = "ReplicatedSummingMergeTree",
}

/**
 * Drops an existing view if it exists.
 */
export function dropView(name: string): string {
  return `DROP VIEW IF EXISTS ${quoteIdentifier(name)}`.trim();
}

/**
 * Creates a materialized view.
 */
export function createMaterializedView(
  options: MaterializedViewCreateOptions,
): string {
  return `CREATE MATERIALIZED VIEW IF NOT EXISTS ${quoteIdentifier(options.name)}
        TO ${quoteIdentifier(options.destinationTable)}
        AS ${options.select}`.trim();
}

/**
 * @deprecated Population of tables is now handled automatically by the Rust infrastructure.
 * This function is kept for backwards compatibility but will be ignored.
 * The framework now intelligently determines when to populate based on:
 * - Whether the materialized view is new or being replaced
 * - Whether the source is an S3Queue table (which doesn't support SELECT)
 *
 * Populates a table with data.
 */
export function populateTable(options: PopulateTableOptions): string {
  return `INSERT INTO ${quoteIdentifier(options.destinationTable)}
          ${options.select}`.trim();
}
