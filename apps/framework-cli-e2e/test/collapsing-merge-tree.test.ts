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

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as path from "path";

// Import constants and utilities
import { TIMEOUTS, TEMPLATE_NAMES, APP_NAMES } from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  cleanupTestSuite,
  performGlobalCleanup,
  createTempTestDirectory,
  setupTypeScriptProject,
  setupPythonProject,
  getTableDDL,
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

describe("CollapsingMergeTree and VersionedCollapsingMergeTree Engine Tests", function () {
  this.timeout(TIMEOUTS.SUITE);

  describe("TypeScript Template - CollapsingMergeTree Engines", function () {
    let devProcess: ChildProcess | null = null;
    let testDir: string = "";
    const appName = APP_NAMES.TYPESCRIPT_TESTS;

    before(async function () {
      this.timeout(TIMEOUTS.SETUP);
      console.log("\n🚀 Setting up TypeScript CollapsingMergeTree test...\n");

      testDir = await createTempTestDirectory();
      console.log(`Created temporary directory: ${testDir}`);

      console.log("Setting up TypeScript project...");
      devProcess = await setupTypeScriptProject(
        CLI_PATH,
        testDir,
        TEMPLATE_NAMES.TYPESCRIPT_TESTS,
        appName,
        MOOSE_LIB_PATH,
        TEST_PACKAGE_MANAGER as "npm" | "pnpm",
      );

      console.log("Waiting for server to start...");
      await waitForServerStart(devProcess, TIMEOUTS.SERVER_START);

      console.log("Waiting for infrastructure to be ready...");
      await waitForInfrastructureReady(devProcess, TIMEOUTS.INFRASTRUCTURE);

      console.log("✅ TypeScript test setup completed successfully\n");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP);
      await cleanupTestSuite(
        devProcess,
        testDir,
        "TypeScript CollapsingMergeTree test",
      );
    });

    it("should create CollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL("CollapsingMergeTreeTest", "local");
      console.log("CollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has CollapsingMergeTree engine
      expect(ddl).to.include("CollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      console.log("✅ CollapsingMergeTree table created successfully");
    });

    it("should create VersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL(
        "VersionedCollapsingMergeTreeTest",
        "local",
      );
      console.log("VersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has VersionedCollapsingMergeTree engine
      expect(ddl).to.include("VersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      console.log("✅ VersionedCollapsingMergeTree table created successfully");
    });

    it("should create ReplicatedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL(
        "ReplicatedCollapsingMergeTreeTest",
        "local",
      );
      console.log("ReplicatedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      // Verify it has replication parameters (keeper path and replica name)
      expect(ddl).to.match(
        /ReplicatedCollapsingMergeTree\([^)]*replicated_collapsing_test[^)]*\)/,
      );
      console.log(
        "✅ ReplicatedCollapsingMergeTree table created successfully",
      );
    });

    it("should create ReplicatedVersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL(
        "ReplicatedVersionedCollapsingMergeTreeTest",
        "local",
      );
      console.log("ReplicatedVersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedVersionedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedVersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      // Verify it has replication parameters
      expect(ddl).to.match(
        /ReplicatedVersionedCollapsingMergeTree\([^)]*replicated_versioned_collapsing_test[^)]*\)/,
      );
      console.log(
        "✅ ReplicatedVersionedCollapsingMergeTree table created successfully",
      );
    });
  });

  describe("Python Template - CollapsingMergeTree Engines", function () {
    let devProcess: ChildProcess | null = null;
    let testDir: string = "";
    const appName = APP_NAMES.PYTHON_TESTS;

    before(async function () {
      this.timeout(TIMEOUTS.SETUP);
      console.log("\n🚀 Setting up Python CollapsingMergeTree test...\n");

      testDir = await createTempTestDirectory();
      console.log(`Created temporary directory: ${testDir}`);

      console.log("Setting up Python project...");
      devProcess = await setupPythonProject(
        CLI_PATH,
        testDir,
        TEMPLATE_NAMES.PYTHON_TESTS,
        appName,
        MOOSE_PY_LIB_PATH,
        TEST_PACKAGE_MANAGER as "pip",
      );

      console.log("Waiting for server to start...");
      await waitForServerStart(devProcess, TIMEOUTS.SERVER_START);

      console.log("Waiting for infrastructure to be ready...");
      await waitForInfrastructureReady(devProcess, TIMEOUTS.INFRASTRUCTURE);

      console.log("✅ Python test setup completed successfully\n");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP);
      await cleanupTestSuite(
        devProcess,
        testDir,
        "Python CollapsingMergeTree test",
      );
    });

    it("should create CollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL("CollapsingMergeTreeTest", "local");
      console.log("CollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has CollapsingMergeTree engine
      expect(ddl).to.include("CollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      console.log("✅ CollapsingMergeTree table created successfully");
    });

    it("should create VersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL(
        "VersionedCollapsingMergeTreeTest",
        "local",
      );
      console.log("VersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has VersionedCollapsingMergeTree engine
      expect(ddl).to.include("VersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      console.log("✅ VersionedCollapsingMergeTree table created successfully");
    });

    it("should create ReplicatedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL(
        "ReplicatedCollapsingMergeTreeTest",
        "local",
      );
      console.log("ReplicatedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      // Verify it has replication parameters
      expect(ddl).to.match(
        /ReplicatedCollapsingMergeTree\([^)]*replicated_collapsing_test[^)]*\)/,
      );
      console.log(
        "✅ ReplicatedCollapsingMergeTree table created successfully",
      );
    });

    it("should create ReplicatedVersionedCollapsingMergeTree table with correct engine configuration", async function () {
      this.timeout(TIMEOUTS.TEST);

      const ddl = await getTableDDL(
        "ReplicatedVersionedCollapsingMergeTreeTest",
        "local",
      );
      console.log("ReplicatedVersionedCollapsingMergeTreeTest DDL:", ddl);

      // Verify the table exists and has ReplicatedVersionedCollapsingMergeTree engine
      expect(ddl).to.include("ReplicatedVersionedCollapsingMergeTree");
      expect(ddl).to.include("`sign`");
      expect(ddl).to.include("`version`");
      // Verify it has replication parameters
      expect(ddl).to.match(
        /ReplicatedVersionedCollapsingMergeTree\([^)]*replicated_versioned_collapsing_test[^)]*\)/,
      );
      console.log(
        "✅ ReplicatedVersionedCollapsingMergeTree table created successfully",
      );
    });
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP);
    await performGlobalCleanup(
      "CollapsingMergeTree and VersionedCollapsingMergeTree engine tests",
    );
  });
});
