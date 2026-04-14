/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

/**
 * End-to-end tests for CollapsingMergeTree and VersionedCollapsingMergeTree engines.
 *
 * These tests verify that:
 * 1. Tables using CollapsingMergeTree and VersionedCollapsingMergeTree engines are created correctly
 * 2. Both regular and replicated variants work properly
 * 3. The sign and version parameters are correctly passed to ClickHouse
 */

import { ChildProcess } from "child_process";
import { expect } from "chai";
import * as path from "path";

// Import constants and utilities
import {
  TIMEOUTS,
  TEMPLATE_NAMES,
  APP_NAMES,
  TEST_ADMIN_API_KEY_HASH,
} from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  waitForStreamingFunctions,
  cleanupTestSuite,
  performGlobalCleanup,
  createTempTestDirectory,
  setupTypeScriptProject,
  setupPythonProject,
  getTableDDL,
  logger,
  buildClickHouseConfig,
  buildServerConfig,
  getCleanupOptionsForMode,
  getTestPorts,
  resolveE2eDevMode,
  startMooseDev,
  isDockerlessMode,
} from "./utils";

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

const testLogger = logger.scope("collapsing-merge-tree-test");
const E2E_DEV_MODE = resolveE2eDevMode({ logger: testLogger });
const TS_PORTS = getTestPorts(70);
const PY_PORTS = getTestPorts(80);
const TS_CLICKHOUSE = buildClickHouseConfig(TS_PORTS);
const PY_CLICKHOUSE = buildClickHouseConfig(PY_PORTS);
const TS_SERVER = buildServerConfig(TS_PORTS);
const PY_SERVER = buildServerConfig(PY_PORTS);
const buildSuiteEnv = () => ({
  TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
  TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
  MOOSE_AUTHENTICATION__ADMIN_API_KEY: TEST_ADMIN_API_KEY_HASH,
});

describe("CollapsingMergeTree and VersionedCollapsingMergeTree Engine Tests", function () {
  describe("TypeScript Template - CollapsingMergeTree Engines", function () {
    let devProcess: ChildProcess | null = null;
    let testDir: string = "";
    const appName = APP_NAMES.TYPESCRIPT_TESTS;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);
      testLogger.info(
        "\n🚀 Setting up TypeScript CollapsingMergeTree test...\n",
      );

      testDir = createTempTestDirectory("ts-collapsing-mt");
      testLogger.info(`Created temporary directory: ${testDir}`);

      testLogger.info("Setting up TypeScript project...");
      await setupTypeScriptProject(
        testDir,
        TEMPLATE_NAMES.TYPESCRIPT_TESTS,
        CLI_PATH,
        MOOSE_LIB_PATH,
        appName,
        TEST_PACKAGE_MANAGER as "npm" | "pnpm",
      );

      testLogger.info("Starting dev server...");
      devProcess = startMooseDev({
        cliPath: CLI_PATH,
        cwd: testDir,
        projectDir: testDir,
        mode: E2E_DEV_MODE,
        ports: TS_PORTS,
        extraEnv: buildSuiteEnv(),
      }).devProcess;

      testLogger.info("Waiting for server to start...");
      await waitForServerStart(
        devProcess,
        TIMEOUTS.SERVER_STARTUP_MS,
        TS_SERVER.startupMessage,
        TS_SERVER.url,
      );

      testLogger.info("Waiting for streaming functions...");
      await waitForStreamingFunctions(120000, {
        dockerless: isDockerlessMode(E2E_DEV_MODE),
        baseUrl: TS_SERVER.url,
      });

      testLogger.info("Waiting for infrastructure to be ready...");
      await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
        baseUrl: TS_SERVER.url,
      });

      testLogger.info("✅ TypeScript test setup completed successfully\n");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      await cleanupTestSuite(devProcess, testDir, appName, {
        logPrefix: "TypeScript CollapsingMergeTree test",
        ...getCleanupOptionsForMode(E2E_DEV_MODE),
        ports: TS_PORTS,
      });
    });

    it("should create CollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL("CollapsingMergeTreeTest", "local", {
        clickhouseConfig: TS_CLICKHOUSE,
      });
      testLogger.info("CollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has CollapsingMergeTree engine
      expect(ddl).to.include("CollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      testLogger.info("✅ CollapsingMergeTree table created successfully");
    });

    it("should create VersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL(
        "VersionedCollapsingMergeTreeTest",
        "local",
        {
          clickhouseConfig: TS_CLICKHOUSE,
        },
      );
      testLogger.info("VersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has VersionedCollapsingMergeTree engine
      expect(ddl).to.include("VersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      testLogger.info(
        "✅ VersionedCollapsingMergeTree table created successfully",
      );
    });

    it("should create ReplicatedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL(
        "ReplicatedCollapsingMergeTreeTest",
        "local",
        {
          clickhouseConfig: TS_CLICKHOUSE,
        },
      );
      testLogger.info("ReplicatedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      // Verify it has replication parameters (keeper path and replica name)
      expect(ddl).to.match(
        /ReplicatedCollapsingMergeTree\([^)]*replicated_collapsing_test[^)]*\)/,
      );
      testLogger.info(
        "✅ ReplicatedCollapsingMergeTree table created successfully",
      );
    });

    it("should create ReplicatedVersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL(
        "ReplicatedVersionedCollapsingMergeTreeTest",
        "local",
        {
          clickhouseConfig: TS_CLICKHOUSE,
        },
      );
      testLogger.info("ReplicatedVersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedVersionedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedVersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      // Verify it has replication parameters
      expect(ddl).to.match(
        /ReplicatedVersionedCollapsingMergeTree\([^)]*replicated_versioned_collapsing_test[^)]*\)/,
      );
      testLogger.info(
        "✅ ReplicatedVersionedCollapsingMergeTree table created successfully",
      );
    });
  });

  describe("Python Template - CollapsingMergeTree Engines", function () {
    let devProcess: ChildProcess | null = null;
    let testDir: string = "";
    const appName = APP_NAMES.PYTHON_TESTS;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);
      testLogger.info("\n🚀 Setting up Python CollapsingMergeTree test...\n");

      testDir = createTempTestDirectory("py-collapsing-mt");
      testLogger.info(`Created temporary directory: ${testDir}`);

      testLogger.info("Setting up Python project...");
      await setupPythonProject(
        testDir,
        TEMPLATE_NAMES.PYTHON_TESTS,
        CLI_PATH,
        MOOSE_PY_LIB_PATH,
        appName,
      );

      testLogger.info("Starting dev server...");
      devProcess = startMooseDev({
        cliPath: CLI_PATH,
        cwd: testDir,
        projectDir: testDir,
        language: "python",
        mode: E2E_DEV_MODE,
        ports: PY_PORTS,
        extraEnv: buildSuiteEnv(),
      }).devProcess;

      testLogger.info("Waiting for server to start...");
      await waitForServerStart(
        devProcess,
        TIMEOUTS.SERVER_STARTUP_MS,
        PY_SERVER.startupMessage,
        PY_SERVER.url,
      );

      testLogger.info("Waiting for streaming functions...");
      await waitForStreamingFunctions(120000, {
        dockerless: isDockerlessMode(E2E_DEV_MODE),
        baseUrl: PY_SERVER.url,
      });

      testLogger.info("Waiting for infrastructure to be ready...");
      await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
        baseUrl: PY_SERVER.url,
      });

      testLogger.info("✅ Python test setup completed successfully\n");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      await cleanupTestSuite(devProcess, testDir, appName, {
        logPrefix: "Python CollapsingMergeTree test",
        ...getCleanupOptionsForMode(E2E_DEV_MODE),
        ports: PY_PORTS,
      });
    });

    it("should create CollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL("CollapsingMergeTreeTest", "local", {
        clickhouseConfig: PY_CLICKHOUSE,
      });
      testLogger.info("CollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has CollapsingMergeTree engine
      expect(ddl).to.include("CollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      testLogger.info("✅ CollapsingMergeTree table created successfully");
    });

    it("should create VersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL(
        "VersionedCollapsingMergeTreeTest",
        "local",
        {
          clickhouseConfig: PY_CLICKHOUSE,
        },
      );
      testLogger.info("VersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has VersionedCollapsingMergeTree engine
      expect(ddl).to.include("VersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      testLogger.info(
        "✅ VersionedCollapsingMergeTree table created successfully",
      );
    });

    it("should create ReplicatedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL(
        "ReplicatedCollapsingMergeTreeTest",
        "local",
        {
          clickhouseConfig: PY_CLICKHOUSE,
        },
      );
      testLogger.info("ReplicatedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      // Verify it has replication parameters
      expect(ddl).to.match(
        /ReplicatedCollapsingMergeTree\([^)]*replicated_collapsing_test[^)]*\)/,
      );
      testLogger.info(
        "✅ ReplicatedCollapsingMergeTree table created successfully",
      );
    });

    it("should create ReplicatedVersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      const ddl = await getTableDDL(
        "ReplicatedVersionedCollapsingMergeTreeTest",
        "local",
        {
          clickhouseConfig: PY_CLICKHOUSE,
        },
      );
      testLogger.info("ReplicatedVersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedVersionedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedVersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      // Verify it has replication parameters
      expect(ddl).to.match(
        /ReplicatedVersionedCollapsingMergeTree\([^)]*replicated_versioned_collapsing_test[^)]*\)/,
      );
      testLogger.info(
        "✅ ReplicatedVersionedCollapsingMergeTree table created successfully",
      );
    });
  });

  after(async function () {
    this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
    await performGlobalCleanup();
  });
});
