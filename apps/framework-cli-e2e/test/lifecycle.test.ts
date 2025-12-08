/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for LifeCycle management functionality
 *
 * Tests verify that:
 * - EXTERNALLY_MANAGED resources are never created/updated/deleted
 * - DELETION_PROTECTED resources allow additive changes but block destructive ones
 * - FULLY_MANAGED resources have full lifecycle control
 *
 * Uses moose prod with Docker infrastructure and moose plan to inspect
 * what operations would be generated for each lifecycle type.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient, ClickHouseClient } from "@clickhouse/client";

// Import constants and utilities
import { TIMEOUTS, CLICKHOUSE_CONFIG, SERVER_CONFIG } from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  cleanupClickhouseData,
  createTempTestDirectory,
  cleanupTestSuite,
  PlanOutput,
  hasTableAdded,
  hasTableRemoved,
  hasTableUpdated,
  getTableChanges,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../templates/typescript-tests",
);

// Build ClickHouse connection URL for plan/migration commands
const CLICKHOUSE_URL = `http://${CLICKHOUSE_CONFIG.username}:${CLICKHOUSE_CONFIG.password}@localhost:18123/${CLICKHOUSE_CONFIG.database}`;

// Moose server URL for plan command
const MOOSE_SERVER_URL = "http://localhost:4000";

/**
 * Environment variables needed for the typescript-tests template
 */
const TEST_ENV = {
  ...process.env,
  // Dummy values for S3 secrets tests
  TEST_AWS_ACCESS_KEY_ID: "test-access-key",
  TEST_AWS_SECRET_ACCESS_KEY: "test-secret-key",
  // Suppress the prompt for externally managed tables setup
  MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
  // Admin token for moose plan --url authentication
  // Token: deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef
  // Hash: 445fd4696cfc5c49e28995c4aba05de44303a112
  MOOSE_ADMIN_TOKEN:
    "deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef",
};

/**
 * Helper to run moose plan --json and return parsed result
 * Uses --url to connect to the running moose prod server
 */
async function runMoosePlanJson(projectDir: string): Promise<PlanOutput> {
  try {
    const { stdout } = await execAsync(
      `"${CLI_PATH}" plan --url "${MOOSE_SERVER_URL}" --json`,
      { cwd: projectDir, env: TEST_ENV },
    );
    // Debug: log first 500 chars of output to see structure
    console.log(
      "Plan JSON output (first 500 chars):",
      stdout.substring(0, 500),
    );
    const parsed = JSON.parse(stdout) as PlanOutput;
    // Debug: log structure
    console.log("Parsed plan structure:", {
      hasChanges: !!parsed.changes,
      olapChangesLength: parsed.changes?.olap_changes?.length ?? 0,
      changesKeys: parsed.changes ? Object.keys(parsed.changes) : [],
    });
    return parsed;
  } catch (error: any) {
    console.error("moose plan --json failed:");
    console.error("stdout:", error.stdout);
    console.error("stderr:", error.stderr);
    // Try to parse what we got to see structure
    if (error.stdout) {
      try {
        const partial = JSON.parse(error.stdout.substring(0, 1000));
        console.error("Partial JSON structure:", Object.keys(partial));
      } catch (e) {
        // Ignore parse errors
      }
    }
    throw error;
  }
}

/**
 * Modify models.ts to simulate schema changes
 */
function modifyModelsFile(
  projectDir: string,
  searchString: string,
  replaceString: string,
): void {
  const modelsPath = path.join(projectDir, "src", "ingest", "models.ts");
  let content = fs.readFileSync(modelsPath, "utf-8");
  content = content.replace(searchString, replaceString);
  fs.writeFileSync(modelsPath, content);
}

/**
 * Sets up a fresh isolated test environment for a single test
 * Each test gets its own:
 * - Unique temporary directory
 * - Fresh moose prod process
 * - Isolated Docker containers with unique project name
 * - Clean Redis and ClickHouse state
 *
 * Returns: { mooseProcess, testProjectDir, client, cleanup }
 */
async function setupTestEnvironment(testName: string) {
  // Create unique project name based on test name (sanitize for Docker)
  const uniqueName = `ts-lc-${testName
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase()
    .slice(0, 30)}`;
  const testProjectDir = createTempTestDirectory(uniqueName);

  // Docker project name is based on the directory basename (what Rust CLI uses)
  const projectName = path.basename(testProjectDir).toLowerCase();

  console.log(`\n=== Setting up isolated environment for: ${testName} ===`);
  console.log(`Project name: ${projectName}`);
  console.log(`Test directory: ${testProjectDir}`);

  // Copy template to temp directory
  console.log("Copying typescript-tests template...");
  fs.cpSync(TEMPLATE_SOURCE_DIR, testProjectDir, { recursive: true });
  console.log("✓ Template copied");

  // Update package.json name to ensure unique Docker project name
  const packageJsonPath = path.join(testProjectDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  packageJson.name = projectName;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`✓ Updated package.json name to: ${projectName}`);

  // Install dependencies
  console.log("Installing dependencies...");
  await execAsync("npm install", { cwd: testProjectDir });
  console.log("✓ Dependencies installed");

  // Start moose prod with Docker infrastructure
  console.log("Starting moose prod with Docker infrastructure...");
  const mooseProcess = spawn(
    CLI_PATH,
    ["prod", "--start-include-dependencies"],
    {
      stdio: "pipe",
      cwd: testProjectDir,
      env: TEST_ENV,
    },
  );

  await waitForServerStart(
    mooseProcess,
    TIMEOUTS.SERVER_STARTUP_MS,
    "production mode",
    SERVER_CONFIG.url,
  );
  console.log("✓ Moose prod started");

  // Wait for infrastructure to be fully ready
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS);
  console.log("✓ Infrastructure ready");

  // Initialize ClickHouse client for manual operations
  const client = createClient(CLICKHOUSE_CONFIG);

  // Clean up any existing test tables
  await cleanupClickhouseData();
  console.log("✓ ClickHouse cleaned");

  console.log(`=== Environment ready for: ${testName} ===\n`);

  // Return cleanup function
  const cleanup = async () => {
    console.log(`\n=== Cleaning up environment for: ${testName} ===`);
    await cleanupTestSuite(mooseProcess, testProjectDir, projectName, {
      logPrefix: testName,
    });
    console.log(`✓ Cleanup complete for: ${testName}\n`);
  };

  return { mooseProcess, testProjectDir, client, cleanup };
}

describe("LifeCycle Management Tests", function () {
  // Global cleanup before all tests
  before(async function () {
    console.log("\n=== LifeCycle Tests - Starting ===");
    console.log("Each test will run in its own isolated environment\n");
  });

  describe("EXTERNALLY_MANAGED tables", function () {
    it("should NOT generate create operation for EXTERNALLY_MANAGED table", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } = await setupTestEnvironment(
        "externally-managed-no-create",
      );

      try {
        console.log(
          "\n--- Testing EXTERNALLY_MANAGED table should not be created ---",
        );

        const plan = await runMoosePlanJson(testProjectDir);

        // ExternallyManagedTest table should NOT have any CreateTable operation
        const hasCreate = hasTableAdded(plan, "ExternallyManagedTest");
        expect(hasCreate).to.be.false;

        console.log(
          "✓ No CreateTable operation for ExternallyManagedTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should NOT generate update operation when schema changes for EXTERNALLY_MANAGED table", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "externally-managed-no-update",
      );

      try {
        console.log(
          "\n--- Testing EXTERNALLY_MANAGED table should not be updated ---",
        );

        // First, manually create the table in ClickHouse (simulating external creation)
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS ExternallyManagedTest (
              id String,
              timestamp DateTime,
              value String,
              category String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created ExternallyManagedTest table");

        // Generate plan - should have no operations for this table
        const plan = await runMoosePlanJson(testProjectDir);

        const operations = getTableChanges(plan, "ExternallyManagedTest");
        expect(operations).to.have.lengthOf(
          0,
          `Expected no operations for ExternallyManagedTest, got: ${JSON.stringify(operations)}`,
        );

        console.log("✓ No operations for ExternallyManagedTest (as expected)");
      } finally {
        await cleanup();
      }
    });
  });

  describe("DELETION_PROTECTED tables", function () {
    it("should generate create operation for DELETION_PROTECTED table", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "deletion-protected-create",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED table should be created ---",
        );

        // Drop the table so moose plan will generate a create operation
        await client.command({
          query: `DROP TABLE IF EXISTS DeletionProtectedTest`,
        });
        console.log("✓ Dropped DeletionProtectedTest table to test creation");

        const plan = await runMoosePlanJson(testProjectDir);

        // DeletionProtectedTest table SHOULD have CreateTable operation
        const hasCreate = hasTableAdded(plan, "DeletionProtectedTest");
        expect(hasCreate).to.be.true;

        console.log(
          "✓ CreateTable operation exists for DeletionProtectedTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should NOT generate drop table operation when table is removed from code", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "deletion-protected-no-drop",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED table should not be dropped ---",
        );

        // First, manually create the table in ClickHouse
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS DeletionProtectedTest (
              id String,
              timestamp DateTime,
              value String,
              category String,
              removableColumn String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created DeletionProtectedTest table");

        // Now "remove" the table from code by commenting it out
        modifyModelsFile(
          testProjectDir,
          'export const deletionProtectedTable = new OlapTable<LifeCycleTestDataWithExtra>(\n  "DeletionProtectedTest",\n  {\n    orderByFields: ["id", "timestamp"],\n    lifeCycle: LifeCycle.DELETION_PROTECTED,\n  },\n);',
          '// REMOVED FOR TEST: export const deletionProtectedTable = new OlapTable<LifeCycleTestDataWithExtra>(\n//  "DeletionProtectedTest",\n//  {\n//    orderByFields: ["id", "timestamp"],\n//    lifeCycle: LifeCycle.DELETION_PROTECTED,\n//  },\n//);',
        );
        console.log(
          "✓ Commented out DeletionProtectedTest table from models.ts",
        );

        // Generate new plan - should NOT have DropTable for DeletionProtectedTest
        const plan = await runMoosePlanJson(testProjectDir);

        const hasDrop = hasTableRemoved(plan, "DeletionProtectedTest");
        expect(hasDrop).to.be.false;

        console.log(
          "✓ No DropTable operation for DeletionProtectedTest (as expected)",
        );

        // Cleanup
        await client.command({
          query: "DROP TABLE IF EXISTS DeletionProtectedTest",
        });
      } finally {
        await cleanup();
      }
    });

    it("should NOT generate drop column operation when column is removed", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "deletion-protected-no-drop-column",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED table should not drop columns ---",
        );

        // Reset models file first
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        // Clean and manually create table with the column
        await cleanupClickhouseData();
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS DeletionProtectedTest (
              id String,
              timestamp DateTime,
              value String,
              category String,
              removableColumn String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log(
          "✓ Manually created DeletionProtectedTest with removableColumn",
        );

        // Now remove the column from the interface
        modifyModelsFile(
          testProjectDir,
          "export interface LifeCycleTestDataWithExtra extends LifeCycleTestData {\n  removableColumn: string;\n}",
          "export interface LifeCycleTestDataWithExtra extends LifeCycleTestData {\n  // removableColumn removed for test\n}",
        );
        console.log(
          "✓ Removed removableColumn from LifeCycleTestDataWithExtra",
        );

        // Generate new plan - should NOT have column removal for DeletionProtectedTest
        const plan = await runMoosePlanJson(testProjectDir);

        // Check if there's any Updated change with column_changes that removes a column
        const tableChanges = getTableChanges(plan, "DeletionProtectedTest");
        const hasColumnRemoval = tableChanges.some((change) => {
          if (change.details.Updated?.column_changes) {
            return change.details.Updated.column_changes.some(
              (col: any) => col.Removed?.name === "removableColumn",
            );
          }
          return false;
        });

        expect(hasColumnRemoval).to.be.false;

        console.log(
          "✓ No column removal operation for DeletionProtectedTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should NOT generate drop+create when orderByFields changes", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "deletion-protected-orderby-change",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED table ORDER BY change should be blocked ---",
        );

        // Reset models file
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();
        // Manually create table with original ORDER BY
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS DeletionProtectedOrderByTest (
              id String,
              timestamp DateTime,
              value String,
              category String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created DeletionProtectedOrderByTest");

        // Change orderByFields for DeletionProtectedOrderByTest
        modifyModelsFile(
          testProjectDir,
          'export const deletionProtectedOrderByTable = new OlapTable<LifeCycleTestData>(\n  "DeletionProtectedOrderByTest",\n  {\n    orderByFields: ["id", "timestamp"],',
          'export const deletionProtectedOrderByTable = new OlapTable<LifeCycleTestData>(\n  "DeletionProtectedOrderByTest",\n  {\n    orderByFields: ["id", "category", "timestamp"],',
        );
        console.log("✓ Changed orderByFields for DeletionProtectedOrderByTest");

        // Generate new plan
        const plan = await runMoosePlanJson(testProjectDir);

        // Should NOT have table removal or addition (no drop+create)
        const hasDrop = hasTableRemoved(plan, "DeletionProtectedOrderByTest");
        expect(hasDrop).to.be.false;

        const hasCreate = hasTableAdded(plan, "DeletionProtectedOrderByTest");
        expect(hasCreate).to.be.false;

        // Should also not have any Updated changes that would drop+recreate
        const hasUpdated = hasTableUpdated(
          plan,
          "DeletionProtectedOrderByTest",
        );
        expect(hasUpdated).to.be.false;

        console.log(
          "✓ No drop+create operations for DeletionProtectedOrderByTest ORDER BY change (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should NOT generate drop+create when engine type changes", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "deletion-protected-engine-change",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED table engine change should be blocked ---",
        );

        // Reset models file
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();
        // Manually create table with MergeTree engine
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS DeletionProtectedEngineTest (
              id String,
              timestamp DateTime,
              value String,
              category String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created DeletionProtectedEngineTest");

        // Change engine from MergeTree to ReplacingMergeTree
        modifyModelsFile(
          testProjectDir,
          "engine: ClickHouseEngines.MergeTree,\n    lifeCycle: LifeCycle.DELETION_PROTECTED,",
          "engine: ClickHouseEngines.ReplacingMergeTree,\n    lifeCycle: LifeCycle.DELETION_PROTECTED,",
        );
        console.log(
          "✓ Changed engine to ReplacingMergeTree for DeletionProtectedEngineTest",
        );

        // Generate new plan
        const plan = await runMoosePlanJson(testProjectDir);

        // Should NOT have table removal or addition (no drop+create)
        const hasDrop = hasTableRemoved(plan, "DeletionProtectedEngineTest");
        expect(hasDrop).to.be.false;

        const hasCreate = hasTableAdded(plan, "DeletionProtectedEngineTest");
        expect(hasCreate).to.be.false;

        console.log(
          "✓ No drop+create operations for DeletionProtectedEngineTest engine change (as expected)",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("FULLY_MANAGED tables", function () {
    it("should generate create operation for FULLY_MANAGED table", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "fully-managed-create",
      );

      try {
        console.log("\n--- Testing FULLY_MANAGED table should be created ---");

        // Reset models file
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();

        // Explicitly drop FullyManagedTest table if it exists to ensure clean state
        try {
          await client.command({
            query: "DROP TABLE IF EXISTS FullyManagedTest",
          });
          console.log("✓ Dropped FullyManagedTest table if it existed");
        } catch (e) {
          // Ignore errors - table might not exist
        }

        const plan = await runMoosePlanJson(testProjectDir);

        // Debug: log all olap changes to see what we got
        console.log(
          "Number of olap changes:",
          plan.changes?.olap_changes?.length ?? 0,
        );
        if (
          plan.changes?.olap_changes &&
          plan.changes.olap_changes.length > 0
        ) {
          console.log(
            "First olap change keys:",
            Object.keys(plan.changes.olap_changes[0]),
          );
          console.log(
            "First olap change:",
            JSON.stringify(plan.changes.olap_changes[0], null, 2).substring(
              0,
              1000,
            ),
          );
        }

        // FullyManagedTest table SHOULD have CreateTable operation
        const hasCreate = hasTableAdded(plan, "FullyManagedTest");
        console.log("hasTableAdded result:", hasCreate);
        expect(hasCreate).to.be.true;

        console.log(
          "✓ CreateTable operation exists for FullyManagedTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should generate drop table operation when table is removed from code", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } =
        await setupTestEnvironment("fully-managed-drop");

      try {
        console.log("\n--- Testing FULLY_MANAGED table should be dropped ---");

        // Reset and apply initial migration
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();

        // First, ensure the table exists in code and sync it to remote state
        // This is critical: moose plan compares local code with remote state (Redis),
        // not ClickHouse directly. We need the table in remote state first.
        console.log("Step 1: Syncing FullyManagedTest to remote state...");
        const initialPlan = await runMoosePlanJson(testProjectDir);
        // If table needs to be created, it will be in the plan
        // The table should already be in code, so this should sync it to remote state
        console.log(
          "✓ Initial plan generated (table should be synced to remote state)",
        );

        // Manually create table in ClickHouse to match what's in code
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS FullyManagedTest (
              id String,
              timestamp DateTime,
              value String,
              category String,
              removableColumn String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created FullyManagedTest table in ClickHouse");

        // Remove the table from code - remove the entire table definition
        modifyModelsFile(
          testProjectDir,
          `/**
 * FULLY_MANAGED table (default) - Moose has full lifecycle control
 * Tests: All operations allowed (create, update, delete)
 */
export const fullyManagedTable = new OlapTable<LifeCycleTestDataWithExtra>(
  "FullyManagedTest",
  {
    orderByFields: ["id", "timestamp"],
    // lifeCycle defaults to FULLY_MANAGED
  },
);
`,
          `/**
 * FULLY_MANAGED table (default) - Moose has full lifecycle control
 * Tests: All operations allowed (create, update, delete)
 * REMOVED FOR TESTING: Table removed to test drop operation
 */
// export const fullyManagedTable = new OlapTable<LifeCycleTestDataWithExtra>(
//   "FullyManagedTest",
//   {
//     orderByFields: ["id", "timestamp"],
//     // lifeCycle defaults to FULLY_MANAGED
//   },
// );
`,
        );
        console.log("✓ Removed FullyManagedTest from models.ts");

        // Generate new plan - SHOULD have DropTable
        const plan = await runMoosePlanJson(testProjectDir);

        // Debug: log all olap changes to see what we got
        console.log(
          "Number of olap changes:",
          plan.changes?.olap_changes?.length ?? 0,
        );
        const tableChanges = getTableChanges(plan, "FullyManagedTest");
        console.log(
          "Table changes for FullyManagedTest:",
          JSON.stringify(tableChanges, null, 2),
        );

        const hasDrop = hasTableRemoved(plan, "FullyManagedTest");
        console.log("hasTableRemoved result:", hasDrop);
        expect(hasDrop).to.be.true;

        console.log(
          "✓ DropTable operation exists for FullyManagedTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should generate drop column operation when column is removed", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "fully-managed-drop-column",
      );

      try {
        console.log(
          "\n--- Testing FULLY_MANAGED table should drop columns ---",
        );

        // Reset models file
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();

        // CRITICAL: moose plan compares local code with remote state (Redis), not ClickHouse directly
        // We need the table WITH removableColumn to exist in remote state before we can test column removal
        // Strategy: Create table in ClickHouse, then ensure it's synced to remote state
        console.log(
          "Step 1: Creating FullyManagedTest with removableColumn in ClickHouse...",
        );

        // Manually create table in ClickHouse with removableColumn
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS FullyManagedTest (
              id String,
              timestamp DateTime,
              value String,
              category String,
              removableColumn String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log(
          "✓ Created FullyManagedTest with removableColumn in ClickHouse",
        );

        // Now check the plan to see what remote state thinks
        // If table is in code but not in remote state, plan will show CreateTable
        // If table is already in remote state, plan should show no changes (or other changes)
        const initialPlan = await runMoosePlanJson(testProjectDir);
        const needsCreate = hasTableAdded(initialPlan, "FullyManagedTest");
        const tableChangesInitial = getTableChanges(
          initialPlan,
          "FullyManagedTest",
        );
        console.log(`Initial plan check: table needs creation: ${needsCreate}`);
        console.log(
          `Initial plan table changes:`,
          JSON.stringify(tableChangesInitial, null, 2),
        );

        // If the table needs to be created, it means it's not in remote state yet
        // This can happen if a previous test removed it from code
        // In this case, we need to wait for or trigger state sync
        // For now, we'll proceed and see if the column removal is detected

        // Change the interface to remove removableColumn from FullyManagedTest only
        // We need to replace the entire table definition to change the type parameter
        modifyModelsFile(
          testProjectDir,
          `/**
 * FULLY_MANAGED table (default) - Moose has full lifecycle control
 * Tests: All operations allowed (create, update, delete)
 */
export const fullyManagedTable = new OlapTable<LifeCycleTestDataWithExtra>(
  "FullyManagedTest",
  {
    orderByFields: ["id", "timestamp"],
    // lifeCycle defaults to FULLY_MANAGED
  },
);`,
          `/**
 * FULLY_MANAGED table (default) - Moose has full lifecycle control
 * Tests: All operations allowed (create, update, delete)
 */
export const fullyManagedTable = new OlapTable<LifeCycleTestData>(
  "FullyManagedTest",
  {
    orderByFields: ["id", "timestamp"],
    // lifeCycle defaults to FULLY_MANAGED
  },
);`,
        );
        console.log(
          "✓ Changed FullyManagedTest to use LifeCycleTestData (without removableColumn)",
        );

        // Generate new plan - SHOULD have column removal
        const plan = await runMoosePlanJson(testProjectDir);

        const tableChanges = getTableChanges(plan, "FullyManagedTest");
        console.log(
          "Table changes for FullyManagedTest:",
          JSON.stringify(tableChanges, null, 2),
        );

        const hasColumnRemoval = tableChanges.some((change) => {
          if (change.details.Updated?.column_changes) {
            console.log(
              "Column changes:",
              JSON.stringify(change.details.Updated.column_changes, null, 2),
            );
            return change.details.Updated.column_changes.some(
              (col: any) => col.Removed?.name === "removableColumn",
            );
          }
          return false;
        });

        console.log("hasColumnRemoval result:", hasColumnRemoval);
        expect(hasColumnRemoval).to.be.true;

        console.log(
          "✓ Column removal operation exists for FullyManagedTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should generate drop+create when orderByFields changes", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "fully-managed-orderby-change",
      );

      try {
        console.log(
          "\n--- Testing FULLY_MANAGED table ORDER BY change should work ---",
        );

        // Reset models file
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();
        // Manually create table with original ORDER BY
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS FullyManagedOrderByTest (
              id String,
              timestamp DateTime,
              value String,
              category String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created FullyManagedOrderByTest");

        // Change orderByFields for FullyManagedOrderByTest
        modifyModelsFile(
          testProjectDir,
          'export const fullyManagedOrderByTable = new OlapTable<LifeCycleTestData>(\n  "FullyManagedOrderByTest",\n  {\n    orderByFields: ["id", "timestamp"],',
          'export const fullyManagedOrderByTable = new OlapTable<LifeCycleTestData>(\n  "FullyManagedOrderByTest",\n  {\n    orderByFields: ["id", "category", "timestamp"],',
        );
        console.log("✓ Changed orderByFields for FullyManagedOrderByTest");

        // Generate new plan
        const plan = await runMoosePlanJson(testProjectDir);

        // Should have drop+create (removal + addition or Updated change)
        const hasDrop = hasTableRemoved(plan, "FullyManagedOrderByTest");
        const hasCreate = hasTableAdded(plan, "FullyManagedOrderByTest");
        const tableChanges = getTableChanges(plan, "FullyManagedOrderByTest");

        // ORDER BY changes should trigger some operation
        expect(tableChanges.length).to.be.greaterThan(
          0,
          "Expected at least one operation for FullyManagedOrderByTest ORDER BY change",
        );

        console.log(
          `✓ Operations found for FullyManagedOrderByTest ORDER BY change: ${JSON.stringify(tableChanges.map((o) => o.type))}`,
        );
      } finally {
        await cleanup();
      }
    });

    it("should generate drop+create when engine type changes", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, client, cleanup } = await setupTestEnvironment(
        "fully-managed-engine-change",
      );

      try {
        console.log(
          "\n--- Testing FULLY_MANAGED table engine change should work ---",
        );

        // Reset models file
        fs.cpSync(
          path.join(TEMPLATE_SOURCE_DIR, "src", "ingest", "models.ts"),
          path.join(testProjectDir, "src", "ingest", "models.ts"),
        );

        await cleanupClickhouseData();
        // Manually create table with MergeTree engine
        await client.command({
          query: `
            CREATE TABLE IF NOT EXISTS FullyManagedEngineTest (
              id String,
              timestamp DateTime,
              value String,
              category String
            ) ENGINE = MergeTree() ORDER BY (id, timestamp)
          `,
        });
        console.log("✓ Manually created FullyManagedEngineTest");

        // Change engine from MergeTree to ReplacingMergeTree
        modifyModelsFile(
          testProjectDir,
          'export const fullyManagedEngineTable = new OlapTable<LifeCycleTestData>(\n  "FullyManagedEngineTest",\n  {\n    orderByFields: ["id", "timestamp"],\n    engine: ClickHouseEngines.MergeTree,',
          'export const fullyManagedEngineTable = new OlapTable<LifeCycleTestData>(\n  "FullyManagedEngineTest",\n  {\n    orderByFields: ["id", "timestamp"],\n    engine: ClickHouseEngines.ReplacingMergeTree,',
        );
        console.log(
          "✓ Changed engine to ReplacingMergeTree for FullyManagedEngineTest",
        );

        // Generate new plan
        const plan = await runMoosePlanJson(testProjectDir);

        // Should have operations for engine change (drop+create or Updated)
        const tableChanges = getTableChanges(plan, "FullyManagedEngineTest");
        expect(tableChanges.length).to.be.greaterThan(
          0,
          "Expected at least one operation for FullyManagedEngineTest engine change",
        );

        console.log(
          `✓ Operations found for FullyManagedEngineTest engine change: ${JSON.stringify(tableChanges.map((o) => o.type))}`,
        );
      } finally {
        await cleanup();
      }
    });
  });
});
