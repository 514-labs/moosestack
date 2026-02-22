/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E regression tests for the github-dev-trends template.
 *
 * This template is a pnpm monorepo with:
 * - packages/moose-objects (shared types + API definitions)
 * - apps/moose-backend (Moose app with workflows)
 * - apps/dashboard (Next.js frontend)
 *
 * These tests verify fixes for:
 * - Bug 1: Circular import causing typia crash (compilation test)
 * - Bug 2: Dashboard importing server-only code (dashboard build test)
 * - Bug 3: Empty API response crash (API empty response test)
 * - Bug 4: Deprecated workflow API (backend startup + workflow test)
 * - Bug 5: Missing .js extension for NodeNext resolution (compilation test)
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import {
  TIMEOUTS,
  SERVER_CONFIG,
  TEST_ADMIN_API_KEY_HASH,
} from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  verifyProxyHealth,
  createTempTestDirectory,
  cleanupTestSuite,
  logger,
} from "./utils";
import { triggerWorkflow } from "./utils/workflow-utils";

const testLogger = logger.scope("github-dev-trends-test");

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

/**
 * Sets up the github-dev-trends monorepo template.
 * Unlike standard templates, this is a pnpm workspace with moose-lib
 * in apps/moose-backend/package.json rather than the root.
 */
async function setupGithubDevTrendsProject(
  projectDir: string,
): Promise<void> {
  // Initialize project using CLI
  testLogger.info("Initializing github-dev-trends template");
  const result = await execAsync(
    `"${CLI_PATH}" init github-dev-trends-e2e github-dev-trends --location "${projectDir}"`,
  );
  testLogger.debug("CLI init stdout", { stdout: result.stdout });
  if (result.stderr) {
    testLogger.debug("CLI init stderr", { stderr: result.stderr });
  }

  // Update moose-backend/package.json to use local moose-lib
  const backendPkgPath = path.join(
    projectDir,
    "apps",
    "moose-backend",
    "package.json",
  );
  const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, "utf-8"));
  backendPkg.dependencies["@514labs/moose-lib"] = `file:${MOOSE_LIB_PATH}`;
  fs.writeFileSync(backendPkgPath, JSON.stringify(backendPkg, null, 2));

  // Install dependencies with pnpm
  testLogger.info("Installing dependencies with pnpm");
  await new Promise<void>((resolve, reject) => {
    const installCmd = spawn("pnpm", ["install"], {
      stdio: "inherit",
      cwd: projectDir,
    });
    installCmd.on("close", (code) => {
      testLogger.debug("pnpm install completed", { exitCode: code });
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pnpm install failed with code ${code}`));
      }
    });
  });
}

describe("github-dev-trends template", () => {
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

    TEST_PROJECT_DIR = createTempTestDirectory("github-dev-trends");
    await setupGithubDevTrendsProject(TEST_PROJECT_DIR);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    await cleanupTestSuite(
      devProcess,
      TEST_PROJECT_DIR,
      "github-dev-trends-e2e",
      { logPrefix: "github-dev-trends" },
    );
  });

  // Bug 1 & 5: Compilation test - verifies no circular import crash and .js extension works
  it("should compile moose-objects package successfully", async function () {
    this.timeout(120_000);
    testLogger.info("Building moose-objects package...");

    const { stdout, stderr } = await execAsync(
      'pnpm --recursive --filter "./packages/*" build',
      { cwd: TEST_PROJECT_DIR },
    );

    testLogger.debug("Build stdout", { stdout });
    if (stderr) {
      testLogger.debug("Build stderr", { stderr });
    }

    // If we get here without throwing, compilation succeeded
    testLogger.info("moose-objects compilation succeeded");
  });

  // Bug 4: Backend startup test - verifies workflow registration with new API
  it("should start backend and register workflows", async function () {
    this.timeout(TIMEOUTS.SERVER_STARTUP_MS);
    testLogger.info("Starting moose dev server...");

    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: path.join(TEST_PROJECT_DIR, "apps", "moose-backend"),
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
        MOOSE_AUTHENTICATION__ADMIN_API_KEY: TEST_ADMIN_API_KEY_HASH,
      },
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
    );

    testLogger.info("Server started, waiting for infrastructure...");
    await waitForInfrastructureReady();
    testLogger.info("Infrastructure ready");
  });

  // Bug 4: Verify health endpoint returns healthy
  it("should report healthy status", async function () {
    this.timeout(30_000);
    await verifyProxyHealth(["clickhouse_db", "redpanda"]);
  });

  // Bug 3: API empty response test - verifies no crash on empty data
  it("should return empty array from API when no data ingested", async function () {
    this.timeout(30_000);

    const response = await fetch(
      `${SERVER_CONFIG.url}/api/topicTimeseries`,
    );

    expect(response.status).to.equal(200);
    const data = await response.json();
    expect(data).to.be.an("array");
    expect(data).to.have.length(0);
  });

  // Bug 2: Dashboard build test - verifies no server-only module errors
  it("should build dashboard without server-only import errors", async function () {
    this.timeout(120_000);
    testLogger.info("Building dashboard...");

    const { stdout, stderr } = await execAsync("pnpm dashboard:build", {
      cwd: TEST_PROJECT_DIR,
    });

    testLogger.debug("Dashboard build stdout", { stdout });
    if (stderr) {
      testLogger.debug("Dashboard build stderr", { stderr });
    }

    testLogger.info("Dashboard build succeeded");
  });

  // Bug 4: Workflow trigger test
  it("should allow triggering the workflow", async function () {
    this.timeout(30_000);

    // The workflow should be registered and triggerable
    await triggerWorkflow("getGithubEvents");
    testLogger.info("Workflow triggered successfully");
  });
});
