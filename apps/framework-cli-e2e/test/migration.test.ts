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

// Import constants and utilities
import { TIMEOUTS, CLICKHOUSE_CONFIG, SERVER_CONFIG } from "./constants";

import {
  stopDevProcess,
  waitForServerStart,
  cleanupClickhouseData,
  cleanupDocker,
  createClickHouseClient,
  createTempTestDirectory,
  removeTestProject,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../templates/typescript-migrate-test",
);

// Build ClickHouse connection URL for migration commands
const CLICKHOUSE_URL = `http://${CLICKHOUSE_CONFIG.username}:${CLICKHOUSE_CONFIG.password}@localhost:18123/${CLICKHOUSE_CONFIG.database}`;

describe("typescript template tests - migration", () => {
  let outerMooseProcess: ChildProcess;
  let testProjectDir: string;
  let outerMooseDir: string;
  let innerMooseDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    console.log("\n=== Starting Migration Tests ===");

    testProjectDir = createTempTestDirectory("ts-migrate");
    outerMooseDir = testProjectDir;
    innerMooseDir = path.join(testProjectDir, "migration");

    console.log("Test project dir:", testProjectDir);
    console.log("Outer moose dir:", outerMooseDir);
    console.log("Inner moose dir:", innerMooseDir);

    // Copy template structure to temp directory
    console.log("\nCopying template to temp directory...");
    fs.cpSync(TEMPLATE_SOURCE_DIR, testProjectDir, { recursive: true });
    console.log("✓ Template copied");

    // Install dependencies for outer moose app
    console.log("\nInstalling dependencies for outer moose app...");
    await execAsync("npm install", { cwd: outerMooseDir });
    console.log("✓ Dependencies installed");

    // Install dependencies for inner moose app
    console.log("\nInstalling dependencies for inner moose app...");
    await execAsync("npm install", { cwd: innerMooseDir });
    console.log("✓ Dependencies installed");

    // Start outer moose dev (just for infrastructure - ClickHouse + Keeper)
    console.log("\nStarting outer moose dev for infrastructure...");
    outerMooseProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: outerMooseDir,
      env: process.env,
    });

    // Wait for moose dev to start (ClickHouse ready)
    await waitForServerStart(
      outerMooseProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
    );

    console.log("✓ Infrastructure ready (ClickHouse + Keeper running)");

    // Clean up any existing test tables
    await cleanupClickhouseData();
    console.log("✓ ClickHouse cleaned");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    console.log("\n=== Cleaning up Migration Tests ===");

    try {
      // Stop the moose dev process
      if (outerMooseProcess) {
        await stopDevProcess(outerMooseProcess);
        console.log("✓ Outer moose dev stopped");
      }

      // Clean up Docker containers and volumes
      await cleanupDocker(outerMooseDir, "ts-migrate");
      console.log("✓ Docker resources cleaned");

      // Remove the entire temp directory (includes migration files, node_modules, etc.)
      removeTestProject(testProjectDir);
      console.log("✓ Test project directory removed");
    } catch (error) {
      console.error("Error during cleanup:", error);
      // Force kill process if cleanup fails
      try {
        if (outerMooseProcess && !outerMooseProcess.killed) {
          outerMooseProcess.kill("SIGKILL");
        }
      } catch (killError) {
        console.warn("Failed to force kill process:", killError);
      }
    }
  });

  describe("First-time migration (Happy Path)", () => {
    it("should generate migration plan from code", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Generating migration plan ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --save`,
        {
          cwd: innerMooseDir,
        },
      );

      console.log("Generate migration output:", stdout);

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
      console.log("Migration plan content:", planContent);

      expect(planContent).to.include("operations:");
      console.log("✓ Migration plan generated");
    });

    it("should apply migration plan and create tables", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Applying migration ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
        {
          cwd: innerMooseDir,
        },
      );

      console.log("Migrate output:", stdout);

      // Verify tables were created in ClickHouse
      const client = createClickHouseClient();

      const result = await client.query({
        query: "SHOW TABLES",
        format: "JSONEachRow",
      });

      const tables: any[] = await result.json();
      console.log(
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

      console.log("✓ Migration applied successfully");
      console.log("✓ State saved to _MOOSE_STATE");
    });
  });

  describe("Drift detection", () => {
    it("should detect drift when database is modified between plan generation and execution", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing drift detection ---");

      // Generate migration plan (captures current DB state as "expected")
      console.log("Generating migration plan...");
      await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --save`,
        {
          cwd: innerMooseDir,
        },
      );
      console.log("✓ Migration plan generated");

      // NOW manually modify the database BEFORE applying the migration
      console.log("Manually modifying database to create drift...");
      const client = createClickHouseClient();
      await client.command({
        query: "ALTER TABLE Bar ADD COLUMN drift_column String",
      });
      console.log("✓ Added drift_column to Bar table");

      // Try to apply the migration - should fail due to drift
      // The plan's "expected state" doesn't include drift_column, but current DB does
      console.log(
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
        console.log("Migration failed as expected:", error.message);

        // The error should contain the drift detection message
        const errorOutput = error.message + (error.stderr || "");
        expect(errorOutput).to.include(
          "The database state has changed since the migration plan was generated",
        );

        console.log("✓ Drift detected correctly");
      }
    });
  });
});
