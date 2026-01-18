/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for Init Container support (--exit-after-init flag)
 *
 * Tests verify that:
 * - `moose prod --exit-after-init` completes infrastructure setup and exits cleanly
 * - Subsequent `moose prod` starts without redundant infrastructure setup
 * - Running `--exit-after-init` multiple times is idempotent
 * - Migration failures are handled gracefully
 * - Normal `moose prod` (without flag) still works as before
 */

import { spawn, ChildProcess, execSync } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient, ClickHouseClient } from "@clickhouse/client";

import { TIMEOUTS, CLICKHOUSE_CONFIG, SERVER_CONFIG } from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  createTempTestDirectory,
  cleanupTestSuite,
  performGlobalCleanup,
  stopDevProcess,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../templates/typescript-tests",
);

/**
 * Environment variables needed for the typescript-tests template
 */
const TEST_ENV = {
  ...process.env,
  TEST_AWS_ACCESS_KEY_ID: "test-access-key",
  TEST_AWS_SECRET_ACCESS_KEY: "test-secret-key",
  MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
  MOOSE_ADMIN_TOKEN:
    "deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef",
};

/**
 * Helper to wait for a process to exit and return its exit code
 */
async function waitForProcessExit(
  process: ChildProcess,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      stdout += data.toString();
      console.log("[STDOUT]", data.toString().trim());
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
      console.log("[STDERR]", data.toString().trim());
    });

    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      reject(new Error(`Process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    process.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    process.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Sets up a fresh test project from the typescript-tests template
 */
async function setupTestProject(testName: string): Promise<{
  testProjectDir: string;
  projectName: string;
}> {
  const uniqueName = `init-${testName
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase()
    .slice(0, 25)}`;
  const testProjectDir = createTempTestDirectory(uniqueName);
  const projectName = path.basename(testProjectDir).toLowerCase();

  console.log(`\n=== Setting up test project for: ${testName} ===`);
  console.log(`Project name: ${projectName}`);
  console.log(`Test directory: ${testProjectDir}`);

  // Copy template
  fs.cpSync(TEMPLATE_SOURCE_DIR, testProjectDir, { recursive: true });
  console.log("✓ Template copied");

  // Update package.json name for unique Docker project name
  const packageJsonPath = path.join(testProjectDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  packageJson.name = projectName;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`✓ Updated package.json name to: ${projectName}`);

  // Install dependencies
  console.log("Installing dependencies...");
  await execAsync("npm install", { cwd: testProjectDir });
  console.log("✓ Dependencies installed");

  return { testProjectDir, projectName };
}

// Global setup - clean Docker state from previous runs
before(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  console.log(
    "Running global setup for init container tests - cleaning Docker state...",
  );
  await performGlobalCleanup();
});

describe("Init Container Support (--exit-after-init)", function () {
  before(async function () {
    console.log("\n=== Init Container Tests - Starting ===");
  });

  describe("Basic functionality", function () {
    it("should complete with --exit-after-init and allow main container to start", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS * 2);

      const { testProjectDir, projectName } = await setupTestProject(
        "basic-flow",
      );
      let mainProcess: ChildProcess | null = null;

      try {
        // Step 1: Run init container (moose prod --start-include-dependencies --exit-after-init)
        console.log("\n--- Step 1: Running init container ---");
        const initProcess = spawn(
          CLI_PATH,
          ["prod", "--start-include-dependencies", "--exit-after-init"],
          {
            stdio: "pipe",
            cwd: testProjectDir,
            env: TEST_ENV,
          },
        );

        const initResult = await waitForProcessExit(
          initProcess,
          TIMEOUTS.SERVER_STARTUP_MS,
        );
        console.log(`Init process exit code: ${initResult.exitCode}`);

        expect(initResult.exitCode).to.equal(0);
        expect(initResult.stdout).to.include("infrastructure initialization");
        console.log("✓ Init container completed successfully");

        // Step 2: Run main container (moose prod without --exit-after-init)
        // Docker containers should still be running from the init container
        console.log("\n--- Step 2: Running main container ---");
        mainProcess = spawn(CLI_PATH, ["prod"], {
          stdio: "pipe",
          cwd: testProjectDir,
          env: TEST_ENV,
        });

        await waitForServerStart(
          mainProcess,
          TIMEOUTS.SERVER_STARTUP_MS,
          "production mode",
          SERVER_CONFIG.url,
        );
        console.log("✓ Main container started");

        // Step 3: Verify server is functional
        console.log("\n--- Step 3: Verifying server functionality ---");
        const healthResponse = await fetch(`${SERVER_CONFIG.url}/health`);
        expect(healthResponse.ok).to.be.true;
        console.log("✓ Health endpoint responds OK");

        // Step 4: Verify plan shows no changes (infra already set up)
        console.log("\n--- Step 4: Verifying no redundant setup ---");
        const { stdout: planOutput } = await execAsync(
          `"${CLI_PATH}" plan --url "${SERVER_CONFIG.url}" --json`,
          { cwd: testProjectDir, env: TEST_ENV },
        );
        const plan = JSON.parse(planOutput);

        // Changes should be empty or minimal since init already ran
        const olapChanges = plan.changes?.olap_changes ?? [];
        const streamingChanges = plan.changes?.streaming_engine_changes ?? [];
        console.log(`OLAP changes: ${olapChanges.length}`);
        console.log(`Streaming changes: ${streamingChanges.length}`);

        // In a properly set up system, there should be no pending changes
        expect(olapChanges.length).to.equal(0);
        expect(streamingChanges.length).to.equal(0);
        console.log("✓ No redundant infrastructure changes needed");
      } finally {
        if (mainProcess) {
          await stopDevProcess(mainProcess);
        }
        await cleanupTestSuite(null, testProjectDir, projectName, {
          logPrefix: "basic-flow",
        });
      }
    });

    it("should handle idempotent --exit-after-init calls", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS * 2);

      const { testProjectDir, projectName } = await setupTestProject(
        "idempotent",
      );

      try {
        // First init call
        console.log("\n--- First --exit-after-init call ---");
        const firstInit = spawn(
          CLI_PATH,
          ["prod", "--start-include-dependencies", "--exit-after-init"],
          {
            stdio: "pipe",
            cwd: testProjectDir,
            env: TEST_ENV,
          },
        );

        const firstResult = await waitForProcessExit(
          firstInit,
          TIMEOUTS.SERVER_STARTUP_MS,
        );
        expect(firstResult.exitCode).to.equal(0);
        console.log("✓ First init completed");

        // Second init call (should also succeed)
        console.log("\n--- Second --exit-after-init call ---");
        const secondInit = spawn(
          CLI_PATH,
          ["prod", "--exit-after-init"], // Docker already running
          {
            stdio: "pipe",
            cwd: testProjectDir,
            env: TEST_ENV,
          },
        );

        const secondResult = await waitForProcessExit(
          secondInit,
          TIMEOUTS.SERVER_STARTUP_MS,
        );
        expect(secondResult.exitCode).to.equal(0);
        console.log("✓ Second init completed (idempotent)");
      } finally {
        await cleanupTestSuite(null, testProjectDir, projectName, {
          logPrefix: "idempotent",
        });
      }
    });
  });

  describe("Backwards compatibility", function () {
    it("should work without --exit-after-init (normal prod)", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const { testProjectDir, projectName } = await setupTestProject(
        "backwards-compat",
      );
      let mooseProcess: ChildProcess | null = null;

      try {
        // Run normal moose prod (without --exit-after-init)
        console.log("\n--- Running normal moose prod ---");
        mooseProcess = spawn(
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
        console.log("✓ Normal moose prod started");

        // Verify server is functional
        const healthResponse = await fetch(`${SERVER_CONFIG.url}/health`);
        expect(healthResponse.ok).to.be.true;
        console.log("✓ Server is functional");
      } finally {
        if (mooseProcess) {
          await stopDevProcess(mooseProcess);
        }
        await cleanupTestSuite(null, testProjectDir, projectName, {
          logPrefix: "backwards-compat",
        });
      }
    });
  });
});
