import {
  OlapTable,
  ClickHouseEngines,
  Key,
  DateTime,
  mooseEnvSecrets,
} from "@514labs/moose-lib";

/**
 * S3Queue table tests for runtime secret resolution
 *
 * These tables test the mooseEnvSecrets.get() functionality which allows
 * credentials to be resolved at runtime from environment variables rather
 * than being embedded at build time.
 */

export interface S3QueueTestData {
  id: Key<string>;
  timestamp: DateTime;
  data: string;
}

// Test S3Queue with runtime secret resolution using mooseEnvSecrets
// This table will only be created if the required environment variables are set
export const S3QueueWithSecrets = new OlapTable<S3QueueTestData>(
  "S3QueueWithSecrets",
  {
    engine: ClickHouseEngines.S3Queue,
    s3Path: "s3://test-bucket/data/*.json",
    format: "JSONEachRow",
    // Credentials resolved at runtime from environment variables
    awsAccessKeyId: mooseEnvSecrets.get("TEST_AWS_ACCESS_KEY_ID"),
    awsSecretAccessKey: mooseEnvSecrets.get("TEST_AWS_SECRET_ACCESS_KEY"),
    settings: {
      mode: "unordered",
      keeper_path: "/clickhouse/s3queue/test_with_secrets",
    },
  },
);

// Test S3Queue with public bucket (no credentials needed)
export const S3QueuePublic = new OlapTable<S3QueueTestData>("S3QueuePublic", {
  engine: ClickHouseEngines.S3Queue,
  s3Path: "s3://public-test-bucket/data/*.csv",
  format: "CSV",
  settings: {
    mode: "ordered",
    keeper_path: "/clickhouse/s3queue/test_public",
  },
});
