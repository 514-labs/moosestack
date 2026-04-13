/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for OlapDictionary functionality.
 *
 * Tests verify that:
 * - Dictionaries defined in TypeScript code appear in moose plan output
 * - Moose creates dictionaries in ClickHouse when running in prod mode
 *
 * Uses moose prod with Docker infrastructure and moose plan --json to
 * inspect what operations would be generated for dictionary changes.
 */

import { spawn } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient } from "@clickhouse/client";

import {
  TIMEOUTS,
  CLICKHOUSE_CONFIG,
  SERVER_CONFIG,
  TEST_ADMIN_BEARER_TOKEN,
} from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  createTempTestDirectory,
  cleanupTestSuite,
  performGlobalCleanup,
  hasDictionaryAdded,
  runMoosePlanJson,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
// Use the staged template (with shared files injected by package-templates.js pretest)
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../template-packages/_staging_typescript-tests",
);

const TEST_ENV = {
  ...process.env,
  TEST_AWS_ACCESS_KEY_ID: "test-access-key",
  TEST_AWS_SECRET_ACCESS_KEY: "test-secret-key",
  MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
  MOOSE_ADMIN_TOKEN: TEST_ADMIN_BEARER_TOKEN,
};

/**
 * Sets up a fresh isolated test environment for a single dictionary test.
 * Each test gets its own temp directory, moose prod process, and Docker containers.
 */
async function setupTestEnvironment(testName: string) {
  const uniqueName = `ts-dict-${testName
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase()
    .slice(0, 28)}`;
  const testProjectDir = createTempTestDirectory(uniqueName);
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

  const client = createClient(CLICKHOUSE_CONFIG);

  console.log(`=== Environment ready for: ${testName} ===\n`);

  const cleanup = async () => {
    console.log(`\n=== Cleaning up environment for: ${testName} ===`);
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
    "Running global setup for dictionary tests - cleaning Docker state from previous runs...",
  );
  await performGlobalCleanup();
});

describe("OlapDictionary Tests", function () {
  before(async function () {
    console.log("\n=== Dictionary Tests - Starting ===");
    console.log("Each test will run in its own isolated environment\n");
  });

  describe("dictionary created by moose prod", function () {
    it("should create the dictionary in ClickHouse when moose prod starts", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { client, cleanup } = await setupTestEnvironment("dict-created");

      try {
        console.log(
          "\n--- Verifying 'dict_index_test_lookup' exists in ClickHouse ---",
        );

        // The template pre-includes dictionaryTests.ts which defines
        // dict_index_test_lookup. Moose prod auto-migrates it on startup.
        const result = await client.query({
          query: `
            SELECT count() AS cnt
            FROM system.dictionaries
            WHERE database = 'local' AND name = 'dict_index_test_lookup'
          `,
          format: "JSONEachRow",
        });
        const rows = await result.json<{ cnt: string }>();
        expect(rows[0].cnt).to.equal("1");

        console.log(
          "✓ Dictionary 'dict_index_test_lookup' exists in ClickHouse",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("dictionary plan generation", function () {
    it("should generate an OlapDictionary Added entry when a new dictionary is defined", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.MIGRATION_MS);

      const { testProjectDir, cleanup } =
        await setupTestEnvironment("dict-plan-added");

      try {
        console.log(
          "\n--- Testing plan shows Added for a new OlapDictionary ---",
        );

        // Write a new dictionary file that is NOT pre-included in the template.
        // This dictionary therefore does not exist in ClickHouse yet, so
        // moose plan should report it as Added.
        const dictFilePath = path.join(
          testProjectDir,
          "src",
          "views",
          "newDictTest.ts",
        );
        fs.writeFileSync(
          dictFilePath,
          `
import { OlapDictionary, UInt64 } from "@514labs/moose-lib";
import { IndexTestTable } from "../ingest/models";

interface IndexTestLookup2 {
  u64: UInt64;
  i32: number;
  s: string;
}

export const newIndexTestLookupDict = new OlapDictionary<IndexTestLookup2>(
  "dict_new_index_test_lookup",
  {
    sourceTable: IndexTestTable,
    primaryKey: ["u64"],
    layout: { type: "HASHED" },
    lifetime: 7200,
  },
);
`.trim(),
        );

        console.log("✓ Added new dictionary file 'newDictTest.ts'");

        // Export the new file from index.ts so moose can discover it.
        // Moose uses index.ts as the entry point for TypeScript resource discovery;
        // files not transitively reachable from it are invisible to the planner.
        const indexPath = path.join(testProjectDir, "src", "index.ts");
        fs.appendFileSync(
          indexPath,
          '\nexport * from "./views/newDictTest";\n',
        );
        console.log("✓ Exported 'newDictTest' from src/index.ts");

        const plan = await runMoosePlanJson(testProjectDir);

        const hasDict = hasDictionaryAdded(plan, "dict_new_index_test_lookup");
        expect(hasDict).to.be.true;

        console.log(
          "✓ Plan contains OlapDictionary.Added for 'dict_new_index_test_lookup'",
        );
      } finally {
        await cleanup();
      }
    });
  });
});
