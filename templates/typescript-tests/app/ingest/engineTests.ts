import {
  OlapTable,
  ClickHouseEngines,
  Key,
  DateTime,
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

// Test MergeTree engine (default)
export const MergeTreeTable = new OlapTable<EngineTestData>("MergeTreeTest", {
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["id", "timestamp"],
});

// Test ReplacingMergeTree engine with basic deduplication
export const ReplacingMergeTreeBasicTable = new OlapTable<EngineTestData>("ReplacingMergeTreeBasic", {
  engine: ClickHouseEngines.ReplacingMergeTree,
  orderByFields: ["id"],
});

// Test ReplacingMergeTree engine with version column
export const ReplacingMergeTreeVersionTable = new OlapTable<EngineTestData>("ReplacingMergeTreeVersion", {
  engine: ClickHouseEngines.ReplacingMergeTree,
  orderByFields: ["id"],
  ver: "version",
});

// Test ReplacingMergeTree engine with version and soft delete
export const ReplacingMergeTreeSoftDeleteTable = new OlapTable<EngineTestData>("ReplacingMergeTreeSoftDelete", {
  engine: ClickHouseEngines.ReplacingMergeTree,
  orderByFields: ["id"],
  ver: "version",
  isDeleted: "isDeleted",
});

// Test SummingMergeTree engine
export const SummingMergeTreeTable = new OlapTable<EngineTestData>("SummingMergeTreeTest", {
  engine: ClickHouseEngines.SummingMergeTree,
  orderByFields: ["id", "category"],
});

// Test AggregatingMergeTree engine  
export const AggregatingMergeTreeTable = new OlapTable<EngineTestData>("AggregatingMergeTreeTest", {
  engine: ClickHouseEngines.AggregatingMergeTree,
  orderByFields: ["id", "category"],
});

// Note: S3Queue engine testing is more complex as it requires S3 configuration
// and external dependencies, so it's not included in this basic engine test suite.
// For S3Queue testing, see the dedicated S3 integration tests.

/**
 * Export all test tables for verification that engine configurations
 * can be properly instantiated and don't throw errors during table creation.
 */
export const allEngineTestTables = [
  MergeTreeTable,
  ReplacingMergeTreeBasicTable,
  ReplacingMergeTreeVersionTable,
  ReplacingMergeTreeSoftDeleteTable,
  SummingMergeTreeTable,
  AggregatingMergeTreeTable,
];