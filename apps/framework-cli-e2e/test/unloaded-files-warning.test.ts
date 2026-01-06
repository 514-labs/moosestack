/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Tests for unloaded files warning in dev mode.
 *
 * This test verifies that the framework properly detects and warns about
 * source files that exist but weren't loaded (not imported/required).
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

// Import constants and utilities
import {
  TIMEOUTS,
  SERVER_CONFIG,
  APP_NAMES,
  TEMPLATE_NAMES,
} from "./constants";

import {
  createTempTestDirectory,
  setupTypeScriptProject,
  setupPythonProject,
  logger,
} from "./utils";
import {
  stopDevProcess,
  killRemainingProcesses,
  waitForOutputMessage,
  captureProcessOutput,
  waitForServerStart,
} from "./utils/process-utils";

const testLogger = logger.scope("unloaded-files-test");

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);

// Add these constants for timeouts
const INFRASTRUCTURE_TIMEOUT_MS = 90_000; // 90 seconds
const SUITE_TIMEOUT_MS = 300_000; // 5 minutes

describe("Unloaded Files Warning", () => {
  let testDir: string;
  let devProcess: ChildProcess | null = null;

  afterEach(async () => {
    await stopDevProcess(devProcess, { logger: testLogger });
    devProcess = null;
    await killRemainingProcesses({ logger: testLogger });

    if (testDir && fs.existsSync(testDir)) {
      testLogger.debug("Cleaning up test directory", { testDir });
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("TypeScript Project", () => {
    it("should warn about unloaded TypeScript files in dev mode", async function () {
      this.timeout(SUITE_TIMEOUT_MS);

      testLogger.info("🧪 Testing unloaded files warning for TypeScript");

      // Create a temporary test directory
      testDir = createTempTestDirectory("unloaded-ts");
      testLogger.debug("Created test directory", { testDir });

      // Set up a basic TypeScript project
      await setupTypeScriptProject(
        testDir,
        TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
        CLI_PATH,
        MOOSE_LIB_PATH,
        "test-unloaded-ts",
        "npm",
      );
      testLogger.debug("Set up TypeScript project");

      // Create an unloaded file (not imported anywhere)
      const unloadedFilePath = path.join(testDir, "src", "unloaded_table.ts");
      const unloadedFileContent = `
import { OlapTable } from "@514labs/moose-lib";

interface UnloadedTestModel {
  id: string;
  name: string;
  createdAt: Date;
}

// This table won't be registered because the file isn't imported
export const unloadedTable = OlapTable<UnloadedTestModel>({
  name: "unloaded_test_table",
  orderByFields: ["id"],
});
`;

      fs.writeFileSync(unloadedFilePath, unloadedFileContent);
      testLogger.debug("Created unloaded file", { unloadedFilePath });

      // Start moose dev and capture output
      testLogger.debug("Starting moose dev");
      devProcess = spawn(CLI_PATH, ["dev"], {
        cwd: testDir,
        env: {
          ...process.env,
          MOOSE_LOGGER__LEVEL: "Debug",
        },
      });

      // Wait for both the warning message and the specific file name
      // Using a single call avoids race conditions where both strings
      // might appear in the same output chunk
      const messagesFound = await waitForOutputMessage(
        devProcess,
        ["Unloaded Files", "unloaded_table.ts"],
        INFRASTRUCTURE_TIMEOUT_MS,
        { logger: testLogger },
      );

      expect(
        messagesFound,
        "Should display unloaded files warning and mention the file name",
      ).to.be.true;

      testLogger.info("✓ Unloaded files warning test passed for TypeScript");
    });
  });

  describe("Python Project", () => {
    it("should warn about unloaded Python files in dev mode", async function () {
      this.timeout(SUITE_TIMEOUT_MS);

      testLogger.info("🧪 Testing unloaded files warning for Python");

      // Create a temporary test directory
      testDir = createTempTestDirectory("unloaded-py");
      testLogger.debug("Created test directory", { testDir });

      // Set up a basic Python project
      await setupPythonProject(
        testDir,
        TEMPLATE_NAMES.PYTHON_DEFAULT,
        CLI_PATH,
        MOOSE_PY_LIB_PATH,
        "test-unloaded-py",
      );
      testLogger.debug("Set up Python project");

      // Create an unloaded file (not imported anywhere)
      const unloadedFilePath = path.join(testDir, "app", "unloaded_table.py");
      const unloadedFileContent = `
"""
This file is intentionally not imported anywhere.
It should be detected as an unloaded file.
"""

from moose_lib.dmv2 import OlapTable
from pydantic import BaseModel
from datetime import datetime


class UnloadedTestModel(BaseModel):
    id: str
    name: str
    created_at: datetime


# This table won't be registered because the file isn't imported
unloaded_table = OlapTable[UnloadedTestModel](
    "unloaded_test_table",
    order_by_fields=["id"]
)
`;

      fs.writeFileSync(unloadedFilePath, unloadedFileContent);
      testLogger.debug("Created unloaded file", { unloadedFilePath });

      // Start moose dev and capture output
      testLogger.debug("Starting moose dev");
      devProcess = spawn(CLI_PATH, ["dev"], {
        cwd: testDir,
        env: {
          ...process.env,
          MOOSE_LOGGER__LEVEL: "Debug",
        },
      });

      // Wait for both the warning message and the specific file name
      // Using a single call avoids race conditions where both strings
      // might appear in the same output chunk
      const messagesFound = await waitForOutputMessage(
        devProcess,
        ["Unloaded Files", "unloaded_table.py"],
        INFRASTRUCTURE_TIMEOUT_MS,
        { logger: testLogger },
      );

      expect(
        messagesFound,
        "Should display unloaded files warning and mention the file name",
      ).to.be.true;

      testLogger.info("✓ Unloaded files warning test passed for Python");
    });
  });

  describe("No Warning for Fully Loaded Projects", () => {
    it("should NOT warn when all TypeScript files are properly imported", async function () {
      this.timeout(SUITE_TIMEOUT_MS);

      testLogger.info(
        "🧪 Testing no false warnings for fully loaded TypeScript project",
      );

      // Create a temporary test directory
      testDir = createTempTestDirectory("fully-loaded-ts");
      testLogger.debug("Created test directory", { testDir });

      // Set up a basic TypeScript project
      await setupTypeScriptProject(
        testDir,
        TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
        CLI_PATH,
        MOOSE_LIB_PATH,
        "test-fully-loaded-ts",
        "npm",
      );
      testLogger.debug("Set up TypeScript project");

      // Create a file and properly import it
      const tableFilePath = path.join(testDir, "src", "models", "MyTable.ts");
      fs.mkdirSync(path.dirname(tableFilePath), { recursive: true });

      const tableFileContent = `
import { OlapTable } from "@514labs/moose-lib";

interface MyModel {
  id: string;
  name: string;
}

export const myTable = OlapTable<MyModel>({
  name: "my_table",
  orderByFields: ["id"],
});
`;

      fs.writeFileSync(tableFilePath, tableFileContent);

      // Import it in index.ts
      const indexPath = path.join(testDir, "src", "index.ts");
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      fs.writeFileSync(
        indexPath,
        indexContent + '\nexport * from "./models/MyTable";\n',
      );

      testLogger.debug("Created and imported table file", { tableFilePath });

      // Start moose dev and capture output
      testLogger.debug("Starting moose dev");

      devProcess = spawn(CLI_PATH, ["dev"], {
        cwd: testDir,
        env: {
          ...process.env,
          MOOSE_LOGGER__LEVEL: "Debug",
        },
      });

      // Capture all output
      const output = captureProcessOutput(devProcess);

      // Wait for server to start
      await waitForServerStart(
        devProcess,
        INFRASTRUCTURE_TIMEOUT_MS,
        "started successfully",
        "http://localhost:4000",
        { logger: testLogger },
      );

      const capturedOutput = output.stdout + output.stderr;

      // Verify no warning was shown
      expect(
        capturedOutput.includes("Unloaded Files"),
        "Should NOT display unloaded files warning when all files are imported",
      ).to.be.false;

      testLogger.info(
        "✓ No false warning test passed for fully loaded TypeScript project",
      );
    });
  });
});
