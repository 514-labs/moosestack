/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for moose doctor command (ENG-1252)
 *
 * Tests the doctor command functionality:
 * 1. Execute diagnostics with default options
 * 2. Filter by severity level
 * 3. Output as JSON
 * 4. Use verbosity flags
 * 5. Filter by component pattern
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
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

describe("moose doctor command", () => {
  let devProcess: ChildProcess;
  let testProjectDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    console.log("\n=== Starting Doctor Command Test ===");

    // Create temp test directory
    testProjectDir = createTempTestDirectory("doctor-cmd-test");
    console.log("Test project dir:", testProjectDir);

    // Setup TypeScript project
    await setupTypeScriptProject(
      testProjectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_TS_LIB_PATH,
      "test-doctor-cmd",
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
    console.log("\n=== Cleaning up Doctor Command Test ===");

    await cleanupTestSuite(devProcess, testProjectDir, "doctor-cmd-test", {
      logPrefix: "Doctor Command Test",
    });
  });

  it("should execute doctor with default options", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing doctor with default options ---");

    const { stdout } = await execAsync(`"${CLI_PATH}" doctor`, {
      cwd: testProjectDir,
    });

    console.log("Doctor output:", stdout);

    // Should show summary even with no issues
    expect(stdout).to.include("Summary:");
    expect(stdout).to.match(/\d+ errors?, \d+ warnings?, \d+ info messages?/);

    console.log("✓ Doctor command runs with defaults");
  });

  it("should execute doctor with JSON output", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing doctor with JSON output ---");

    const { stdout } = await execAsync(`"${CLI_PATH}" doctor --json`, {
      cwd: testProjectDir,
    });

    console.log("Doctor JSON output:", stdout.substring(0, 200));

    // Parse JSON to ensure it's valid
    const output = JSON.parse(stdout);

    expect(output).to.have.property("issues");
    expect(output).to.have.property("summary");
    expect(output.summary).to.have.property("total_issues");
    expect(output.summary).to.have.property("by_severity");
    expect(output.summary).to.have.property("by_component");

    console.log("✓ JSON output is valid");
  });

  it("should filter by severity level", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing severity filtering ---");

    // Test with info severity (should include everything)
    const { stdout: infoOutput } = await execAsync(
      `"${CLI_PATH}" doctor --severity info`,
      {
        cwd: testProjectDir,
      },
    );

    expect(infoOutput).to.include("Summary:");

    // Test with error severity (default)
    const { stdout: errorOutput } = await execAsync(
      `"${CLI_PATH}" doctor --severity error`,
      {
        cwd: testProjectDir,
      },
    );

    expect(errorOutput).to.include("Summary:");

    console.log("✓ Severity filtering works");
  });

  it("should respect verbosity flags", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing verbosity flags ---");

    // Test with -v
    const { stdout: verboseOutput } = await execAsync(
      `"${CLI_PATH}" doctor -v`,
      {
        cwd: testProjectDir,
      },
    );

    expect(verboseOutput).to.include("Summary:");

    // Test with -vv
    const { stdout: veryVerboseOutput } = await execAsync(
      `"${CLI_PATH}" doctor -vv`,
      {
        cwd: testProjectDir,
      },
    );

    expect(veryVerboseOutput).to.include("Summary:");

    // Test with -vvv
    const { stdout: maxVerboseOutput } = await execAsync(
      `"${CLI_PATH}" doctor -vvv`,
      {
        cwd: testProjectDir,
      },
    );

    expect(maxVerboseOutput).to.include("Summary:");

    console.log("✓ Verbosity flags work");
  });

  it("should filter by component pattern", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing component filtering ---");

    // Use a glob pattern that won't match anything
    const { stdout } = await execAsync(
      `"${CLI_PATH}" doctor --component "nonexistent_*"`,
      {
        cwd: testProjectDir,
      },
    );

    expect(stdout).to.include("Summary:");
    // With no matching components, should show 0 issues
    expect(stdout).to.match(/0 errors?, 0 warnings?, 0 info messages?/);

    console.log("✓ Component filtering works");
  });

  it("should respect since parameter", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing since parameter ---");

    // Test with different time windows
    const { stdout: hours1 } = await execAsync(
      `"${CLI_PATH}" doctor --since "1 hour"`,
      {
        cwd: testProjectDir,
      },
    );

    expect(hours1).to.include("Summary:");

    const { stdout: days1 } = await execAsync(
      `"${CLI_PATH}" doctor --since "1 day"`,
      {
        cwd: testProjectDir,
      },
    );

    expect(days1).to.include("Summary:");

    const { stdout: minutes30 } = await execAsync(
      `"${CLI_PATH}" doctor --since "30m"`,
      {
        cwd: testProjectDir,
      },
    );

    expect(minutes30).to.include("Summary:");

    console.log("✓ Since parameter works");
  });

  it("should combine multiple options", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing combined options ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" doctor --severity warning --json -v`,
      {
        cwd: testProjectDir,
      },
    );

    // Should be valid JSON
    const output = JSON.parse(stdout);
    expect(output).to.have.property("issues");
    expect(output).to.have.property("summary");

    console.log("✓ Combined options work");
  });

  it("should handle invalid severity gracefully", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing invalid severity handling ---");

    try {
      await execAsync(`"${CLI_PATH}" doctor --severity invalid`, {
        cwd: testProjectDir,
      });
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.match(/Failed to parse severity|must be one of/);
      console.log("✓ Invalid severity handled gracefully");
    }
  });

  it("should handle invalid duration gracefully", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing invalid duration handling ---");

    try {
      await execAsync(`"${CLI_PATH}" doctor --since "invalid"`, {
        cwd: testProjectDir,
      });
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.match(/Failed to parse time duration/);
      console.log("✓ Invalid duration handled gracefully");
    }
  });
});
