/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for moose migrate command using nested moose structure
 *
 * Structure:
 * - Outer moose app (typescript-migrate-test/) starts infrastructure only
 * - Inner moose app (typescript-migrate-test/migration/) runs migration CLI commands
 *
 * This tests the serverless/OLAP-only migration flow where:
 * 1. Infrastructure is already running (ClickHouse + Keeper)
 * 2. User runs `moose generate migration` to create migration plan
 * 3. User runs `moose migrate` to apply the plan
 * 4. State is stored in ClickHouse (not Redis)
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient } from "@clickhouse/client";

// Import constants and utilities
import { TIMEOUTS, CLICKHOUSE_CONFIG, SERVER_CONFIG } from "./constants";

import {
  waitForServerStart,
  cleanupClickhouseData,
  createTempTestDirectory,
  cleanupTestSuite,
  logger,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../templates/typescript-migrate-test",
);

const testLogger = logger.scope("migration-test");

// Build ClickHouse connection URL for migration commands
const CLICKHOUSE_URL = `http://${CLICKHOUSE_CONFIG.username}:${CLICKHOUSE_CONFIG.password}@localhost:18123/${CLICKHOUSE_CONFIG.database}`;

describe("typescript template tests - migration", () => {
  let outerMooseProcess: ChildProcess;
  let testProjectDir: string;
  let outerMooseDir: string;
  let innerMooseDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("\n=== Starting Migration Tests ===");

    testProjectDir = createTempTestDirectory("ts-migrate");
    outerMooseDir = testProjectDir;
    innerMooseDir = path.join(testProjectDir, "migration");

    testLogger.info("Test project dir:", testProjectDir);
    testLogger.info("Outer moose dir:", outerMooseDir);
    testLogger.info("Inner moose dir:", innerMooseDir);

    // Copy template structure to temp directory
    testLogger.info("\nCopying template to temp directory...");
    fs.cpSync(TEMPLATE_SOURCE_DIR, testProjectDir, { recursive: true });
    testLogger.info("✓ Template copied");

    // Update package.json files to use local moose-lib
    testLogger.info("\nUpdating package.json to use local moose-lib...");
    const outerPackageJsonPath = path.join(outerMooseDir, "package.json");
    const outerPackageJson = JSON.parse(
      fs.readFileSync(outerPackageJsonPath, "utf-8"),
    );
    outerPackageJson.dependencies["@514labs/moose-lib"] =
      `file:${MOOSE_LIB_PATH}`;
    fs.writeFileSync(
      outerPackageJsonPath,
      JSON.stringify(outerPackageJson, null, 2),
    );

    const innerPackageJsonPath = path.join(innerMooseDir, "package.json");
    const innerPackageJson = JSON.parse(
      fs.readFileSync(innerPackageJsonPath, "utf-8"),
    );
    innerPackageJson.dependencies["@514labs/moose-lib"] =
      `file:${MOOSE_LIB_PATH}`;
    fs.writeFileSync(
      innerPackageJsonPath,
      JSON.stringify(innerPackageJson, null, 2),
    );
    testLogger.info("✓ package.json updated");

    // Install dependencies for outer moose app
    testLogger.info("\nInstalling dependencies for outer moose app...");
    await execAsync("npm install", { cwd: outerMooseDir });
    testLogger.info("✓ Dependencies installed");

    // Install dependencies for inner moose app
    testLogger.info("\nInstalling dependencies for inner moose app...");
    await execAsync("npm install", { cwd: innerMooseDir });
    testLogger.info("✓ Dependencies installed");

    // Start outer moose dev (just for infrastructure - ClickHouse + Keeper)
    testLogger.info("\nStarting outer moose dev for infrastructure...");
    outerMooseProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: outerMooseDir,
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
      },
    });

    // Wait for moose dev to start (ClickHouse ready)
    await waitForServerStart(
      outerMooseProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
    );

    testLogger.info("✓ Infrastructure ready (ClickHouse + Keeper running)");

    // Clean up any existing test tables
    await cleanupClickhouseData();
    testLogger.info("✓ ClickHouse cleaned");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("\n=== Cleaning up Migration Tests ===");
    await cleanupTestSuite(outerMooseProcess, outerMooseDir, "ts-migrate", {
      logPrefix: "Migration Tests",
    });
  });

  describe("First-time migration (Happy Path)", () => {
    it("should generate migration plan from code", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      testLogger.info("\n--- Generating migration plan ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --save`,
        {
          cwd: innerMooseDir,
        },
      );

      testLogger.info("Generate migration output:", stdout);

      // Verify migration files were created
      const migrationsDir = path.join(innerMooseDir, "migrations");
      expect(fs.existsSync(migrationsDir)).to.be.true;

      // Migration files are stored directly in migrations/ directory
      const planPath = path.join(migrationsDir, "plan.yaml");
      const remoteStatePath = path.join(migrationsDir, "remote_state.json");
      const localInfraMapPath = path.join(
        migrationsDir,
        "local_infra_map.json",
      );

      expect(fs.existsSync(planPath)).to.be.true;
      expect(fs.existsSync(remoteStatePath)).to.be.true;
      expect(fs.existsSync(localInfraMapPath)).to.be.true;

      const planContent = fs.readFileSync(planPath, "utf-8");
      testLogger.info("Migration plan content:", planContent);

      expect(planContent).to.include("operations:");
      testLogger.info("✓ Migration plan generated");
    });

    it("should apply migration plan and create tables", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      testLogger.info("\n--- Applying migration ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
        {
          cwd: innerMooseDir,
        },
      );

      testLogger.info("Migrate output:", stdout);

      // Verify tables were created in ClickHouse
      const client = createClient(CLICKHOUSE_CONFIG);

      const result = await client.query({
        query: "SHOW TABLES",
        format: "JSONEachRow",
      });

      const tables: any[] = await result.json();
      testLogger.info(
        "Tables in ClickHouse:",
        tables.map((t) => t.name),
      );

      // Should have the tables from the inner moose app
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).to.include("Bar");
      expect(tableNames).to.include("BarAggregated");

      // Verify state was stored in ClickHouse
      expect(tableNames).to.include("_MOOSE_STATE");

      const stateData = await client.query({
        query:
          "SELECT * FROM _MOOSE_STATE WHERE key LIKE 'infra_map_%' ORDER BY created_at DESC LIMIT 1",
        format: "JSONEachRow",
      });

      const stateRows: any[] = await stateData.json();
      expect(stateRows.length).to.be.greaterThan(0);

      testLogger.info("✓ Migration applied successfully");
      testLogger.info("✓ State saved to _MOOSE_STATE");
    });
  });

  describe("Drift detection", () => {
    it("should detect drift when database is modified between plan generation and execution", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      testLogger.info("\n--- Testing drift detection ---");

      // IMPORTANT: Stop outer moose dev before this test to prevent interference.
      // The outer dev and inner app share the same _MOOSE_STATE table, which causes
      // the outer dev to drop tables when it syncs (since it has no models defined).
      // The Docker containers (ClickHouse, etc.) will keep running.
      testLogger.info("Stopping outer moose dev to prevent state conflicts...");
      if (outerMooseProcess && !outerMooseProcess.killed) {
        outerMooseProcess.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        testLogger.info(
          "✓ Outer moose dev stopped (Docker containers still running)",
        );
      }

      // First, ensure tables exist by generating and applying initial migration
      // (This makes the test self-contained and not dependent on previous tests)
      testLogger.info("Setting up initial state...");

      // Check if tables already exist (from previous tests)
      const client = createClient(CLICKHOUSE_CONFIG);
      const tablesCheck = await client.query({
        query: "SHOW TABLES",
        format: "JSONEachRow",
      });
      const existingTables: any[] = await tablesCheck.json();
      const tableNames = existingTables.map((t: any) => t.name);

      if (!tableNames.includes("Bar")) {
        testLogger.info("Tables don't exist, creating initial migration...");
        // Generate initial migration plan
        const genResult = await execAsync(
          `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --save`,
          {
            cwd: innerMooseDir,
          },
        );
        testLogger.info("Generate output:", genResult.stdout);
        // Apply it to create the tables
        const migrateResult = await execAsync(
          `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
          {
            cwd: innerMooseDir,
          },
        );
        testLogger.info("Migrate output:", migrateResult.stdout);

        // Verify tables were created
        const tablesAfter = await client.query({
          query: "SHOW TABLES",
          format: "JSONEachRow",
        });
        const tablesAfterList: any[] = await tablesAfter.json();
        testLogger.info(
          "Tables after initial migration:",
          tablesAfterList.map((t: any) => t.name),
        );

        testLogger.info("✓ Initial tables created");
      } else {
        testLogger.info("✓ Tables already exist from previous tests");
      }

      // Now generate a NEW migration plan (should be empty since tables match code)
      // This captures the current DB state as "expected"
      testLogger.info("Generating migration plan...");

      await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --save`,
        {
          cwd: innerMooseDir,
        },
      );
      testLogger.info("✓ Migration plan generated");

      // NOW manually modify the database BEFORE applying the migration
      testLogger.info("Manually modifying database to create drift...");

      await client.command({
        query: `ALTER TABLE ${CLICKHOUSE_CONFIG.database}.Bar ADD COLUMN drift_column String`,
      });
      testLogger.info("✓ Added drift_column to Bar table");

      // Try to apply the migration - should fail due to drift
      // The plan's "expected state" doesn't include drift_column, but current DB does
      testLogger.info(
        "Attempting to apply migration (should fail due to drift)...",
      );
      try {
        await execAsync(
          `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
          {
            cwd: innerMooseDir,
          },
        );

        // If we get here, the migration didn't fail - that's unexpected
        expect.fail("Migration should have failed due to drift");
      } catch (error: any) {
        // Expected to fail - check that it's a drift error, not some other error
        testLogger.info("Migration failed as expected:", error.message);

        // The error should contain the drift detection message
        const errorOutput = error.message + (error.stderr || "");
        expect(errorOutput).to.include(
          "The database state has changed since the migration plan was generated",
        );

        testLogger.info("✓ Drift detected correctly");
      }
    });
  });
});
