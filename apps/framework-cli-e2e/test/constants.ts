/**
 * Test configuration constants for E2E tests
 * All timeout values are in milliseconds unless otherwise specified
 */

// Test execution timeouts
export const TIMEOUTS = {
  // Main test setup timeout (4 minutes)
  TEST_SETUP_MS: 240_000,

  // Server startup timeout (3 minutes)
  SERVER_STARTUP_MS: 180_000,

  // Cleanup timeout (1.5 minutes)
  CLEANUP_MS: 90_000,

  // Global cleanup timeout (30 seconds)
  GLOBAL_CLEANUP_MS: 30_000,

  // Process termination timeout (30 seconds)
  PROCESS_TERMINATION_MS: 30_000,

  // Docker operations timeouts
  DOCKER_COMPOSE_DOWN_MS: 30_000,
  DOCKER_VOLUME_LIST_MS: 10_000,
  DOCKER_VOLUME_REMOVE_MS: 5_000,

  // Wait time before tests (30 seconds - allows Kafka to fully initialize after Docker restart)
  PRE_TEST_WAIT_MS: 30_000,

  // Brief cleanup wait (1 second)
  BRIEF_CLEANUP_WAIT_MS: 1_000,

  // Schema validation timeout (30 seconds)
  SCHEMA_VALIDATION_MS: 30_000,

  // Migration operations timeout (2 minutes)
  MIGRATION_MS: 120_000,

  // Kafka readiness timeout (60 seconds)
  KAFKA_READY_MS: 60_000,
} as const;

// Retry configuration
export const RETRY_CONFIG = {
  DEFAULT_ATTEMPTS: 10,
  DEFAULT_DELAY_MS: 1_000,
  DEFAULT_BACKOFF_FACTOR: 1.5,

  // Specific retry configs
  INGESTION_ATTEMPTS: 5,
  INGESTION_DELAY_MS: 500,

  DB_WRITE_ATTEMPTS: 60, // 60 seconds with 1s intervals
  DB_WRITE_DELAY_MS: 1_000,

  API_VERIFICATION_ATTEMPTS: 10,
  API_VERIFICATION_DELAY_MS: 1_000,

  LOG_VERIFICATION_ATTEMPTS: 10,
  LOG_VERIFICATION_DELAY_MS: 1_000,
} as const;

// Test data configuration
export const TEST_DATA = {
  // Fixed timestamp for consistent testing (October 19, 2025 00:00:00 UTC)
  // This is in seconds. If typescript, make sure to convert to milliseconds for Date constructor.
  // If python, datetime.fromtimestamp already expects seconds.
  TIMESTAMP: 1739865600,

  // Number of records to send for batch testing
  BATCH_RECORD_COUNT: 50,

  // Expected CLI version in debug build
  EXPECTED_CLI_VERSION: "moose-cli 0.0.1",
} as const;

// ClickHouse configuration
export const CLICKHOUSE_CONFIG = {
  url: "http://localhost:18123",
  username: "panda",
  password: "pandapass",
  database: "local",
} as const;

// Server configuration
export const SERVER_CONFIG = {
  url: "http://localhost:4000",
  startupMessage:
    "Your local development server is running at: http://localhost:4000/ingest",
} as const;

// Template configurations
export const TEMPLATE_NAMES = {
  TYPESCRIPT_DEFAULT: "typescript",
  TYPESCRIPT_TESTS: "typescript-tests",
  PYTHON_DEFAULT: "python",
  PYTHON_TESTS: "python-tests",
  TYPESCRIPT_CLUSTER: "typescript-cluster",
  PYTHON_CLUSTER: "python-cluster",
} as const;

export const APP_NAMES = {
  TYPESCRIPT_DEFAULT: "moose-ts-default-app",
  TYPESCRIPT_TESTS: "moose-ts-tests-app",
  PYTHON_DEFAULT: "moose-py-default-app",
  PYTHON_TESTS: "moose-py-tests-app",
  TYPESCRIPT_CLUSTER: "moose-ts-cluster-app",
  PYTHON_CLUSTER: "moose-py-cluster-app",
} as const;
