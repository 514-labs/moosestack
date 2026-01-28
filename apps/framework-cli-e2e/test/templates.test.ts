/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Combined test file for all Moose templates.
 *
 * We keep all template tests in a single file to ensure they run sequentially.
 * This is necessary because:
 * 1. Each template test spins up the same infrastructure (Docker containers, ports, etc.)
 * 2. Running tests in parallel would cause port conflicts and resource contention
 * 3. The cleanup process for one test could interfere with another test's setup
 *
 * By keeping them in the same file, Mocha naturally runs them sequentially,
 * and we can ensure proper setup/teardown between template tests.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";

// Import constants and utilities
import {
  TIMEOUTS,
  SERVER_CONFIG,
  TEST_DATA,
  TEMPLATE_NAMES,
  APP_NAMES,
  CLICKHOUSE_CONFIG,
} from "./constants";

import {
  waitForServerStart,
  waitForStreamingFunctions,
  waitForInfrastructureReady,
  waitForKafkaReady,
  cleanupClickhouseData,
  waitForDBWrite,
  waitForMaterializedViewUpdate,
  verifyClickhouseData,
  verifyRecordCount,
  withRetries,
  verifyConsumptionApi,
  verifyVersionedConsumptionApi,
  verifyProxyHealth,
  verifyConsumptionApiInternalHealth,
  verifyConsumerLogs,
  createTempTestDirectory,
  setupTypeScriptProject,
  setupPythonProject,
  getExpectedSchemas,
  validateSchemasWithDebugging,
  verifyVersionedTables,
  verifyWebAppEndpoint,
  verifyWebAppHealth,
  verifyWebAppQuery,
  verifyWebAppPostEndpoint,
  cleanupTestSuite,
  performGlobalCleanup,
  logger,
  waitForInfrastructureChanges,
} from "./utils";
import { triggerWorkflow } from "./utils/workflow-utils";
import { geoPayloadPy, geoPayloadTs } from "./utils/geo-payload";
import {
  verifyTableIndexes,
  getTableDDL,
  verifyMaterializedViewRefreshConfig,
  verifyIncrementalMaterializedView,
} from "./utils/database-utils";
import { createClient } from "@clickhouse/client";

const testLogger = logger.scope("templates-test");

const execAsync = promisify(require("child_process").exec);
const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => global.setTimeout(resolve, ms));

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);

const TEST_PACKAGE_MANAGER = (process.env.TEST_PACKAGE_MANAGER || "npm") as
  | "npm"
  | "pnpm"
  | "pip";

if (process.env.TEST_PACKAGE_MANAGER) {
  testLogger.info(
    `\n🧪 Testing templates with package manager: ${TEST_PACKAGE_MANAGER}\n`,
  );
}

it("should return the dummy version in debug build", async () => {
  const { stdout } = await execAsync(`"${CLI_PATH}" --version`);
  const version = stdout.trim();
  const expectedVersion = TEST_DATA.EXPECTED_CLI_VERSION;

  testLogger.info("Resulting version:", version);
  testLogger.info("Expected version:", expectedVersion);

  expect(version).to.equal(expectedVersion);
});

// Template test configuration
interface TemplateTestConfig {
  templateName: string;
  displayName: string;
  projectDirSuffix: string;
  appName: string;
  language: "typescript" | "python";
  isTestsVariant: boolean;
  packageManager: "npm" | "pnpm" | "pip";
}

const TEMPLATE_CONFIGS: TemplateTestConfig[] = [
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
    displayName: `TypeScript Default Template (${TEST_PACKAGE_MANAGER})`,
    projectDirSuffix: `ts-default-${TEST_PACKAGE_MANAGER}`,
    appName: APP_NAMES.TYPESCRIPT_DEFAULT,
    language: "typescript",
    isTestsVariant: false,
    packageManager: TEST_PACKAGE_MANAGER,
  },
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_TESTS,
    displayName: `TypeScript Tests Template (${TEST_PACKAGE_MANAGER})`,
    projectDirSuffix: `ts-tests-${TEST_PACKAGE_MANAGER}`,
    appName: APP_NAMES.TYPESCRIPT_TESTS,
    language: "typescript",
    isTestsVariant: true,
    packageManager: TEST_PACKAGE_MANAGER,
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_DEFAULT,
    displayName: "Python Default Template",
    projectDirSuffix: "py-default",
    appName: APP_NAMES.PYTHON_DEFAULT,
    language: "python",
    isTestsVariant: false,
    packageManager: "pip",
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_TESTS,
    displayName: "Python Tests Template",
    projectDirSuffix: "py-tests",
    appName: APP_NAMES.PYTHON_TESTS,
    language: "python",
    isTestsVariant: true,
    packageManager: "pip",
  },
];

const createTemplateTestSuite = (config: TemplateTestConfig) => {
  const testName =
    config.isTestsVariant ?
      `${config.language} template tests main`
    : `${config.language} template default`;

  describe(testName, () => {
    let devProcess: ChildProcess | null = null;
    let TEST_PROJECT_DIR: string;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);
      try {
        await fs.promises.access(CLI_PATH, fs.constants.F_OK);
      } catch (err) {
        testLogger.error(
          `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
        );
        throw err;
      }

      // Create temporary directory for this test
      TEST_PROJECT_DIR = createTempTestDirectory(config.projectDirSuffix);

      // Setup project based on language
      if (config.language === "typescript") {
        await setupTypeScriptProject(
          TEST_PROJECT_DIR,
          config.templateName,
          CLI_PATH,
          MOOSE_LIB_PATH,
          config.appName,
          config.packageManager as "npm" | "pnpm",
        );
      } else {
        await setupPythonProject(
          TEST_PROJECT_DIR,
          config.templateName,
          CLI_PATH,
          MOOSE_PY_LIB_PATH,
          config.appName,
        );
      }

      // Start dev server
      testLogger.info("Starting dev server...");
      const devEnv =
        config.language === "python" ?
          {
            ...process.env,
            VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
            PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
            // Add test credentials for S3Queue tests
            TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
            TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
            MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
          }
        : {
            ...process.env,
            // Add test credentials for S3Queue tests
            TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
            TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
            MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
          };

      devProcess = spawn(CLI_PATH, ["dev"], {
        stdio: "pipe",
        cwd: TEST_PROJECT_DIR,
        env: devEnv,
      });

      await waitForServerStart(
        devProcess,
        TIMEOUTS.SERVER_STARTUP_MS,
        SERVER_CONFIG.startupMessage,
        SERVER_CONFIG.url,
      );
      testLogger.info(
        "Server started, waiting for Kafka broker to be ready...",
      );
      await waitForKafkaReady(TIMEOUTS.KAFKA_READY_MS);
      testLogger.info("Kafka ready, cleaning up old data...");
      await cleanupClickhouseData();
      testLogger.info("Waiting for streaming functions to be ready...");
      await waitForStreamingFunctions();
      testLogger.info(
        "Verifying all infrastructure is ready (Redis, Kafka, ClickHouse, Temporal)...",
      );
      await waitForInfrastructureReady();
      testLogger.info("All components ready, starting tests...");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      await cleanupTestSuite(devProcess, TEST_PROJECT_DIR, config.appName, {
        logPrefix: config.displayName,
      });
    });

    // Schema validation test - runs for all templates
    it("should create tables with correct schema structure", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      testLogger.info(`Validating schema for ${config.displayName}...`);

      // Get expected schemas for this template
      const expectedSchemas = getExpectedSchemas(
        config.language,
        config.isTestsVariant,
      );

      // Validate all table schemas with debugging
      const validationResult = await validateSchemasWithDebugging(
        expectedSchemas,
        "local",
      );

      // Assert that all schemas are valid
      if (!validationResult.valid) {
        const failedTables = validationResult.results
          .filter((r) => !r.valid)
          .map((r) => r.tableName)
          .join(", ");
        throw new Error(`Schema validation failed for tables: ${failedTables}`);
      }

      testLogger.info(`✅ Schema validation passed for ${config.displayName}`);
    });

    it("should include TTL in DDL when configured", async function () {
      if (config.isTestsVariant) {
        const ddl = await getTableDDL("TTLTable", "local");
        if (!ddl.includes("TTL timestamp + toIntervalDay(90)")) {
          throw new Error(
            `Schema validation failed for tables TTLTable: ${ddl}`,
          );
        }
        if (!ddl.includes("`email` String TTL timestamp + toIntervalDay(30)")) {
          throw new Error(
            `Schema validation failed for tables TTLTable: ${ddl}`,
          );
        }
      }
    });

    it("should include PRIMARY KEY expression in DDL when configured", async function () {
      if (config.isTestsVariant) {
        // Test 1: Primary key with hash function
        const ddl1 = await getTableDDL("PrimaryKeyExpressionTest", "local");
        const primaryKeyPattern =
          config.language === "typescript" ?
            "PRIMARY KEY (userId, cityHash64(eventId))"
          : "PRIMARY KEY (user_id, cityHash64(event_id))";
        const orderByPattern =
          config.language === "typescript" ?
            "ORDER BY (userId, cityHash64(eventId), timestamp)"
          : "ORDER BY (user_id, cityHash64(event_id), timestamp)";

        if (!ddl1.includes(primaryKeyPattern)) {
          throw new Error(
            `PRIMARY KEY expression not found in PrimaryKeyExpressionTest DDL. Expected: ${primaryKeyPattern}. DDL: ${ddl1}`,
          );
        }
        if (!ddl1.includes(orderByPattern)) {
          throw new Error(
            `ORDER BY expression not found in PrimaryKeyExpressionTest DDL. Expected: ${orderByPattern}. DDL: ${ddl1}`,
          );
        }

        // Test 2: Primary key with different ordering
        const ddl2 = await getTableDDL("PrimaryKeyOrderingTest", "local");
        const primaryKeyPattern2 =
          config.language === "typescript" ?
            "PRIMARY KEY productId"
          : "PRIMARY KEY product_id";
        const orderByPattern2 =
          config.language === "typescript" ?
            "ORDER BY (productId, category, brand)"
          : "ORDER BY (product_id, category, brand)";

        if (!ddl2.includes(primaryKeyPattern2)) {
          throw new Error(
            `PRIMARY KEY expression not found in PrimaryKeyOrderingTest DDL. Expected: ${primaryKeyPattern2}. DDL: ${ddl2}`,
          );
        }
        if (!ddl2.includes(orderByPattern2)) {
          throw new Error(
            `ORDER BY expression not found in PrimaryKeyOrderingTest DDL. Expected: ${orderByPattern2}. DDL: ${ddl2}`,
          );
        }
      }
    });

    it("should generate FixedString types in DDL including type aliases", async function () {
      if (config.isTestsVariant && config.language === "python") {
        const ddl = await getTableDDL("FixedStringTest", "local");

        // Verify direct FixedString usage
        if (!ddl.includes("`md5_hash` FixedString(16)")) {
          throw new Error(
            `Expected md5_hash to be FixedString(16). DDL: ${ddl}`,
          );
        }
        if (!ddl.includes("`ipv6_address` FixedString(16)")) {
          throw new Error(
            `Expected ipv6_address to be FixedString(16). DDL: ${ddl}`,
          );
        }

        // Verify type alias generates FixedString
        if (!ddl.includes("`mac_address` FixedString(17)")) {
          throw new Error(
            `Expected mac_address (type alias) to be FixedString(17). DDL: ${ddl}`,
          );
        }

        // Verify array of type alias generates Array(FixedString(...))
        if (!ddl.includes("`mac_addresses` Array(FixedString(17))")) {
          throw new Error(
            `Expected mac_addresses to be Array(FixedString(17)). DDL: ${ddl}`,
          );
        }

        testLogger.info("✅ FixedString DDL validation passed");
      }
    });

    it("should include column comments in DDL from TSDoc/Field descriptions", async function () {
      if (config.isTestsVariant) {
        const ddl = await getTableDDL("ColumnCommentsTest", "local");

        // Verify comments are present in DDL for documented fields
        // ClickHouse DDL format: `column_name` Type COMMENT 'comment text'
        if (!ddl.includes("COMMENT 'Unique identifier for the record'")) {
          throw new Error(
            `Expected id column to have comment 'Unique identifier for the record'. DDL: ${ddl}`,
          );
        }
        if (!ddl.includes("COMMENT 'Timestamp when the event occurred'")) {
          throw new Error(
            `Expected timestamp column to have comment 'Timestamp when the event occurred'. DDL: ${ddl}`,
          );
        }
        if (
          !ddl.includes("COMMENT 'Email address of the user (must be valid)'")
        ) {
          throw new Error(
            `Expected email column to have comment 'Email address of the user (must be valid)'. DDL: ${ddl}`,
          );
        }
        if (!ddl.includes("COMMENT 'Total price in USD ($)'")) {
          throw new Error(
            `Expected price column to have comment 'Total price in USD ($)'. DDL: ${ddl}`,
          );
        }

        // Verify status field does NOT have a comment (it has no TSDoc/description)
        // The status column should appear without a COMMENT clause
        // Match from `status` to the next comma or closing paren to capture the full column definition
        const statusMatch = ddl.match(/`status`[^,)]+/);
        if (statusMatch && statusMatch[0].includes("COMMENT")) {
          throw new Error(
            `Expected status column to NOT have a comment, but found one. Match: ${statusMatch[0]}`,
          );
        }

        testLogger.info(
          `✅ Column comments DDL validation passed for ${config.language}`,
        );
      }
    });

    it("should preserve user comments alongside enum metadata in column comments", async function () {
      if (config.isTestsVariant) {
        const ddl = await getTableDDL("EnumColumnCommentsTest", "local");

        // Enum columns should have BOTH user comment AND metadata
        // Format: "User comment [MOOSE_METADATA:DO_NOT_MODIFY] {...}"

        // Check status column has user comment
        if (
          !ddl.includes(
            "Current status of the order - updates as order progresses",
          )
        ) {
          throw new Error(
            `Expected status enum column to have user comment 'Current status of the order - updates as order progresses'. DDL: ${ddl}`,
          );
        }

        // Check status column has metadata prefix (enum metadata)
        if (!ddl.includes("[MOOSE_METADATA:DO_NOT_MODIFY]")) {
          throw new Error(
            `Expected enum columns to have metadata prefix '[MOOSE_METADATA:DO_NOT_MODIFY]'. DDL: ${ddl}`,
          );
        }

        // Check priority column has user comment
        if (!ddl.includes("Priority level for fulfillment")) {
          throw new Error(
            `Expected priority enum column to have user comment 'Priority level for fulfillment'. DDL: ${ddl}`,
          );
        }

        // Verify both user comment and metadata are in the SAME column comment
        // Extract the status column's full comment from DDL
        // Use [\s\S] to match any character including newlines, and match up to COMMENT
        const statusCommentMatch = ddl.match(
          /`status`[^`]*COMMENT\s*'([^']+)'/,
        );
        if (!statusCommentMatch) {
          throw new Error(
            `Expected status column to have a COMMENT clause. DDL: ${ddl}`,
          );
        }

        const statusComment = statusCommentMatch[1];
        if (
          !statusComment.includes("Current status of the order") ||
          !statusComment.includes("[MOOSE_METADATA:DO_NOT_MODIFY]")
        ) {
          throw new Error(
            `Expected status column comment to contain BOTH user comment AND metadata. Got: '${statusComment}'`,
          );
        }

        // Verify metadata JSON round-trip: the JSON with quotes must survive
        // the SQL escaping/unescaping cycle through ClickHouse
        const metadataPrefix = "[MOOSE_METADATA:DO_NOT_MODIFY]";
        const metadataStart = statusComment.indexOf(metadataPrefix);
        if (metadataStart === -1) {
          throw new Error(
            `Metadata prefix not found in comment: '${statusComment}'`,
          );
        }

        const jsonPart = statusComment.substring(
          metadataStart + metadataPrefix.length,
        );
        let parsedMetadata: any;
        try {
          parsedMetadata = JSON.parse(jsonPart.trim());
        } catch (e) {
          throw new Error(
            `Metadata JSON failed to parse after round-trip through ClickHouse. ` +
              `This indicates quotes or special characters were corrupted. ` +
              `JSON: '${jsonPart}', Error: ${e}`,
          );
        }

        // Verify the parsed metadata has expected structure with enum values
        if (parsedMetadata.version !== 1) {
          throw new Error(
            `Expected metadata version 1, got: ${parsedMetadata.version}`,
          );
        }
        if (
          !parsedMetadata.enum ||
          !Array.isArray(parsedMetadata.enum.members)
        ) {
          throw new Error(
            `Expected metadata to contain enum.members array. Got: ${JSON.stringify(parsedMetadata)}`,
          );
        }

        // Verify enum values survived the round-trip (these contain quotes in JSON)
        const memberNames = parsedMetadata.enum.members.map((m: any) => m.name);
        const expectedMembers =
          config.language === "typescript" ?
            ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]
          : ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];

        for (const expected of expectedMembers) {
          if (!memberNames.includes(expected)) {
            throw new Error(
              `Expected enum member '${expected}' not found in metadata after round-trip. ` +
                `Found: ${memberNames.join(", ")}`,
            );
          }
        }

        testLogger.info(
          `✅ Enum column metadata safety validation passed for ${config.language}`,
        );
        testLogger.info(
          `✅ Metadata JSON round-trip verified - quotes and special chars preserved`,
        );
      }
    });

    // Add versioned tables test for tests templates
    if (config.isTestsVariant) {
      it("should create versioned OlapTables correctly", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Verify that both versions of UserEvents tables are created
        await verifyVersionedTables("UserEvents", ["1.0", "2.0"], "local");
      });

      it("should create table in non-default database when configured", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Wait for the analytics database and NonDefaultDbRecord table to be created
        // This tests that OlapTable with database="analytics" creates the table in the correct database
        await waitForDBWrite(
          devProcess!,
          "NonDefaultDbRecord",
          0,
          30_000,
          "analytics",
        );

        // Verify we can query the table in the analytics database (even if empty)
        const client = createClient(CLICKHOUSE_CONFIG);
        try {
          const result = await client.query({
            query: "SELECT count(*) as count FROM analytics.NonDefaultDbRecord",
            format: "JSONEachRow",
          });
          const rows: any[] = await result.json();
          console.log(
            "NonDefaultDbRecord table exists in analytics database, count:",
            rows[0].count,
          );
        } finally {
          await client.close();
        }
      });

      it("should insert data via OlapTable.insert() in consumer for both default and non-default databases", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        testLogger.info(
          "Sending trigger event for OlapTable.insert() consumer test...",
        );

        // Send a test event directly to the dedicated trigger stream
        const testEventId = randomUUID();
        const testPayload = {
          id: testEventId,
          value: 42,
        };

        const ingestUrl = `${SERVER_CONFIG.url}/ingest/olap-insert-test-trigger`;
        testLogger.info(`Sending test event to ${ingestUrl}...`);

        const response = await fetch(ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(testPayload),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to ingest test event: ${response.status} ${response.statusText}`,
          );
        }

        testLogger.info(
          "Test event sent successfully, waiting for consumer to process and insert...",
        );

        // Wait for the consumer to process and insert data into both tables
        // The consumer inserts with id prefix "default-{id}" and "analytics-{id}"
        const expectedDefaultId = `default-${testEventId}`;
        const expectedAnalyticsId = `analytics-${testEventId}`;

        // Verify insert to default database table
        await withRetries(
          async () => {
            const client = createClient(CLICKHOUSE_CONFIG);
            try {
              const result = await client.query({
                query: `SELECT * FROM OlapInsertTestTable WHERE id = '${expectedDefaultId}'`,
                format: "JSONEachRow",
              });
              const rows: any[] = await result.json();

              if (rows.length === 0) {
                throw new Error(
                  `Expected record with id '${expectedDefaultId}' in OlapInsertTestTable (default DB)`,
                );
              }

              const record = rows[0];
              if (record.source !== "consumer_default_db") {
                throw new Error(
                  `Expected source 'consumer_default_db', got '${record.source}'`,
                );
              }

              if (parseInt(record.value) !== 42) {
                throw new Error(`Expected value 42, got ${record.value}`);
              }

              testLogger.info(
                `✅ OlapTable.insert() verified in default database: ${JSON.stringify(record)}`,
              );
            } finally {
              await client.close();
            }
          },
          {
            attempts: 30,
            delayMs: 1000,
            operationName: "OlapTable.insert() to default database",
          },
        );

        // Verify insert to non-default database table
        await withRetries(
          async () => {
            const client = createClient(CLICKHOUSE_CONFIG);
            try {
              const result = await client.query({
                query: `SELECT * FROM analytics.OlapInsertTestNonDefaultTable WHERE id = '${expectedAnalyticsId}'`,
                format: "JSONEachRow",
              });
              const rows: any[] = await result.json();

              if (rows.length === 0) {
                throw new Error(
                  `Expected record with id '${expectedAnalyticsId}' in OlapInsertTestNonDefaultTable (analytics DB)`,
                );
              }

              const record = rows[0];
              if (record.source !== "consumer_non_default_db") {
                throw new Error(
                  `Expected source 'consumer_non_default_db', got '${record.source}'`,
                );
              }

              if (parseInt(record.value) !== 84) {
                throw new Error(
                  `Expected value 84 (42*2), got ${record.value}`,
                );
              }

              testLogger.info(
                `✅ OlapTable.insert() verified in non-default database: ${JSON.stringify(record)}`,
              );
            } finally {
              await client.close();
            }
          },
          {
            attempts: 30,
            delayMs: 1000,
            operationName: "OlapTable.insert() to non-default database",
          },
        );

        testLogger.info(
          "✅ OlapTable.insert() consumer test passed for both default and non-default databases",
        );
      });

      it("should create indexes defined in templates", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // TypeScript and Python tests both define an IndexTest / IndexTest table
        // Verify that all seven test indexes are present in the DDL
        await verifyTableIndexes(
          "IndexTest",
          ["idx1", "idx2", "idx3", "idx4", "idx5", "idx6", "idx7"],
          "local",
        );
      });

      it("should plan/apply index modifications on existing tables", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Modify a template file in place to change an index definition
        const modelPath = path.join(
          TEST_PROJECT_DIR,
          "src",
          "ingest",
          config.language === "typescript" ? "models.ts" : "models.py",
        );
        let contents = await fs.promises.readFile(modelPath, "utf8");

        contents = contents
          .replace("granularity: 3", "granularity: 4")
          .replace("granularity=3", "granularity=4");
        await fs.promises.writeFile(modelPath, contents, "utf8");

        // Verify DDL reflects updated index
        await withRetries(
          async () => {
            const ddl = await getTableDDL("IndexTest", "local");
            if (!ddl.includes("INDEX idx1") || !ddl.includes("GRANULARITY 4")) {
              throw new Error(`idx1 not updated to GRANULARITY 4. DDL: ${ddl}`);
            }
          },
          { attempts: 10, delayMs: 1000 },
        );
      });

      it("should create Buffer engine table correctly", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Wait for infrastructure to stabilize after previous test's file modification
        testLogger.info(
          "Waiting for streaming functions to stabilize after index modification...",
        );
        // Table modifications trigger cascading function restarts, so use longer timeout
        await waitForStreamingFunctions(180_000);

        // Wait for tables to be created after previous test's file modifications
        // Use fixed 1-second delays (no exponential backoff) to avoid long waits on failure
        const destinationDDL = await withRetries(
          async () => {
            return await getTableDDL("BufferDestinationTest", "local");
          },
          { attempts: 10, delayMs: 1000, backoffFactor: 1 },
        );
        testLogger.info(`Destination table DDL: ${destinationDDL}`);

        if (!destinationDDL.includes("ENGINE = MergeTree")) {
          throw new Error(
            `BufferDestinationTest should use MergeTree engine. DDL: ${destinationDDL}`,
          );
        }

        // Verify the Buffer table exists and has correct configuration
        const bufferDDL = await withRetries(
          async () => {
            return await getTableDDL("BufferTest", "local");
          },
          { attempts: 10, delayMs: 1000, backoffFactor: 1 },
        );
        testLogger.info(`Buffer table DDL: ${bufferDDL}`);

        // Check that it uses Buffer engine with correct parameters
        if (!bufferDDL.includes("ENGINE = Buffer")) {
          throw new Error(
            `BufferTest should use Buffer engine. DDL: ${bufferDDL}`,
          );
        }

        // Verify it points to the correct destination table
        if (!bufferDDL.includes("BufferDestinationTest")) {
          throw new Error(
            `BufferTest should reference BufferDestinationTest. DDL: ${bufferDDL}`,
          );
        }

        // Verify buffer parameters are present
        if (
          !bufferDDL.includes("16") ||
          !bufferDDL.includes("10") ||
          !bufferDDL.includes("100")
        ) {
          throw new Error(
            `BufferTest should have correct buffer parameters. DDL: ${bufferDDL}`,
          );
        }

        testLogger.info("✅ Buffer engine table created successfully");
      });

      it("should create Kafka engine table and consume data via MV", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        testLogger.info(
          "Waiting for Kafka table infrastructure to be ready...",
        );
        await waitForStreamingFunctions(180_000);

        const kafkaSourceDDL = await withRetries(
          async () => {
            return await getTableDDL(
              config.language === "typescript" ?
                "KafkaTestSource"
              : "kafka_test_source",
              "local",
            );
          },
          { attempts: 10, delayMs: 1000, backoffFactor: 1 },
        );
        testLogger.info(`Kafka source table DDL: ${kafkaSourceDDL}`);

        if (!kafkaSourceDDL.includes("ENGINE = Kafka")) {
          throw new Error(
            `KafkaTestSource should use Kafka engine. DDL: ${kafkaSourceDDL}`,
          );
        }

        if (!kafkaSourceDDL.includes("redpanda:9092")) {
          throw new Error(
            `Kafka table should have broker 'redpanda:9092'. DDL: ${kafkaSourceDDL}`,
          );
        }

        const destTableName =
          config.language === "typescript" ?
            "KafkaTestDest"
          : "kafka_test_dest";
        const kafkaDestDDL = await withRetries(
          async () => {
            return await getTableDDL(destTableName, "local");
          },
          { attempts: 10, delayMs: 1000, backoffFactor: 1 },
        );

        if (!kafkaDestDDL.includes("ENGINE = MergeTree")) {
          throw new Error(
            `${destTableName} should use MergeTree engine. DDL: ${kafkaDestDDL}`,
          );
        }

        const testEventId = randomUUID();
        const unixTimestamp = Math.floor(Date.now() / 1000);
        const testPayload = {
          eventId: testEventId,
          userId: "user-123",
          eventType: "purchase",
          amount: 99.99,
          timestamp: unixTimestamp,
        };
        const pythonPayload = {
          event_id: testEventId,
          user_id: "user-123",
          event_type: "purchase",
          amount: 99.99,
          timestamp: unixTimestamp,
        };

        await withRetries(
          async () => {
            const response = await fetch(
              `${SERVER_CONFIG.url}/ingest/kafka-test`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  config.language === "typescript" ?
                    testPayload
                  : pythonPayload,
                ),
              },
            );
            if (!response.ok) {
              const text = await response.text();
              throw new Error(`${response.status}: ${text}`);
            }
          },
          { attempts: 5, delayMs: 500 },
        );

        await waitForDBWrite(devProcess!, destTableName, 1, 120_000, "local");

        const idColumn =
          config.language === "typescript" ? "eventId" : "event_id";
        await verifyClickhouseData(
          destTableName,
          testEventId,
          idColumn,
          "local",
        );

        testLogger.info(
          "✅ Kafka engine table created and data flow verified successfully",
        );
      });

      it("should plan/apply TTL modifications on existing tables", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // First, verify initial TTL settings
        // Note: ClickHouse normalizes "INTERVAL N DAY" to "toIntervalDay(N)"
        await withRetries(
          async () => {
            const ddl = await getTableDDL("TTLTable");
            if (!/TTL timestamp \+ toIntervalDay\(90\)\s+SETTINGS/.test(ddl)) {
              throw new Error(`Initial table TTL not found. DDL: ${ddl}`);
            }
            if (
              !ddl.includes("`email` String TTL timestamp + toIntervalDay(30)")
            ) {
              throw new Error(`Initial column TTL not found. DDL: ${ddl}`);
            }
          },
          { attempts: 10, delayMs: 1000 },
        );

        // Modify the template file to change TTL settings
        const engineTestsPath = path.join(
          TEST_PROJECT_DIR,
          "src",
          "ingest",
          config.language === "typescript" ?
            "engineTests.ts"
          : "engine_tests.py",
        );
        let contents = await fs.promises.readFile(engineTestsPath, "utf8");

        // Update table-level TTL: 90 days -> 60 days
        // Update column-level TTL: 30 days -> 14 days
        if (config.language === "typescript") {
          contents = contents
            .replace(
              'ttl: "timestamp + INTERVAL 90 DAY DELETE"',
              'ttl: "timestamp + INTERVAL 60 DAY DELETE"',
            )
            .replace(
              'ClickHouseTTL<"timestamp + INTERVAL 30 DAY">',
              'ClickHouseTTL<"timestamp + INTERVAL 14 DAY">',
            );
        } else {
          contents = contents
            .replace(
              'ttl="timestamp + INTERVAL 90 DAY DELETE"',
              'ttl="timestamp + INTERVAL 60 DAY DELETE"',
            )
            .replace(
              'ClickHouseTTL("timestamp + INTERVAL 30 DAY")',
              'ClickHouseTTL("timestamp + INTERVAL 14 DAY")',
            );
        }
        await fs.promises.writeFile(engineTestsPath, contents, "utf8");

        // Verify DDL reflects updated TTL settings
        // Note: ClickHouse normalizes "INTERVAL N DAY" to "toIntervalDay(N)"
        await withRetries(
          async () => {
            const ddl = await getTableDDL("TTLTable");
            if (!/TTL timestamp \+ toIntervalDay\(60\)\s+SETTINGS/.test(ddl)) {
              throw new Error(`Table TTL not updated to 60 days. DDL: ${ddl}`);
            }
            if (
              !ddl.includes("`email` String TTL timestamp + toIntervalDay(14)")
            ) {
              throw new Error(`Column TTL not updated to 14 days. DDL: ${ddl}`);
            }
          },
          { attempts: 10, delayMs: 1000 },
        );
      });

      it("should plan/apply DEFAULT removal on existing tables", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Wait for infrastructure to stabilize after previous test's file modification
        testLogger.info(
          "Waiting for streaming functions to stabilize after TTL modification...",
        );
        // Table modifications trigger cascading function restarts, so use longer timeout
        await waitForStreamingFunctions(180_000);

        // First, verify initial DEFAULT settings
        await withRetries(
          async () => {
            const ddl = await getTableDDL("DefaultTable");
            if (!ddl.includes("`status` String DEFAULT 'pending'")) {
              throw new Error(`Initial status DEFAULT not found. DDL: ${ddl}`);
            }
            if (!ddl.includes("`count` UInt32 DEFAULT 0")) {
              throw new Error(`Initial count DEFAULT not found. DDL: ${ddl}`);
            }
          },
          { attempts: 10, delayMs: 1000 },
        );

        // Modify the template file to remove DEFAULT settings
        const engineTestsPath = path.join(
          TEST_PROJECT_DIR,
          "src",
          "ingest",
          config.language === "typescript" ?
            "engineTests.ts"
          : "engine_tests.py",
        );
        let contents = await fs.promises.readFile(engineTestsPath, "utf8");

        // Remove both DEFAULT annotations
        if (config.language === "typescript") {
          contents = contents
            .replace(
              "status: string & ClickHouseDefault<\"'pending'\">;",
              "status: string;",
            )
            .replace(
              'count: UInt32 & ClickHouseDefault<"0">;',
              "count: UInt32;",
            );
        } else {
          contents = contents
            .replace(
              "status: Annotated[str, clickhouse_default(\"'pending'\")]",
              "status: str",
            )
            .replace(
              'count: Annotated[int, clickhouse_default("0"), "uint32"]',
              'count: Annotated[int, "uint32"]',
            );
        }

        // Start listening for infrastructure changes before modifying the file
        const infrastructureChangesPromise = waitForInfrastructureChanges(
          devProcess!,
          60_000,
        );

        await fs.promises.writeFile(engineTestsPath, contents, "utf8");

        // Wait for infrastructure changes to complete before proceeding
        testLogger.info(
          "Waiting for infrastructure changes to complete after file modification...",
        );
        await infrastructureChangesPromise;
        testLogger.info("Infrastructure changes completed");

        // Wait for streaming functions to stabilize after restart
        // The infrastructure changes message fires before process restarts complete
        testLogger.info("Waiting for streaming functions to stabilize...");
        await waitForStreamingFunctions(180_000);
        testLogger.info("Streaming functions stabilized");

        // Verify DDL reflects removed DEFAULT settings
        await withRetries(
          async () => {
            const ddl = await getTableDDL("DefaultTable");
            if (ddl.includes("`status` String DEFAULT 'pending'")) {
              throw new Error(`DEFAULT not removed from status. DDL: ${ddl}`);
            }
            if (ddl.includes("`count` UInt32 DEFAULT 0")) {
              throw new Error(`DEFAULT not removed from count. DDL: ${ddl}`);
            }
            // Verify columns still exist without DEFAULT
            if (!ddl.includes("`status` String")) {
              throw new Error(`status column not found. DDL: ${ddl}`);
            }
            if (!ddl.includes("`count` UInt32")) {
              throw new Error(`count column not found. DDL: ${ddl}`);
            }
          },
          { attempts: 10, delayMs: 1000 },
        );
      });
    }

    // Create test case based on language
    if (config.language === "typescript") {
      it("should successfully ingest data and verify through consumption API (DateTime support)", async function () {
        // Wait for infrastructure to stabilize after previous test's file modification
        testLogger.info(
          "Waiting for streaming functions to stabilize after DEFAULT removal...",
        );
        // Table modifications trigger cascading function restarts, so use longer timeout
        await waitForStreamingFunctions(180_000);

        const eventId = randomUUID();

        // Send multiple records to trigger batch write
        const recordsToSend = TEST_DATA.BATCH_RECORD_COUNT;
        for (let i = 0; i < recordsToSend; i++) {
          await withRetries(
            async () => {
              const response = await fetch(`${SERVER_CONFIG.url}/ingest/Foo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  primaryKey: i === 0 ? eventId : randomUUID(),
                  timestamp: TEST_DATA.TIMESTAMP,
                  optionalText: `Hello world ${i}`,
                }),
              });
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
        }

        await waitForDBWrite(
          devProcess!,
          "Bar",
          recordsToSend,
          60_000,
          "local",
        );
        await verifyClickhouseData("Bar", eventId, "primaryKey", "local");

        await triggerWorkflow("generator");
        await waitForMaterializedViewUpdate(
          "BarAggregated",
          1,
          60_000,
          "local",
        );
        await verifyConsumptionApi(
          "bar?orderBy=totalRows&startDay=18&endDay=18&limit=1",
          [
            {
              // output_format_json_quote_64bit_integers is true by default in ClickHouse
              dayOfMonth: "18",
              totalRows: "1",
            },
          ],
        );

        // Test versioned API (V1)
        await verifyVersionedConsumptionApi(
          "bar/1?orderBy=totalRows&startDay=18&endDay=18&limit=1",
          [
            {
              dayOfMonth: "18",
              totalRows: "1",
              metadata: {
                version: "1.0",
                queryParams: {
                  orderBy: "totalRows",
                  limit: 1,
                  startDay: 18,
                  endDay: 18,
                },
              },
            },
          ],
        );

        // Verify consumer logs
        await verifyConsumerLogs(TEST_PROJECT_DIR, [
          "Received Foo event:",
          `Primary Key: ${eventId}`,
          "Optional Text: Hello world",
        ]);

        if (config.isTestsVariant) {
          await verifyConsumerLogs(TEST_PROJECT_DIR, [
            "from_http",
            "from_send",
          ]);
        }
      });
      if (config.isTestsVariant) {
        it("should verify sql helpers (join, raw, append) work correctly (TS)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // The sql-helpers-test API queries BarAggregatedMV which was populated by the generator workflow
          // in the previous test. It exercises sql.join(), sql.raw(), and Sql.append() from moose-lib.
          await verifyConsumptionApi("sql-helpers-test?minDay=1&maxDay=31", [
            {
              // The API selects dayOfMonth and totalRows from BarAggregated
              dayOfMonth: "placeholder",
              totalRows: "placeholder",
            },
          ]);

          // Also test with includeTimestamp=true to verify sql.raw("NOW()") works
          await withRetries(async () => {
            const response = await fetch(
              `${SERVER_CONFIG.url}/api/sql-helpers-test?minDay=1&maxDay=31&includeTimestamp=true`,
            );
            if (!response.ok) {
              const text = await response.text();
              throw new Error(
                `sql-helpers-test with includeTimestamp failed: ${response.status}: ${text}`,
              );
            }
            const json = (await response.json()) as any[];
            expect(json).to.be.an("array").that.is.not.empty;
            // When includeTimestamp=true, the response should include query_time from NOW()
            expect(json[0]).to.have.property("query_time");
          });
        });

        it("should create refreshable MVs with correct REFRESH configurations (TS)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Test 1: HourlyStats_MV - REFRESH EVERY 1 HOUR OFFSET 5 MINUTE
          const hourlyResult = await verifyMaterializedViewRefreshConfig(
            "HourlyStats_MV",
            {
              intervalType: "EVERY",
              intervalValue: 1,
              intervalUnit: "HOUR",
              offset: "5 MINUTE", // OFFSET is valid with EVERY
            },
            "local",
          );
          if (!hourlyResult.valid) {
            throw new Error(
              `HourlyStats_MV refresh config validation failed: ${hourlyResult.errors.join(", ")}`,
            );
          }

          // Test 2: DailyStats_MV - REFRESH AFTER 30 MINUTE (no offset - OFFSET only valid with EVERY)
          const dailyResult = await verifyMaterializedViewRefreshConfig(
            "DailyStats_MV",
            {
              intervalType: "AFTER",
              intervalValue: 30,
              intervalUnit: "MINUTE",
              // Note: No offset - OFFSET is only valid with REFRESH EVERY, not REFRESH AFTER
            },
            "local",
          );
          if (!dailyResult.valid) {
            throw new Error(
              `DailyStats_MV refresh config validation failed: ${dailyResult.errors.join(", ")}`,
            );
          }

          // Test 3: WeeklyRollup_MV - REFRESH EVERY 1 DAY DEPENDS ON DailyStats_MV APPEND
          const weeklyResult = await verifyMaterializedViewRefreshConfig(
            "WeeklyRollup_MV",
            {
              intervalType: "EVERY",
              intervalValue: 1,
              intervalUnit: "DAY",
              dependsOn: ["DailyStats_MV"],
              append: true,
            },
            "local",
          );
          if (!weeklyResult.valid) {
            throw new Error(
              `WeeklyRollup_MV refresh config validation failed: ${weeklyResult.errors.join(", ")}`,
            );
          }

          // Test 4: RandomizedStats_MV - REFRESH EVERY 5 MINUTE RANDOMIZE FOR 30 SECOND
          const randomizedResult = await verifyMaterializedViewRefreshConfig(
            "RandomizedStats_MV",
            {
              intervalType: "EVERY",
              intervalValue: 5,
              intervalUnit: "MINUTE",
              randomize: "30 SECOND",
            },
            "local",
          );
          if (!randomizedResult.valid) {
            throw new Error(
              `RandomizedStats_MV refresh config validation failed: ${randomizedResult.errors.join(", ")}`,
            );
          }

          // Test 5: IncrementalStats_MV - should NOT have REFRESH clause (incremental MV)
          const incrementalResult = await verifyIncrementalMaterializedView(
            "IncrementalStats_MV",
            "local",
          );
          if (!incrementalResult.valid) {
            throw new Error(
              `IncrementalStats_MV should be incremental (no REFRESH) but validation failed: ${incrementalResult.errors.join(", ")}`,
            );
          }
        });

        it("should ingest geometry types into a single GeoTypes table (TS)", async function () {
          const id = randomUUID();
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/GeoTypes`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(geoPayloadTs(id)),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
          await waitForDBWrite(devProcess!, "GeoTypes", 1, 60_000, "local");
          await verifyClickhouseData("GeoTypes", id, "id", "local");
        });

        it("should send array transform results as individual Kafka messages (TS)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const inputId = randomUUID();
          const testData = ["item1", "item2", "item3", "item4", "item5"];

          // Send one input record with an array in the data field
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/array-input`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: inputId,
                    data: testData,
                  }),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );

          // Wait for all output records to be written to the database
          await waitForDBWrite(
            devProcess!,
            "ArrayOutput",
            testData.length,
            60_000,
            "local",
            `inputId = '${inputId}'`,
          );

          // Verify that we have exactly 'testData.length' records in the output table
          await verifyClickhouseData(
            "ArrayOutput",
            inputId,
            "inputId",
            "local",
          );

          // Verify the count of records
          await verifyRecordCount(
            "ArrayOutput",
            `inputId = '${inputId}'`,
            testData.length,
            "local",
          );
        });

        it("should send large messages that exceed Kafka limit to DLQ (TS)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const largeMessageId = randomUUID();

          // Send a message that will generate ~2MB output (exceeds typical Kafka limit of 1MB)
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/LargeMessageInput`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: largeMessageId,
                    timestamp: new Date().toISOString(),
                    multiplier: 2, // Generate 2MB message
                  }),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );

          // Wait for the message to be sent to DLQ (not to the output table)
          await waitForDBWrite(
            devProcess!,
            "LargeMessageDeadLetter",
            1,
            60_000,
            "local",
          );

          // Verify the DLQ received the failed message with the correct metadata
          const clickhouse = createClient({
            url: CLICKHOUSE_CONFIG.url,
            username: CLICKHOUSE_CONFIG.username,
            password: CLICKHOUSE_CONFIG.password,
            database: CLICKHOUSE_CONFIG.database,
          });

          const result = await clickhouse.query({
            query: `SELECT * FROM local.LargeMessageDeadLetter WHERE originalRecord.id = '${largeMessageId}'`,
            format: "JSONEachRow",
          });

          const data = await result.json();

          if (data.length === 0) {
            throw new Error(
              `Expected to find DLQ record for id ${largeMessageId}`,
            );
          }

          const dlqRecord: any = data[0];

          // Verify DLQ record has the expected fields
          if (!dlqRecord.errorMessage) {
            throw new Error("Expected errorMessage in DLQ record");
          }

          if (!dlqRecord.errorType) {
            throw new Error("Expected errorType in DLQ record");
          }

          if (dlqRecord.source !== "transform") {
            throw new Error(
              `Expected source to be 'transform', got '${dlqRecord.source}'`,
            );
          }

          // Verify the error is related to message size
          if (
            !dlqRecord.errorMessage.toLowerCase().includes("too large") &&
            !dlqRecord.errorMessage.toLowerCase().includes("size")
          ) {
            testLogger.warn(
              `Warning: Error message might not be about size: ${dlqRecord.errorMessage}`,
            );
          }

          testLogger.info(
            `✅ Large message successfully sent to DLQ: ${dlqRecord.errorMessage}`,
          );

          // Verify that the large message did NOT make it to the output table
          const outputResult = await clickhouse.query({
            query: `SELECT COUNT(*) as count FROM local.LargeMessageOutput WHERE id = '${largeMessageId}'`,
            format: "JSONEachRow",
          });

          const outputData: any[] = await outputResult.json();
          const outputCount = parseInt(outputData[0].count);

          if (outputCount !== 0) {
            throw new Error(
              `Expected 0 records in output table, found ${outputCount}`,
            );
          }

          await clickhouse.close();
        });

        it("should include Consumption API in proxy health check (healthy)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Verify that the proxy health endpoint includes "Consumption API" in healthy list
          // Expected healthy services: Redis, ClickHouse, Redpanda, Consumption API
          await verifyProxyHealth([
            "Redis",
            "ClickHouse",
            "Redpanda",
            "Consumption API",
          ]);

          testLogger.info(
            "✅ Proxy health check correctly includes Consumption API",
          );
        });

        it("should have working internal health endpoint (/_moose_internal/health)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Verify the consumption API internal health endpoint works
          await verifyConsumptionApiInternalHealth();

          testLogger.info("✅ Internal health endpoint works correctly");
        });

        it("should serve WebApp at custom mountPath with Express framework", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Test Express WebApp health endpoint
          await verifyWebAppHealth("/express", "bar-express-api");

          // Test Express WebApp query endpoint (GET)
          await verifyWebAppQuery("/express/query", { limit: "5" });

          // Test Express WebApp data endpoint (POST)
          await verifyWebAppPostEndpoint(
            "/express/data",
            {
              orderBy: "totalRows",
              limit: 5,
              startDay: 1,
              endDay: 31,
            },
            200,
            (json) => {
              if (!json.success) {
                throw new Error("Expected success to be true");
              }
              if (!Array.isArray(json.data)) {
                throw new Error("Expected data to be an array");
              }
              if (json.params.orderBy !== "totalRows") {
                throw new Error("Expected orderBy to be totalRows");
              }
            },
          );
        });

        it("should serve WebApp at custom mountPath with Fastify framework", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Test Fastify WebApp health endpoint
          await verifyWebAppHealth("/fastify", "bar-fastify-api");

          // Test Fastify WebApp query endpoint (GET)
          await verifyWebAppQuery("/fastify/query", { limit: "5" });

          // Test Fastify WebApp data endpoint (POST)
          await verifyWebAppPostEndpoint(
            "/fastify/data",
            {
              orderBy: "totalRows",
              limit: 5,
              startDay: 1,
              endDay: 31,
            },
            200,
            (json) => {
              if (!json.success) {
                throw new Error("Expected success to be true");
              }
              if (!Array.isArray(json.data)) {
                throw new Error("Expected data to be an array");
              }
              if (json.params.orderBy !== "totalRows") {
                throw new Error("Expected orderBy to be totalRows");
              }
            },
          );
        });

        it("should handle multiple WebApp endpoints independently", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Verify Express WebApp is accessible
          await verifyWebAppEndpoint("/express/health", 200);

          // Verify Fastify WebApp is accessible
          await verifyWebAppEndpoint("/fastify/health", 200);

          // Verify regular Api endpoint still works alongside WebApp
          const apiResponse = await fetch(
            `${SERVER_CONFIG.url}/api/bar?orderBy=totalRows&startDay=1&endDay=31&limit=5`,
          );
          expect(apiResponse.ok).to.be.true;
          const apiData = await apiResponse.json();
          expect(apiData).to.be.an("array");
        });

        it("should serve MCP server at /tools with proper header forwarding", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Send an MCP tools/list request to verify the server is working
          // This tests that the proxy properly forwards response headers
          const mcpRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          };

          const response = await fetch(`${SERVER_CONFIG.url}/tools`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify(mcpRequest),
          });

          // Log response details for debugging
          if (!response.ok) {
            const errorText = await response.text();
            testLogger.error(
              `MCP request failed with status ${response.status}`,
            );
            testLogger.error(`Response body: ${errorText}`);
            throw new Error(
              `MCP request failed: ${response.status} ${response.statusText} - ${errorText}`,
            );
          }

          // Verify response status
          expect(response.ok).to.be.true;
          expect(response.status).to.equal(200);

          // Verify Content-Type header is present (this is what the fix ensures)
          const contentType = response.headers.get("content-type");
          expect(contentType).to.exist;
          expect(contentType).to.include("application/json");

          // Verify response is valid JSON-RPC
          const data = await response.json();
          expect(data).to.be.an("object");
          expect(data).to.have.property("jsonrpc", "2.0");
          expect(data).to.have.property("id", 1);

          // Verify the response contains tools
          expect(data).to.have.property("result");
          expect(data.result).to.have.property("tools");
          expect(data.result.tools).to.be.an("array");

          // Verify query_clickhouse tool is listed
          const queryTool = data.result.tools.find(
            (tool: any) => tool.name === "query_clickhouse",
          );
          expect(queryTool).to.exist;
          expect(queryTool).to.have.property("description");

          testLogger.info("✅ MCP server works correctly through proxy");
        });

        it("should create JSON table and accept extra fields in payload", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const id = randomUUID();
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/JsonTest`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id,
                    timestamp: new Date(TEST_DATA.TIMESTAMP * 1000),
                    payloadWithConfig: {
                      name: "alpha",
                      count: 3,
                      extraField: "allowed",
                      nested: { another: "field" },
                    },
                    payloadBasic: {
                      name: "beta",
                      count: 5,
                      anotherExtra: "also-allowed",
                    },
                  }),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );

          // DDL should show JSON types for both fields
          const ddl = await getTableDDL("JsonTest");
          const fieldName =
            config.language === "python" ?
              "payload_with_config"
            : "payloadWithConfig";
          const basicFieldName =
            config.language === "python" ? "payload_basic" : "payloadBasic";
          if (!ddl.includes(`\`${fieldName}\` JSON`)) {
            throw new Error(`JsonTest DDL missing JSON ${fieldName}: ${ddl}`);
          }
          if (!ddl.includes(`\`${basicFieldName}\` JSON`)) {
            throw new Error(
              `JsonTest DDL missing JSON ${basicFieldName}: ${ddl}`,
            );
          }

          await waitForDBWrite(devProcess!, "JsonTest", 1);

          // Verify row exists and payload is present
          const client = createClient(CLICKHOUSE_CONFIG);
          const result = await client.query({
            query: `SELECT id, getSubcolumn(${fieldName}, 'name') as name FROM JsonTest WHERE id = '${id}'`,
            format: "JSONEachRow",
          });
          const rows: any[] = await result.json();
          if (!rows.length || rows[0].name == null) {
            throw new Error("JSON payload not stored as expected");
          }
        });

        // Index signature test for TypeScript (ENG-1617)
        // Tests that IngestApi accepts payloads with extra fields when the type has an index signature.
        // Extra fields are passed through to streaming functions and stored in a JSON column.
        //
        // KEY CONCEPTS:
        // - IngestApi/Stream: CAN have index signatures (accept variable fields)
        // - OlapTable: CANNOT have index signatures (ClickHouse requires fixed schema)
        // - Transform: Receives ALL fields, outputs to fixed schema with JSON column for extras

        it("should pass extra fields to streaming function via index signature", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const userId = randomUUID();
          const timestamp = new Date().toISOString();

          // Send data with known fields plus arbitrary extra fields
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/userEventIngestApi`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    // Known fields defined in the type
                    timestamp: timestamp,
                    eventName: "page_view",
                    userId: userId,
                    orgId: "org-123",
                    // Extra fields - allowed by index signature, passed to streaming function
                    customProperty: "custom-value",
                    pageUrl: "/dashboard",
                    sessionDuration: 120,
                    nested: {
                      level1: "value1",
                      level2: { deep: "nested" },
                    },
                  }),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );

          // Wait for the transform to process and write to output table
          await waitForDBWrite(
            devProcess!,
            "UserEventOutput",
            1,
            60_000,
            "local",
            `userId = '${userId}'`,
          );

          // Verify the data was written correctly
          const client = createClient(CLICKHOUSE_CONFIG);
          const result = await client.query({
            query: `
              SELECT 
                userId,
                eventName,
                orgId,
                properties
              FROM local.UserEventOutput 
              WHERE userId = '${userId}'
            `,
            format: "JSONEachRow",
          });

          const rows: any[] = await result.json();
          await client.close();

          if (rows.length === 0) {
            throw new Error(
              `No data found in UserEventOutput for userId ${userId}`,
            );
          }

          const row = rows[0];

          // Verify known fields are correctly passed through
          if (row.eventName !== "page_view") {
            throw new Error(
              `Expected eventName to be 'page_view', got '${row.eventName}'`,
            );
          }
          if (row.orgId !== "org-123") {
            throw new Error(
              `Expected orgId to be 'org-123', got '${row.orgId}'`,
            );
          }

          // Verify extra fields are stored in the properties JSON column
          if (row.properties === undefined) {
            throw new Error("Expected properties JSON column to exist");
          }

          // Parse properties if it's a string (ClickHouse may return JSON as string)
          const properties =
            typeof row.properties === "string" ?
              JSON.parse(row.properties)
            : row.properties;

          // Verify extra fields were received by streaming function and stored in properties
          if (properties.customProperty !== "custom-value") {
            throw new Error(
              `Expected properties.customProperty to be 'custom-value', got '${properties.customProperty}'. Properties: ${JSON.stringify(properties)}`,
            );
          }
          if (properties.pageUrl !== "/dashboard") {
            throw new Error(
              `Expected properties.pageUrl to be '/dashboard', got '${properties.pageUrl}'`,
            );
          }
          // Note: ClickHouse JSON may return numbers as strings
          if (Number(properties.sessionDuration) !== 120) {
            throw new Error(
              `Expected properties.sessionDuration to be 120, got '${properties.sessionDuration}'`,
            );
          }
          if (
            !properties.nested ||
            properties.nested.level1 !== "value1" ||
            !properties.nested.level2 ||
            properties.nested.level2.deep !== "nested"
          ) {
            throw new Error(
              `Expected nested object to be preserved, got '${JSON.stringify(properties.nested)}'`,
            );
          }

          testLogger.info(
            "✅ Index signature test passed - extra fields received by streaming function and stored in properties column",
          );
        });

        // DateTime precision test for TypeScript
        it("should preserve microsecond precision with DateTime64String types via streaming transform", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const testId = randomUUID();
          const now = new Date();
          // Create ISO string with microseconds: 2024-01-15T10:30:00.123456Z
          const timestampWithMicroseconds = now
            .toISOString()
            .replace(/\.\d{3}Z$/, ".123456Z");
          // Nanoseconds
          const timestampWithNanoseconds = now
            .toISOString()
            .replace(/\.\d{3}Z$/, ".123456789Z");

          testLogger.info(
            `Testing DateTime precision with timestamp: ${timestampWithMicroseconds}`,
          );

          // Ingest to DateTimePrecisionInput (which has a transform to Output)
          const response = await fetch(
            `${SERVER_CONFIG.url}/ingest/DateTimePrecisionInput`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: testId,
                createdAt: now.toISOString(),
                timestampMs: now.toISOString(),
                timestampUsDate: timestampWithMicroseconds,
                timestampUsString: timestampWithMicroseconds,
                timestampNs: timestampWithNanoseconds,
                createdAtString: now.toISOString(),
              }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Failed to ingest DateTimePrecisionInput: ${response.status}: ${text}`,
            );
          }

          // Wait for transform to process and write to output table
          await waitForDBWrite(
            devProcess!,
            "DateTimePrecisionOutput",
            1,
            60_000,
            "local",
          );

          // Query the output data and verify precision
          const client = createClient(CLICKHOUSE_CONFIG);
          const result = await client.query({
            query: `
            SELECT 
              id,
              toString(createdAt) as createdAt,
              toString(timestampMs) as timestampMs,
              toString(timestampUsDate) as timestampUsDate,
              toString(timestampUsString) as timestampUsString,
              toString(timestampNs) as timestampNs,
              toString(createdAtString) as createdAtString
            FROM local.DateTimePrecisionOutput 
            WHERE id = '${testId}'
          `,
            format: "JSONEachRow",
          });

          const data: any[] = await result.json();

          if (data.length === 0) {
            throw new Error(
              `No data found for DateTimePrecisionOutput with id ${testId}`,
            );
          }

          const row = data[0];
          testLogger.info("Retrieved row:", row);

          // Verify that DateTime64String<6> preserves microseconds
          if (!row.timestampUsString.includes(".123456")) {
            throw new Error(
              `Expected timestampUsString to preserve microseconds (.123456), got: ${row.timestampUsString}`,
            );
          }

          // Verify that DateTime64String<9> preserves nanoseconds
          if (!row.timestampNs.includes(".123456789")) {
            throw new Error(
              `Expected timestampNs to preserve nanoseconds (.123456789), got: ${row.timestampNs}`,
            );
          }

          testLogger.info(
            "✅ DateTime precision test passed - microseconds preserved",
          );
        });
      }
    } else {
      it("should successfully ingest data and verify through consumption API", async function () {
        // Wait for infrastructure to stabilize after previous test's file modification
        testLogger.info(
          "Waiting for streaming functions to stabilize after DEFAULT removal...",
        );
        // Table modifications trigger cascading function restarts, so use longer timeout
        await waitForStreamingFunctions(180_000);

        const eventId = randomUUID();

        // Send multiple records to trigger batch write like typescript tests
        const recordsToSend = TEST_DATA.BATCH_RECORD_COUNT;
        for (let i = 0; i < recordsToSend; i++) {
          await withRetries(
            async () => {
              const response = await fetch(`${SERVER_CONFIG.url}/ingest/foo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  primary_key: i === 0 ? eventId : randomUUID(),
                  baz: "QUUX",
                  timestamp: TEST_DATA.TIMESTAMP,
                  optional_text:
                    i === 0 ? "Hello from Python" : `Test message ${i}`,
                }),
              });
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
        }

        await waitForDBWrite(
          devProcess!,
          "Bar",
          recordsToSend,
          60_000,
          "local",
        );
        await verifyClickhouseData("Bar", eventId, "primary_key", "local");

        await triggerWorkflow("generator");
        await waitForMaterializedViewUpdate(
          "bar_aggregated",
          1,
          60_000,
          "local",
        );
        await verifyConsumptionApi(
          "bar?order_by=total_rows&start_day=18&end_day=18&limit=1",
          [
            {
              day_of_month: 18,
              total_rows: 1,
              // Just verify structure - don't check exact values since generator adds random data
              // Similar to typescript test
            },
          ],
        );

        // Test versioned API (V1)
        await verifyVersionedConsumptionApi(
          "bar/1?order_by=total_rows&start_day=18&end_day=18&limit=1",
          [
            {
              day_of_month: 18,
              total_rows: 1,
              // Just verify structure - don't check exact values since generator adds random data
              // Similar to typescript test
              metadata: {
                version: "1.0",
                query_params: {
                  order_by: "total_rows",
                  limit: 1,
                  start_day: 18,
                  end_day: 18,
                },
              },
            },
          ],
        );

        // Verify consumer logs
        await verifyConsumerLogs(TEST_PROJECT_DIR, [
          "Received Foo event:",
          `Primary Key: ${eventId}`,
          "Optional Text: Hello from Python",
        ]);

        if (config.isTestsVariant) {
          await verifyConsumerLogs(TEST_PROJECT_DIR, [
            "from_http",
            "from_send",
          ]);
        }
      });
      if (config.isTestsVariant) {
        it("should ingest geometry types into a single GeoTypes table (PY)", async function () {
          const id = randomUUID();
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/geotypes`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(geoPayloadPy(id)),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
          await waitForDBWrite(devProcess!, "GeoTypes", 1, 60_000, "local");
          await verifyClickhouseData("GeoTypes", id, "id", "local");
        });

        it("should send array transform results as individual Kafka messages (PY)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const inputId = randomUUID();
          const testData = ["item1", "item2", "item3", "item4", "item5"];

          // Send one input record with an array in the data field
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/arrayinput`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: inputId,
                    data: testData,
                  }),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );

          // Wait for all output records to be written to the database
          await waitForDBWrite(
            devProcess!,
            "ArrayOutput",
            testData.length,
            60_000,
            "local",
            `input_id = '${inputId}'`,
          );

          // Verify that we have exactly 'testData.length' records in the output table
          await verifyClickhouseData(
            "ArrayOutput",
            inputId,
            "input_id",
            "local",
          );

          // Verify the count of records
          await verifyRecordCount(
            "ArrayOutput",
            `input_id = '${inputId}'`,
            testData.length,
            "local",
          );
        });

        it("should serve WebApp at custom mountPath with FastAPI framework", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Test FastAPI WebApp health endpoint
          await verifyWebAppHealth("/fastapi", "bar-fastapi-api");

          // Test FastAPI WebApp query endpoint (GET)
          await verifyWebAppQuery("/fastapi/query", { limit: "5" });

          // Test FastAPI WebApp data endpoint (POST)
          await verifyWebAppPostEndpoint(
            "/fastapi/data",
            {
              order_by: "total_rows",
              limit: 5,
              start_day: 1,
              end_day: 31,
            },
            200,
            (json) => {
              if (!json.success) {
                throw new Error("Expected success to be true");
              }
              if (!Array.isArray(json.data)) {
                throw new Error("Expected data to be an array");
              }
              if (json.params.order_by !== "total_rows") {
                throw new Error("Expected order_by to be total_rows");
              }
            },
          );
        });

        it("should serve OpenAPI documentation for FastAPI WebApp", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Test OpenAPI JSON schema endpoint
          await verifyWebAppEndpoint("/fastapi/openapi.json", 200, (json) => {
            if (!json.openapi) {
              throw new Error(
                "Expected OpenAPI schema to have 'openapi' field",
              );
            }
            if (!json.info) {
              throw new Error("Expected OpenAPI schema to have 'info' field");
            }
            if (!json.paths) {
              throw new Error("Expected OpenAPI schema to have 'paths' field");
            }
            // Verify that paths include the mount_path prefix
            const paths = Object.keys(json.paths);
            if (paths.length === 0) {
              throw new Error(
                "Expected OpenAPI schema to have at least one path",
              );
            }
            // Check that at least one path includes /health (should be /fastapi/health or just /health)
            const hasHealthPath = paths.some((p) => p.includes("/health"));
            if (!hasHealthPath) {
              throw new Error(
                `Expected OpenAPI schema to include /health path. Found paths: ${paths.join(", ")}`,
              );
            }
          });

          // Test interactive docs endpoint (Swagger UI)
          await verifyWebAppEndpoint("/fastapi/docs", 200, undefined);
        });

        it("should handle multiple WebApp endpoints independently (PY)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Verify FastAPI WebApp is accessible
          await verifyWebAppEndpoint("/fastapi/health", 200);

          // Verify regular Api endpoint still works alongside WebApp
          const apiResponse = await fetch(
            `${SERVER_CONFIG.url}/api/bar?order_by=total_rows&start_day=1&end_day=31&limit=5`,
          );
          expect(apiResponse.ok).to.be.true;
          const apiData = await apiResponse.json();
          expect(apiData).to.be.an("array");
        });

        // Extra fields test for Python (ENG-1617)
        // Tests that IngestApi accepts payloads with extra fields when the model has extra='allow'.
        // Extra fields are passed through to streaming functions and stored in a JSON column.
        //
        // KEY CONCEPTS:
        // - IngestApi/Stream with extra='allow': CAN accept variable fields
        // - OlapTable: Requires fixed schema (ClickHouse needs to know columns)
        // - Transform: Receives ALL fields via model_extra, outputs to fixed schema with JSON column
        it("should pass extra fields to streaming function via Pydantic extra='allow' (PY)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const userId = randomUUID();
          const timestamp = new Date().toISOString();

          // Send data with known fields plus arbitrary extra fields
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/userEventIngestApi`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    // Known fields defined in the model (snake_case for Python)
                    timestamp: timestamp,
                    event_name: "page_view",
                    user_id: userId,
                    org_id: "org-123",
                    // Extra fields - allowed by extra='allow', passed to streaming function
                    customProperty: "custom-value",
                    pageUrl: "/dashboard",
                    sessionDuration: 120,
                    nested: {
                      level1: "value1",
                      level2: { deep: "nested" },
                    },
                  }),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );

          // Wait for the transform to process and write to output table
          await waitForDBWrite(
            devProcess!,
            "UserEventOutput",
            1,
            60_000,
            "local",
            `user_id = '${userId}'`,
          );

          // Verify the data was written correctly
          const client = createClient(CLICKHOUSE_CONFIG);
          const result = await client.query({
            query: `
              SELECT 
                user_id,
                event_name,
                org_id,
                properties
              FROM local.UserEventOutput 
              WHERE user_id = '${userId}'
            `,
            format: "JSONEachRow",
          });

          const rows: any[] = await result.json();
          await client.close();

          if (rows.length === 0) {
            throw new Error(
              `No data found in UserEventOutput for user_id ${userId}`,
            );
          }

          const row = rows[0];

          // Verify known fields are correctly passed through (snake_case for Python)
          if (row.event_name !== "page_view") {
            throw new Error(
              `Expected event_name to be 'page_view', got '${row.event_name}'`,
            );
          }
          if (row.org_id !== "org-123") {
            throw new Error(
              `Expected org_id to be 'org-123', got '${row.org_id}'`,
            );
          }

          // Verify extra fields are stored in the properties JSON column
          if (row.properties === undefined) {
            throw new Error("Expected properties JSON column to exist");
          }

          // Parse properties if it's a string (ClickHouse may return JSON as string)
          const properties =
            typeof row.properties === "string" ?
              JSON.parse(row.properties)
            : row.properties;

          // Verify extra fields were received by streaming function via model_extra
          if (properties.customProperty !== "custom-value") {
            throw new Error(
              `Expected properties.customProperty to be 'custom-value', got '${properties.customProperty}'. Properties: ${JSON.stringify(properties)}`,
            );
          }
          if (properties.pageUrl !== "/dashboard") {
            throw new Error(
              `Expected properties.pageUrl to be '/dashboard', got '${properties.pageUrl}'`,
            );
          }
          // Note: ClickHouse JSON may return numbers as strings
          if (Number(properties.sessionDuration) !== 120) {
            throw new Error(
              `Expected properties.sessionDuration to be 120, got '${properties.sessionDuration}'`,
            );
          }
          if (
            !properties.nested ||
            properties.nested.level1 !== "value1" ||
            !properties.nested.level2 ||
            properties.nested.level2.deep !== "nested"
          ) {
            throw new Error(
              `Expected nested object to be preserved, got '${JSON.stringify(properties.nested)}'`,
            );
          }

          testLogger.info(
            "✅ Extra fields test passed (Python) - extra fields received by streaming function via model_extra and stored in properties column",
          );
        });

        // DateTime precision test for Python
        it("should preserve microsecond precision with clickhouse_datetime64 annotations via streaming transform (PY)", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          const testId = randomUUID();
          const now = new Date();
          // Create ISO string with microseconds: 2024-01-15T10:30:00.123456Z
          const timestampWithMicroseconds = now
            .toISOString()
            .replace(/\.\d{3}Z$/, ".123456Z");
          // Nanoseconds
          const timestampWithNanoseconds = now
            .toISOString()
            .replace(/\.\d{3}Z$/, ".123456789Z");

          testLogger.info(
            `Testing DateTime precision (Python) with timestamp: ${timestampWithMicroseconds}`,
          );

          const payload = {
            id: testId,
            created_at: now.toISOString(),
            timestamp_ms: timestampWithMicroseconds,
            timestamp_us: timestampWithMicroseconds,
            timestamp_ns: timestampWithNanoseconds,
          };
          testLogger.info("Sending payload:", JSON.stringify(payload, null, 2));

          // Ingest to DateTimePrecisionInput (which has a transform to Output)
          const response = await fetch(
            `${SERVER_CONFIG.url}/ingest/datetimeprecisioninput`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Failed to ingest DateTimePrecisionInput (Python): ${response.status}: ${text}`,
            );
          }

          // Wait for transform to process and write to output table
          await waitForDBWrite(
            devProcess!,
            "DateTimePrecisionOutput",
            1,
            60_000,
            "local",
          );

          // Query the output data and verify precision
          const client = createClient(CLICKHOUSE_CONFIG);
          const result = await client.query({
            query: `
              SELECT 
                id,
                toString(created_at) as created_at,
                toString(timestamp_ms) as timestamp_ms,
                toString(timestamp_us) as timestamp_us,
                toString(timestamp_ns) as timestamp_ns
              FROM local.DateTimePrecisionOutput 
              WHERE id = '${testId}'
            `,
            format: "JSONEachRow",
          });

          const data: any[] = await result.json();

          if (data.length === 0) {
            throw new Error(
              `No data found for DateTimePrecisionOutput (Python) with id ${testId}`,
            );
          }

          const row = data[0];
          testLogger.info(
            "Retrieved row (Python):",
            JSON.stringify(row, null, 2),
          );

          // Verify that datetime with clickhouse_datetime64(6) preserves microseconds
          if (!row.timestamp_us.includes(".123456")) {
            throw new Error(
              `Expected timestamp_us to preserve microseconds (.123456), got: ${row.timestamp_us}`,
            );
          }

          // Note: Python datetime truncates nanoseconds to microseconds, so we expect .123456 not .123456789
          // Log if nanoseconds were truncated (expected behavior)
          if (row.timestamp_ns.includes(".123456789")) {
            testLogger.info(
              "✅ Nanoseconds preserved in ClickHouse:",
              row.timestamp_ns,
            );
          } else if (row.timestamp_ns.includes(".123456")) {
            testLogger.info(
              "⚠️  Nanoseconds truncated to microseconds (expected Python behavior):",
              row.timestamp_ns,
            );
          } else {
            testLogger.info(
              "❌ No sub-second precision found in timestamp_ns:",
              row.timestamp_ns,
            );
            throw new Error(
              `Expected timestamp_ns to have at least microseconds (.123456), got: ${row.timestamp_ns}`,
            );
          }

          testLogger.info(
            "✅ DateTime precision test passed (Python) - microseconds preserved",
          );
        });
      }
    }
  });
};

describe("Moose Templates", () => {
  // Generate test suites for all template configurations
  TEMPLATE_CONFIGS.forEach(createTemplateTestSuite);
});

// Global setup to clean Docker state from previous runs (useful for local dev)
// Github hosted runners start with a clean slate.
before(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  await performGlobalCleanup(
    "Running global setup - cleaning Docker state from previous runs...",
  );
});

// Global cleanup to ensure no hanging processes
after(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  await performGlobalCleanup();
});
