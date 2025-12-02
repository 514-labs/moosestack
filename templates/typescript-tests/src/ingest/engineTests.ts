import {
  OlapTable,
  ClickHouseEngines,
  Key,
  DateTime,
  ClickHouseTTL,
  ClickHouseDefault,
  UInt32,
} from "@514labs/moose-lib";

/**
 * Test interfaces for various engine configurations
 * These tables test all supported ClickHouse engines to ensure
 * they can be properly created and configured.
 */

// Test data model for engine testing
export interface EngineTestData {
  id: Key<string>;
  timestamp: DateTime;
  value: number;
  category: string;
  version: number;
  isDeleted: boolean; // For ReplacingMergeTree soft deletes (UInt8 in ClickHouse)
}

// Test data model for CollapsingMergeTree and VersionedCollapsingMergeTree testing
export interface CollapsingTestData extends EngineTestData {
  sign: number; // For CollapsingMergeTree (1 = state, -1 = cancel)
}

export interface EngineTestDataSample {
  id: string;
  timestamp: DateTime;
  value: number;
  category: string;
  version: number;
  isDeleted: boolean; // For ReplacingMergeTree soft deletes (UInt8 in ClickHouse)
}

// Table with TTL: delete rows older than 90 days, delete email after 30 days
export interface TTLTestData {
  id: Key<string>;
  timestamp: DateTime;
  email: string & ClickHouseTTL<"timestamp + INTERVAL 30 DAY">;
}

export const TTLTable = new OlapTable<TTLTestData>("TTLTable", {
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["id", "timestamp"],
  ttl: "timestamp + INTERVAL 90 DAY DELETE",
});

// Table with DEFAULT values for testing DEFAULT removal
export interface DefaultTestData {
  id: Key<string>;
  timestamp: DateTime;
  status: string & ClickHouseDefault<"'pending'">;
  count: UInt32 & ClickHouseDefault<"0">;
}

export const DefaultTable = new OlapTable<DefaultTestData>("DefaultTable", {
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["id", "timestamp"],
});

// Test MergeTree engine (default)
export const MergeTreeTable = new OlapTable<EngineTestData>("MergeTreeTest", {
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["id", "timestamp"],
});

// Test MergeTree with orderByExpression (equivalent to fields)
export const MergeTreeTableExpr = new OlapTable<EngineTestData>(
  "MergeTreeTestExpr",
  {
    engine: ClickHouseEngines.MergeTree,
    orderByExpression: "(id, timestamp)",
  },
);

// Test ReplacingMergeTree engine with basic deduplication
export const ReplacingMergeTreeBasicTable = new OlapTable<EngineTestData>(
  "ReplacingMergeTreeBasic",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["id"],
  },
);

// Test ReplacingMergeTree engine with version column
export const ReplacingMergeTreeVersionTable = new OlapTable<EngineTestData>(
  "ReplacingMergeTreeVersion",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["id"],
    ver: "version",
  },
);

// Test ReplacingMergeTree engine with version and soft delete
export const ReplacingMergeTreeSoftDeleteTable = new OlapTable<EngineTestData>(
  "ReplacingMergeTreeSoftDelete",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["id"],
    ver: "version",
    isDeleted: "isDeleted",
  },
);

// Test SummingMergeTree engine
export const SummingMergeTreeTable = new OlapTable<EngineTestData>(
  "SummingMergeTreeTest",
  {
    engine: ClickHouseEngines.SummingMergeTree,
    orderByFields: ["id", "category"],
  },
);

// Test AggregatingMergeTree engine
export const AggregatingMergeTreeTable = new OlapTable<EngineTestData>(
  "AggregatingMergeTreeTest",
  {
    engine: ClickHouseEngines.AggregatingMergeTree,
    orderByFields: ["id", "category"],
  },
);

// Test CollapsingMergeTree engine
export const CollapsingMergeTreeTable = new OlapTable<CollapsingTestData>(
  "CollapsingMergeTreeTest",
  {
    engine: ClickHouseEngines.CollapsingMergeTree,
    sign: "sign",
    orderByFields: ["id", "timestamp"],
  },
);

// Test VersionedCollapsingMergeTree engine
export const VersionedCollapsingMergeTreeTable =
  new OlapTable<CollapsingTestData>("VersionedCollapsingMergeTreeTest", {
    engine: ClickHouseEngines.VersionedCollapsingMergeTree,
    sign: "sign",
    ver: "version",
    orderByFields: ["id", "timestamp"],
  });

// Test SummingMergeTree engine with columns
export const SummingMergeTreeWithColumnsTable = new OlapTable<EngineTestData>(
  "SummingMergeTreeWithColumnsTest",
  {
    engine: ClickHouseEngines.SummingMergeTree,
    orderByFields: ["id", "category"],
    columns: ["value"],
  },
);

// Test ReplicatedMergeTree engine (with explicit keeper params - for self-hosted)
export const ReplicatedMergeTreeTable = new OlapTable<EngineTestData>(
  "ReplicatedMergeTreeTest",
  {
    engine: ClickHouseEngines.ReplicatedMergeTree,
    keeperPath:
      "/clickhouse/tables/{database}/{shard}/replicated_merge_tree_test",
    replicaName: "{replica}",
    orderByFields: ["id", "timestamp"],
  },
);

// Test ReplicatedMergeTree engine (Cloud-compatible - no keeper params)
// In dev mode, Moose automatically injects default parameters
// In production, ClickHouse uses its automatic configuration
export const ReplicatedMergeTreeCloudTable = new OlapTable<EngineTestData>(
  "ReplicatedMergeTreeCloudTest",
  {
    engine: ClickHouseEngines.ReplicatedMergeTree,
    orderByFields: ["id", "timestamp"],
  },
);

// Test ReplicatedReplacingMergeTree engine with version column
export const ReplicatedReplacingMergeTreeTable = new OlapTable<EngineTestData>(
  "ReplicatedReplacingMergeTreeTest",
  {
    engine: ClickHouseEngines.ReplicatedReplacingMergeTree,
    keeperPath:
      "/clickhouse/tables/{database}/{shard}/replicated_replacing_test",
    replicaName: "{replica}",
    ver: "version",
    orderByFields: ["id"],
  },
);

// Test ReplicatedReplacingMergeTree with soft delete
export const ReplicatedReplacingSoftDeleteTable = new OlapTable<EngineTestData>(
  "ReplicatedReplacingSoftDeleteTest",
  {
    engine: ClickHouseEngines.ReplicatedReplacingMergeTree,
    keeperPath:
      "/clickhouse/tables/{database}/{shard}/replicated_replacing_sd_test",
    replicaName: "{replica}",
    ver: "version",
    isDeleted: "isDeleted",
    orderByFields: ["id"],
  },
);

// Test ReplicatedAggregatingMergeTree engine
export const ReplicatedAggregatingMergeTreeTable =
  new OlapTable<EngineTestData>("ReplicatedAggregatingMergeTreeTest", {
    engine: ClickHouseEngines.ReplicatedAggregatingMergeTree,
    keeperPath:
      "/clickhouse/tables/{database}/{shard}/replicated_aggregating_test",
    replicaName: "{replica}",
    orderByFields: ["id", "category"],
  });

// Test ReplicatedSummingMergeTree engine
export const ReplicatedSummingMergeTreeTable = new OlapTable<EngineTestData>(
  "ReplicatedSummingMergeTreeTest",
  {
    engine: ClickHouseEngines.ReplicatedSummingMergeTree,
    keeperPath: "/clickhouse/tables/{database}/{shard}/replicated_summing_test",
    replicaName: "{replica}",
    columns: ["value"],
    orderByFields: ["id", "category"],
  },
);

// Test ReplicatedCollapsingMergeTree engine
export const ReplicatedCollapsingMergeTreeTable =
  new OlapTable<CollapsingTestData>("ReplicatedCollapsingMergeTreeTest", {
    engine: ClickHouseEngines.ReplicatedCollapsingMergeTree,
    keeperPath:
      "/clickhouse/tables/{database}/{shard}/replicated_collapsing_test",
    replicaName: "{replica}",
    sign: "sign",
    orderByFields: ["id", "timestamp"],
  });

// Test ReplicatedVersionedCollapsingMergeTree engine
export const ReplicatedVersionedCollapsingMergeTreeTable =
  new OlapTable<CollapsingTestData>(
    "ReplicatedVersionedCollapsingMergeTreeTest",
    {
      engine: ClickHouseEngines.ReplicatedVersionedCollapsingMergeTree,
      keeperPath:
        "/clickhouse/tables/{database}/{shard}/replicated_versioned_collapsing_test",
      replicaName: "{replica}",
      sign: "sign",
      ver: "version",
      orderByFields: ["id", "timestamp"],
    },
  );

// Test SAMPLE BY clause for data sampling
export const SampleByTable = new OlapTable<EngineTestDataSample>(
  "SampleByTest",
  {
    engine: ClickHouseEngines.MergeTree,
    orderByExpression: "cityHash64(id)",
    sampleByExpression: "cityHash64(id)",
  },
);

// Note: S3Queue engine testing is more complex as it requires S3 configuration
// and external dependencies, so it's not included in this basic engine test suite.
// For S3Queue testing, see the dedicated S3 integration tests.

// Test Buffer engine - buffers writes before flushing to destination table
// First create the destination table
export const BufferDestinationTable = new OlapTable<EngineTestData>(
  "BufferDestinationTest",
  {
    engine: ClickHouseEngines.MergeTree,
    orderByFields: ["id", "timestamp"],
  },
);

// Then create the buffer table that points to it
export const BufferTable = new OlapTable<EngineTestData>("BufferTest", {
  engine: ClickHouseEngines.Buffer,
  targetDatabase: "local",
  targetTable: "BufferDestinationTest",
  numLayers: 16,
  minTime: 10,
  maxTime: 100,
  minRows: 10000,
  maxRows: 1000000,
  minBytes: 10485760,
  maxBytes: 104857600,
});

/**
 * Export all test tables for verification that engine configurations
 * can be properly instantiated and don't throw errors during table creation.
 */
export const allEngineTestTables = [
  MergeTreeTable,
  MergeTreeTableExpr,
  ReplacingMergeTreeBasicTable,
  ReplacingMergeTreeVersionTable,
  ReplacingMergeTreeSoftDeleteTable,
  SummingMergeTreeTable,
  SummingMergeTreeWithColumnsTable,
  AggregatingMergeTreeTable,
  CollapsingMergeTreeTable,
  VersionedCollapsingMergeTreeTable,
  ReplicatedMergeTreeTable,
  ReplicatedMergeTreeCloudTable,
  ReplicatedReplacingMergeTreeTable,
  ReplicatedReplacingSoftDeleteTable,
  ReplicatedAggregatingMergeTreeTable,
  ReplicatedSummingMergeTreeTable,
  ReplicatedCollapsingMergeTreeTable,
  ReplicatedVersionedCollapsingMergeTreeTable,
  SampleByTable,
  TTLTable,
  BufferDestinationTable,
  BufferTable,
  DefaultTable,
];
