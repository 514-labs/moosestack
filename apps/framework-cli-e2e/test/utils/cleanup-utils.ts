import { ChildProcess } from "child_process";
import { TIMEOUTS } from "../constants";
import { stopDevProcess } from "./process-utils";
import { cleanupDocker } from "./docker-utils";
import { removeTestProject } from "./file-utils";

/**
 * Options for test suite cleanup
 */
export interface CleanupOptions {
  /** Timeout in milliseconds for cleanup operations (defaults to TIMEOUTS.CLEANUP_MS) */
  timeout?: number;
  /** Whether to clean up Docker resources (defaults to true) */
  includeDocker?: boolean;
  /** Optional prefix for log messages */
  logPrefix?: string;
}

/**
 * Delete today's moose CLI log file to ensure a clean state for testing.
 * This is exported so tests can call it at the START of each test (before spawning moose dev)
 * to handle cases where the previous test crashed without running cleanup.
 */
export function cleanupMooseLogFile(): void {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  const logFilePath = path.join(os.homedir(), ".moose", `${dateStr}-cli.log`);

  try {
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
      console.log(`Deleted log file: ${logFilePath}`);
    }
  } catch (error) {
    console.warn(`Could not delete log file ${logFilePath}:`, error);
  }
}

/**
 * Standardized cleanup for E2E test suites
 *
 * Performs cleanup in the following order:
 * 1. Stops the dev process gracefully (SIGINT), with SIGKILL fallback
 * 2. Cleans up Docker containers and volumes (if includeDocker is true)
 * 3. Removes the test project directory
 * 4. Deletes the moose CLI log file (ensures next test starts fresh)
 *
 * On error, forces cleanup of process and directory even if Docker cleanup fails.
 *
 * @param devProcess - The moose dev process to stop
 * @param testProjectDir - Directory containing the test project
 * @param appName - Application name used for Docker resources
 * @param options - Optional cleanup configuration
 *
 * @example
 * ```typescript
 * after(async function () {
 *   this.timeout(TIMEOUTS.CLEANUP_MS);
 *   await cleanupTestSuite(devProcess, TEST_PROJECT_DIR, APP_NAMES.TYPESCRIPT_TESTS, {
 *     logPrefix: "TypeScript S3Queue Test"
 *   });
 * });
 * ```
 */
export async function cleanupTestSuite(
  devProcess: ChildProcess | null,
  testProjectDir: string,
  appName: string,
  options: CleanupOptions = {},
): Promise<void> {
  const { includeDocker = true, logPrefix = "Test suite" } = options;

  try {
    if (logPrefix) {
      console.log(`Starting cleanup for ${logPrefix}...`);
    }

    // Step 1: Stop the dev process
    await stopDevProcess(devProcess);

    // Step 2: Clean up Docker resources (if enabled)
    if (includeDocker) {
      await cleanupDocker(testProjectDir, appName);
    }

    // Step 3: Remove test project directory
    removeTestProject(testProjectDir);

    // Step 4: Clean up moose CLI log file (ensures next test starts fresh)
    cleanupMooseLogFile();

    if (logPrefix) {
      console.log(`Cleanup completed for ${logPrefix}`);
    }
  } catch (error) {
    console.error("Error during cleanup:", error);

    // Force cleanup even if some steps fail
    try {
      if (devProcess && !devProcess.killed) {
        devProcess.kill("SIGKILL");
      }
    } catch (killError) {
      console.error("Error killing process:", killError);
    }

    // Always try to remove the test directory
    removeTestProject(testProjectDir);

    // Always try to clean up log file
    try {
      cleanupMooseLogFile();
    } catch (logError) {
      console.error("Error cleaning up log file:", logError);
    }
  }
}
