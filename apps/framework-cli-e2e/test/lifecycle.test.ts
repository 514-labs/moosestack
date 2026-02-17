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
import {
  TIMEOUTS,
  CLICKHOUSE_CONFIG,
  SERVER_CONFIG,
  TEST_ADMIN_BEARER_TOKEN,
} from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  cleanupClickhouseData,
  createTempTestDirectory,
  cleanupTestSuite,
  performGlobalCleanup,
  PlanOutput,
  hasTableAdded,
  hasTableRemoved,
  hasTableUpdated,
  getTableChanges,
  hasMvAdded,
  hasMvRemoved,
  hasMvUpdated,
  getMvChanges,
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
  MOOSE_ADMIN_TOKEN: TEST_ADMIN_BEARER_TOKEN,
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
    // The CLI may output ANSI-colored warnings before the JSON object.
    // Extract the JSON by finding the first '{' character.
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) {
      throw new Error(
        `No JSON object found in moose plan output: ${stdout.substring(0, 500)}`,
      );
    }
    const jsonStr = stdout.substring(jsonStart);
    const parsed = JSON.parse(jsonStr) as PlanOutput;
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
        const idx = error.stdout.indexOf("{");
        if (idx !== -1) {
          const partial = JSON.parse(error.stdout.substring(idx));
          console.error("Partial JSON structure:", Object.keys(partial));
        }
      } catch (_e) {
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
  const content = fs.readFileSync(modelsPath, "utf-8");
  const replaced = content.replace(searchString, replaceString);
  if (content === replaced) {
    throw new Error("Replacement failed");
  }
  fs.writeFileSync(modelsPath, replaced);
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

  // Note: moose prod automatically runs migrations in memory, so FULLY_MANAGED
  // and DELETION_PROTECTED tables should already be created at this point.
  // We do NOT call cleanupClickhouseData() here to preserve those tables.
  console.log("✓ Tables auto-created by moose prod");

  console.log(`=== Environment ready for: ${testName} ===\n`);

  // Return cleanup function
  const cleanup = async () => {
    console.log(`\n=== Cleaning up environment for: ${testName} ===`);

    // Close ClickHouse client connection to prevent leaks
    if (client) {
      await client.close();
      console.log(`✓ ClickHouse client closed for: ${testName}`);
    }

    await cleanupTestSuite(mooseProcess, testProjectDir, projectName, {
      logPrefix: testName,
    });
    console.log(`✓ Cleanup complete for: ${testName}\n`);
  };

  return { mooseProcess, testProjectDir, client, cleanup };
}

// Global setup - clean Docker state from previous runs
before(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  console.log(
    "Running global setup for lifecycle tests - cleaning Docker state from previous runs...",
  );
  await performGlobalCleanup();
});

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

        // Add a NEW table with EXTERNALLY_MANAGED annotation after server starts
        const newTablePath = path.join(
          testProjectDir,
          "src",
          "ingest",
          "externalTable.ts",
        );

        fs.writeFileSync(
          newTablePath,
          `
import { OlapTable, Key, DateTime, LifeCycle } from "@514labs/moose-lib";

export interface NewExternalTable {
  id: Key<string>;
  timestamp: DateTime;
  externalData: string;
}

export const newExternalTable = new OlapTable<NewExternalTable>("NewExternalTable", {
  orderByFields: ["id", "timestamp"],
  lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
});
`.trim(),
        );

        console.log("✓ Added new EXTERNALLY_MANAGED table");

        const plan = await runMoosePlanJson(testProjectDir);

        // NewExternalTable should NOT have any CreateTable operation
        const hasCreate = hasTableAdded(plan, "NewExternalTable");
        expect(hasCreate).to.be.false;

        console.log(
          "✓ No CreateTable operation for NewExternalTable (as expected)",
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

        // ExternallyManagedTest already exists in the template with lifeCycle: EXTERNALLY_MANAGED
        // Run initial plan to establish baseline (should have no operations since it's externally managed)
        const initialPlan = await runMoosePlanJson(testProjectDir);
        console.log("✓ Initial plan generated");

        // Manually create the table in ClickHouse to simulate external management
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
        console.log(
          "✓ Manually created ExternallyManagedTest table in ClickHouse",
        );

        // Now MODIFY the externally managed table definition by adding a new column
        const modelsPath = path.join(
          testProjectDir,
          "src",
          "ingest",
          "models.ts",
        );
        let modelsContent = fs.readFileSync(modelsPath, "utf-8");

        // Find and replace the externallyManagedTable definition to add a new column
        modelsContent = modelsContent.replace(
          /export const externallyManagedTable = new OlapTable<LifeCycleTestData>\(\s*"ExternallyManagedTest",\s*{[\s\S]*?}\s*\);/,
          `export const externallyManagedTable = new OlapTable<LifeCycleTestDataWithExtra>(
  "ExternallyManagedTest",
  {
    orderByFields: ["id", "timestamp"],
    lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
  },
);`,
        );

        fs.writeFileSync(modelsPath, modelsContent);
        console.log(
          "✓ Modified ExternallyManagedTest to add 'removableColumn' field",
        );

        // Generate plan after schema change - should STILL have no operations at all
        const plan = await runMoosePlanJson(testProjectDir);

        const operations = getTableChanges(plan, "ExternallyManagedTest");
        expect(operations).to.have.lengthOf(
          0,
          `Expected no operations for ExternallyManagedTest after schema change, got: ${JSON.stringify(operations)}`,
        );

        // Also verify specifically that no create or update operations exist
        const hasCreate = hasTableAdded(plan, "ExternallyManagedTest");
        const hasUpdate = hasTableUpdated(plan, "ExternallyManagedTest");
        expect(hasCreate).to.be.false;
        expect(hasUpdate).to.be.false;

        console.log(
          "✓ No create or update operations for ExternallyManagedTest after schema change (as expected)",
        );
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

        // Verify the table was auto-created by moose prod
        const result = await client.query({
          query: "SHOW TABLES LIKE 'DeletionProtectedTest'",
          format: "JSONEachRow",
        });
        const rows = await result.json<any>();
        expect(rows).to.have.lengthOf(
          1,
          "DeletionProtectedTest should already exist from moose prod auto-migration",
        );

        console.log(
          "✓ DeletionProtectedTest was auto-created by moose prod (as expected)",
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

        // DeletionProtectedTest should already exist from moose prod auto-migration
        console.log("✓ DeletionProtectedTest already exists from moose prod");

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

        // DeletionProtectedTest already exists from moose prod with removableColumn
        // (it uses LifeCycleTestDataWithExtra which includes removableColumn)
        console.log(
          "✓ DeletionProtectedTest with removableColumn exists from moose prod",
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

        // DeletionProtectedOrderByTest already exists from moose prod with ORDER BY (id, timestamp)
        console.log("✓ DeletionProtectedOrderByTest exists from moose prod");

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

        // DeletionProtectedEngineTest already exists from moose prod with MergeTree engine
        console.log("✓ DeletionProtectedEngineTest exists from moose prod");

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

  // ==========================================================================
  // MaterializedView LifeCycle Tests
  // ==========================================================================

  describe("EXTERNALLY_MANAGED materialized views", function () {
    it("should NOT generate create operation for EXTERNALLY_MANAGED MV", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } = await setupTestEnvironment(
        "externally-managed-mv-no-create",
      );

      try {
        console.log(
          "\n--- Testing EXTERNALLY_MANAGED MV should not be created ---",
        );

        // ExternallyManagedMVTest is defined in models.ts with LifeCycle.EXTERNALLY_MANAGED
        // It should NOT appear in the plan as an Added MV
        const plan = await runMoosePlanJson(testProjectDir);

        const hasCreate = hasMvAdded(plan, "ExternallyManagedMVTest");
        expect(hasCreate).to.be.false;

        console.log(
          "✓ No Create operation for ExternallyManagedMVTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("DELETION_PROTECTED materialized views", function () {
    it("should NOT generate drop operation when DELETION_PROTECTED MV is removed from code", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } = await setupTestEnvironment(
        "deletion-protected-mv-no-drop",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED MV should not be dropped ---",
        );

        // DeletionProtectedMVTest exists from moose prod auto-migration
        console.log("✓ DeletionProtectedMVTest exists from moose prod");

        // Remove the MV from code by commenting it out
        const modelsPath = path.join(
          testProjectDir,
          "src",
          "ingest",
          "models.ts",
        );
        let modelsContent = fs.readFileSync(modelsPath, "utf-8");

        // Comment out the entire deletionProtectedMV definition
        modelsContent = modelsContent.replace(
          /export const deletionProtectedMV = new MaterializedView[\s\S]*?lifeCycle: LifeCycle\.DELETION_PROTECTED,\n\}\);/,
          "// REMOVED FOR TEST: deletionProtectedMV",
        );

        fs.writeFileSync(modelsPath, modelsContent);
        console.log("✓ Removed DeletionProtectedMVTest from models.ts");

        // Generate new plan - should NOT have a removal for DeletionProtectedMVTest
        const plan = await runMoosePlanJson(testProjectDir);

        const hasDrop = hasMvRemoved(plan, "DeletionProtectedMVTest");
        expect(hasDrop).to.be.false;

        console.log(
          "✓ No Drop operation for DeletionProtectedMVTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should NOT generate update (DROP+CREATE) when DELETION_PROTECTED MV query changes", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } = await setupTestEnvironment(
        "deletion-protected-mv-no-update",
      );

      try {
        console.log(
          "\n--- Testing DELETION_PROTECTED MV should not be updated ---",
        );

        // Modify the MV's SELECT statement to trigger an update
        const modelsPath = path.join(
          testProjectDir,
          "src",
          "ingest",
          "models.ts",
        );
        let modelsContent = fs.readFileSync(modelsPath, "utf-8");

        // Change the SELECT for the deletion-protected MV
        modelsContent = modelsContent.replace(
          /export const deletionProtectedMV = new MaterializedView<MvLifeCycleAggregated>\(\{[\s\S]*?materializedViewName: "DeletionProtectedMVTest",[\s\S]*?selectStatement: sql`SELECT[\s\S]*?GROUP BY category`/,
          `export const deletionProtectedMV = new MaterializedView<MvLifeCycleAggregated>({
  materializedViewName: "DeletionProtectedMVTest",
  tableName: "DeletionProtectedMVTarget",
  orderByFields: ["category"],
  selectStatement: sql\`SELECT
    \${mvSourceColumns.category} as category,
    count() + 1 as totalRows
  FROM \${mvLifeCycleSourceTable}
  GROUP BY category\``,
        );

        fs.writeFileSync(modelsPath, modelsContent);
        console.log("✓ Modified DeletionProtectedMVTest SELECT statement");

        // Generate new plan - should NOT have an update for DeletionProtectedMVTest
        const plan = await runMoosePlanJson(testProjectDir);

        const hasUpdate = hasMvUpdated(plan, "DeletionProtectedMVTest");
        expect(hasUpdate).to.be.false;

        console.log(
          "✓ No Update operation for DeletionProtectedMVTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("FULLY_MANAGED materialized views", function () {
    it("should generate drop operation when FULLY_MANAGED MV is removed from code", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } = await setupTestEnvironment(
        "fully-managed-mv-drop",
      );

      try {
        console.log("\n--- Testing FULLY_MANAGED MV should be dropped ---");

        // FullyManagedMVTest exists from moose prod auto-migration
        console.log("✓ FullyManagedMVTest exists from moose prod");

        // Remove the MV from code
        const modelsPath = path.join(
          testProjectDir,
          "src",
          "ingest",
          "models.ts",
        );
        let modelsContent = fs.readFileSync(modelsPath, "utf-8");

        // Comment out the entire fullyManagedMV definition
        modelsContent = modelsContent.replace(
          /export const fullyManagedMV = new MaterializedView[\s\S]*?selectTables: \[mvLifeCycleSourceTable\],\n\}\);/,
          "// REMOVED FOR TEST: fullyManagedMV",
        );

        fs.writeFileSync(modelsPath, modelsContent);
        console.log("✓ Removed FullyManagedMVTest from models.ts");

        // Generate new plan - SHOULD have a removal for FullyManagedMVTest
        const plan = await runMoosePlanJson(testProjectDir);

        const mvChanges = getMvChanges(plan, "FullyManagedMVTest");
        console.log(
          "MV changes for FullyManagedMVTest:",
          JSON.stringify(mvChanges, null, 2),
        );

        const hasDrop = hasMvRemoved(plan, "FullyManagedMVTest");
        console.log("hasMvRemoved result:", hasDrop);
        expect(hasDrop).to.be.true;

        console.log(
          "✓ Drop operation exists for FullyManagedMVTest (as expected)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should generate update (DROP+CREATE) when FULLY_MANAGED MV query changes", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } = await setupTestEnvironment(
        "fully-managed-mv-update",
      );

      try {
        console.log(
          "\n--- Testing FULLY_MANAGED MV should be updated on query change ---",
        );

        // Modify the MV's SELECT statement to trigger an update
        const modelsPath = path.join(
          testProjectDir,
          "src",
          "ingest",
          "models.ts",
        );
        let modelsContent = fs.readFileSync(modelsPath, "utf-8");

        // Change the SELECT for the fully-managed MV
        modelsContent = modelsContent.replace(
          /export const fullyManagedMV = new MaterializedView<MvLifeCycleAggregated>\(\{[\s\S]*?materializedViewName: "FullyManagedMVTest",[\s\S]*?selectStatement: sql`SELECT[\s\S]*?GROUP BY category`/,
          `export const fullyManagedMV = new MaterializedView<MvLifeCycleAggregated>({
  materializedViewName: "FullyManagedMVTest",
  tableName: "FullyManagedMVTarget",
  orderByFields: ["category"],
  selectStatement: sql\`SELECT
    \${mvSourceColumns.category} as category,
    count() + 1 as totalRows
  FROM \${mvLifeCycleSourceTable}
  GROUP BY category\``,
        );

        fs.writeFileSync(modelsPath, modelsContent);
        console.log("✓ Modified FullyManagedMVTest SELECT statement");

        // Generate new plan - SHOULD have an update for FullyManagedMVTest
        const plan = await runMoosePlanJson(testProjectDir);

        const mvChanges = getMvChanges(plan, "FullyManagedMVTest");
        console.log(
          "MV changes for FullyManagedMVTest:",
          JSON.stringify(mvChanges, null, 2),
        );

        const hasUpdate = hasMvUpdated(plan, "FullyManagedMVTest");
        console.log("hasMvUpdated result:", hasUpdate);
        expect(hasUpdate).to.be.true;

        console.log(
          "✓ Update operation exists for FullyManagedMVTest (as expected)",
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

        // Verify the table was auto-created by moose prod
        const result = await client.query({
          query: "SHOW TABLES LIKE 'FullyManagedTest'",
          format: "JSONEachRow",
        });
        const rows = await result.json<any>();
        expect(rows).to.have.lengthOf(
          1,
          "FullyManagedTest should already exist from moose prod auto-migration",
        );

        console.log(
          "✓ FullyManagedTest was auto-created by moose prod (as expected)",
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

        // FullyManagedTest already exists from moose prod auto-migration
        // (both in ClickHouse and synced to Redis state)
        console.log("✓ FullyManagedTest exists from moose prod");

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

        // FullyManagedTest already exists from moose prod with removableColumn
        // (it uses LifeCycleTestDataWithExtra which includes removableColumn)
        console.log(
          "✓ FullyManagedTest with removableColumn exists from moose prod",
        );

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

        // FullyManagedOrderByTest already exists from moose prod with ORDER BY (id, timestamp)
        console.log("✓ FullyManagedOrderByTest exists from moose prod");

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

        // FullyManagedEngineTest already exists from moose prod with MergeTree engine
        console.log("✓ FullyManagedEngineTest exists from moose prod");

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

// Global cleanup to ensure no hanging processes or Docker resources
after(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  console.log("\n=== Running global cleanup for lifecycle tests ===");
  await performGlobalCleanup();
});
