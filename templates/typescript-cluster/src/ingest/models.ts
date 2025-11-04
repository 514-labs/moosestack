import { OlapTable, Key, ClickHouseEngines } from "@514labs/moose-lib";

/**
 * Test models for ClickHouse cluster support
 */

/** Table using cluster_a */
export interface TableA {
  id: Key<string>;
  value: string;
  timestamp: number;
}

/** Table using cluster_b */
export interface TableB {
  id: Key<string>;
  count: number;
  timestamp: number;
}

/** Table without cluster (for mixed testing) */
export interface TableC {
  id: Key<string>;
  data: string;
  timestamp: number;
}

/** Table with explicit keeper args but no cluster */
export interface TableD {
  id: Key<string>;
  metric: number;
  timestamp: number;
}

/** OLAP Tables */

// TableA: Uses cluster_a with ReplicatedMergeTree
export const tableA = new OlapTable<TableA>("TableA", {
  orderByFields: ["id"],
  engine: ClickHouseEngines.ReplicatedMergeTree,
  cluster: "cluster_a",
});

// TableB: Uses cluster_b with ReplicatedMergeTree
export const tableB = new OlapTable<TableB>("TableB", {
  orderByFields: ["id"],
  engine: ClickHouseEngines.ReplicatedMergeTree,
  cluster: "cluster_b",
});

// TableC: No cluster, uses plain MergeTree (not replicated)
export const tableC = new OlapTable<TableC>("TableC", {
  orderByFields: ["id"],
  engine: ClickHouseEngines.MergeTree,
});

// TableD: ReplicatedMergeTree with explicit keeper args, no cluster
export const tableD = new OlapTable<TableD>("TableD", {
  orderByFields: ["id"],
  engine: ClickHouseEngines.ReplicatedMergeTree,
  keeperPath: "/clickhouse/tables/{database}/{table}",
  replicaName: "{replica}",
});
