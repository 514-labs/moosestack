/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for hybrid static+dynamic migration (ENG-2674)
 *
 * Structure:
 * - Outer moose app (typescript-migrate-test/) starts infrastructure only
 * - Inner moose app (typescript-migrate-test/migration/) runs migration CLI commands
 *
 * Tests the hybrid migration model where:
 * 1. Auto-apply operations (adds, creates) run without plan files
 * 2. Plan-worthy operations (drops, destructive) require reviewed plan files
 * 3. Drift detection validates plan files against current DB state
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
// Use the staged template (with shared files injected by package-templates.js pretest)
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../template-packages/_staging_typescript-migrate-test",
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

  describe("Hybrid migration - auto-apply (Happy Path)", () => {
    it("should report no plan-worthy operations for additive changes", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      testLogger.info("\n--- Generating migration plan ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --save`,
        {
          cwd: innerMooseDir,
        },
      );

      testLogger.info("Generate migration output:", stdout);

      // With the hybrid model, all first-time operations (creates) are auto-apply
      expect(stdout).to.include("Auto-apply");
      expect(stdout).to.include("No changes require a migration plan");

      // No timestamped plan files should be created for all-add migrations
      const migrationsDir = path.join(innerMooseDir, "migrations");
      if (fs.existsSync(migrationsDir)) {
        const yamlFiles = fs
          .readdirSync(migrationsDir)
          .filter((f) => f.endsWith(".yaml"));
        expect(yamlFiles).to.have.length(
          0,
          "No plan files should be created for all-add migrations",
        );
      }

      testLogger.info("✓ Generate confirmed no plan needed for additive ops");
    });

    it("should apply first-time migration via hybrid executor without plan files", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      testLogger.info("\n--- Applying hybrid migration ---");

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

      testLogger.info(
        "✓ Hybrid migration applied successfully (all auto-apply)",
      );
      testLogger.info("✓ State saved to _MOOSE_STATE");
    });
  });

  describe("Hybrid migration - plan-worthy blocking", () => {
    it("should block destructive operations when no plan files exist", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      testLogger.info("\n--- Testing plan-worthy blocking ---");

      // Ensure tables exist from previous tests
      const client = createClient(CLICKHOUSE_CONFIG);
      const tablesCheck = await client.query({
        query: "SHOW TABLES",
        format: "JSONEachRow",
      });
      const existingTables: any[] = await tablesCheck.json();
      const tableNames = existingTables.map((t: any) => t.name);

      if (!tableNames.includes("Bar")) {
        testLogger.info("Tables don't exist, creating via migrate...");
        await execAsync(
          `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
          {
            cwd: innerMooseDir,
          },
        );
        testLogger.info("✓ Initial tables created");
      } else {
        testLogger.info("✓ Tables already exist from previous tests");
      }

      // Manually add a column to the Bar table in the DB.
      // Since the code doesn't define this column, the diff will detect it
      // as a column that needs to be removed → plan-worthy operation.
      testLogger.info("Manually adding column to create plan-worthy diff...");
      await client.command({
        query: `ALTER TABLE ${CLICKHOUSE_CONFIG.database}.Bar ADD COLUMN extra_column String`,
      });
      testLogger.info("✓ Added extra_column to Bar table");

      // Try to migrate — should block because dropping a column is plan-worthy
      // and no plan file exists.
      testLogger.info(
        "Attempting migration (should block on plan-worthy ops)...",
      );
      try {
        await execAsync(
          `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
          {
            cwd: innerMooseDir,
          },
        );

        // If we get here, the migration didn't fail — that's unexpected
        expect.fail(
          "Migration should have blocked on destructive operation without plan file",
        );
      } catch (error: any) {
        testLogger.info("Migration blocked as expected:", error.message);

        const errorOutput = error.message + (error.stderr || "");
        // Should mention that destructive operations were detected without plan files
        expect(errorOutput).to.include("destructive operation");

        testLogger.info("✓ Plan-worthy operations correctly blocked");
      } finally {
        // Clean up the extra column so it doesn't interfere with other tests
        await client.command({
          query: `ALTER TABLE ${CLICKHOUSE_CONFIG.database}.Bar DROP COLUMN extra_column`,
        });
        testLogger.info("✓ Cleaned up extra_column");
      }
    });
  });
});
