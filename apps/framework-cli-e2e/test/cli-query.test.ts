/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for moose query command (ENG-1226)
 *
 * Tests the query command functionality:
 * 1. Execute SQL from command line argument
 * 2. Execute SQL from file
 * 3. Execute SQL from stdin
 * 4. Respect limit parameter
 * 5. Handle errors gracefully
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { TIMEOUTS } from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  cleanupTestSuite,
  setupTypeScriptProject,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_TS_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("moose query command", () => {
  let devProcess: ChildProcess;
  let testProjectDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    console.log("\n=== Starting Query Command Test ===");

    // Create temp test directory
    testProjectDir = createTempTestDirectory("query-cmd-test");
    console.log("Test project dir:", testProjectDir);

    // Setup TypeScript project
    await setupTypeScriptProject(
      testProjectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_TS_LIB_PATH,
      "test-query-cmd",
      "npm",
    );

    // Start moose dev
    console.log("\nStarting moose dev...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: testProjectDir,
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "development server started",
      "http://localhost:4000",
    );

    console.log("✓ Infrastructure ready");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    console.log("\n=== Cleaning up Query Command Test ===");

    await cleanupTestSuite(devProcess, testProjectDir, "query-cmd-test", {
      logPrefix: "Query Command Test",
    });
  });

  it("should execute simple SELECT query from argument", async function () {
    this.timeout(TIMEOUTS.OPERATION_MS);

    console.log("\n--- Testing query from argument ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query "SELECT 1 as num"`,
      {
        cwd: testProjectDir,
      },
    );

    console.log("Query output:", stdout);

    expect(stdout).to.include('{"num":1}');
    expect(stdout).to.include("1 rows");

    console.log("✓ Query from argument works");
  });

  it("should execute query with multiple rows", async function () {
    this.timeout(TIMEOUTS.OPERATION_MS);

    console.log("\n--- Testing query with multiple rows ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query "SELECT number FROM system.numbers LIMIT 5"`,
      { cwd: testProjectDir },
    );

    const lines = stdout
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("{"));
    expect(lines.length).to.equal(5);

    // Verify JSON format
    lines.forEach((line, idx) => {
      const parsed = JSON.parse(line);
      expect(parsed.number).to.equal(idx);
    });

    console.log("✓ Multiple rows returned correctly");
  });

  it("should execute query from file", async function () {
    this.timeout(TIMEOUTS.OPERATION_MS);

    console.log("\n--- Testing query from file ---");

    const queryFile = path.join(testProjectDir, "test-query.sql");
    fs.writeFileSync(queryFile, "SELECT 'hello' as greeting, 42 as answer");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query -f test-query.sql`,
      { cwd: testProjectDir },
    );

    console.log("Query output:", stdout);

    expect(stdout).to.include('"greeting":"hello"');
    expect(stdout).to.include('"answer":42');

    console.log("✓ Query from file works");
  });

  it("should execute query from stdin", async function () {
    this.timeout(TIMEOUTS.OPERATION_MS);

    console.log("\n--- Testing query from stdin ---");

    const { stdout } = await execAsync(
      `echo "SELECT 'stdin' as source" | "${CLI_PATH}" query`,
      { cwd: testProjectDir, shell: "/bin/bash" },
    );

    console.log("Query output:", stdout);

    expect(stdout).to.include('"source":"stdin"');

    console.log("✓ Query from stdin works");
  });

  it("should respect limit parameter", async function () {
    this.timeout(TIMEOUTS.OPERATION_MS);

    console.log("\n--- Testing limit parameter ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query "SELECT number FROM system.numbers" --limit 3`,
      { cwd: testProjectDir },
    );

    const lines = stdout
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("{"));
    expect(lines.length).to.equal(3);
    expect(stdout).to.include("3 rows");

    console.log("✓ Limit parameter works");
  });

  it("should handle query errors gracefully", async function () {
    this.timeout(TIMEOUTS.OPERATION_MS);

    console.log("\n--- Testing error handling ---");

    try {
      await execAsync(
        `"${CLI_PATH}" query "SELECT * FROM nonexistent_table_xyz"`,
        { cwd: testProjectDir },
      );
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("ClickHouse query error");
      console.log("✓ Query errors handled gracefully");
    }
  });
});
