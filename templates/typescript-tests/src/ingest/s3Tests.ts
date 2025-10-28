import {
  OlapTable,
  ClickHouseEngines,
  Key,
  DateTime,
  mooseRuntimeEnv,
} from "@514labs/moose-lib";

/**
 * S3 table tests for runtime environment variable resolution
 *
 * These tables test the mooseRuntimeEnv.get() functionality with the S3 engine,
 * which allows direct read/write from S3 storage. Configuration is resolved at
 * runtime from environment variables rather than being embedded at build time.
 */

export interface S3TestData {
  id: Key<string>;
  timestamp: DateTime;
  data: string;
}

// Test S3 engine with public bucket (no credentials needed, uses NOSIGN)
export const S3Public = new OlapTable<S3TestData>("S3Public", {
  engine: ClickHouseEngines.S3,
  path: "s3://public-test-bucket/data/file.csv",
  format: "CSV",
  compression: "auto",
});

// Test S3 engine with parquet format
export const S3Parquet = new OlapTable<S3TestData>("S3Parquet", {
  engine: ClickHouseEngines.S3,
  path: "s3://public-test-bucket/data/*.parquet",
  format: "Parquet",
});
