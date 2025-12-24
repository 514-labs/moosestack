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
import { stopDevProcess, killRemainingProcesses } from "./utils/process-utils";

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

/**
 * Waits for a specific message in the dev process output
 */
const waitForOutputMessage = async (
  devProcess: ChildProcess,
  expectedMessage: string,
  timeout: number,
): Promise<boolean> => {
  return new Promise<boolean>((resolve, reject) => {
    let messageFound = false;
    let timeoutId: any = null;
    let outputBuffer = "";

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      devProcess.stdout?.off("data", onStdout);
      devProcess.stderr?.off("data", onStderr);
      devProcess.off("exit", onExit);
    };

    const onStdout = (data: any) => {
      const output = data.toString();
      outputBuffer += output;
      testLogger.debug("Dev process stdout", { output: output.trim() });

      if (output.includes(expectedMessage)) {
        messageFound = true;
        cleanup();
        resolve(true);
      }
    };

    const onStderr = (data: any) => {
      const output = data.toString();
      outputBuffer += output;
      testLogger.debug("Dev process stderr", { stderr: output.trim() });

      if (output.includes(expectedMessage)) {
        messageFound = true;
        cleanup();
        resolve(true);
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      if (!messageFound) {
        testLogger.error("Process exited without finding message", {
          exitCode: code,
          outputBuffer: outputBuffer.slice(0, 1000),
        });
        reject(
          new Error(
            `Process exited with code ${code} before message was found`,
          ),
        );
      }
    };

    devProcess.stdout?.on("data", onStdout);
    devProcess.stderr?.on("data", onStderr);
    devProcess.on("exit", onExit);

    timeoutId = setTimeout(() => {
      cleanup();
      if (!messageFound) {
        testLogger.error("Timeout waiting for message", {
          expectedMessage,
          receivedOutput: outputBuffer.slice(0, 1000),
        });
        resolve(false);
      }
    }, timeout);
  });
};

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

      // Wait for the unloaded files warning
      const warningFound = await waitForOutputMessage(
        devProcess,
        "Unloaded Files",
        TIMEOUTS.INFRASTRUCTURE_TIMEOUT_MS,
      );

      expect(warningFound, "Should display unloaded files warning").to.be.true;

      // Also verify the specific file is mentioned
      const fileNameFound = await waitForOutputMessage(
        devProcess,
        "unloaded_table.ts",
        5000,
      );

      expect(fileNameFound, "Should mention the unloaded file name").to.be.true;

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

      // Wait for the unloaded files warning
      const warningFound = await waitForOutputMessage(
        devProcess,
        "Unloaded Files",
        TIMEOUTS.INFRASTRUCTURE_TIMEOUT_MS,
      );

      expect(warningFound, "Should display unloaded files warning").to.be.true;

      // Also verify the specific file is mentioned
      const fileNameFound = await waitForOutputMessage(
        devProcess,
        "unloaded_table.py",
        5000,
      );

      expect(fileNameFound, "Should mention the unloaded file name").to.be.true;

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
      let capturedOutput = "";

      devProcess = spawn(CLI_PATH, ["dev"], {
        cwd: testDir,
        env: {
          ...process.env,
          MOOSE_LOGGER__LEVEL: "Debug",
        },
      });

      // Capture all output for a period of time
      const capturePromise = new Promise<void>((resolve) => {
        devProcess!.stdout?.on("data", (data) => {
          capturedOutput += data.toString();
        });
        devProcess!.stderr?.on("data", (data) => {
          capturedOutput += data.toString();
        });

        // Wait for server to start
        setTimeout(resolve, 30000);
      });

      await capturePromise;

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
