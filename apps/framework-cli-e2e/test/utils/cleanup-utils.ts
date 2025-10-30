import { ChildProcess } from "child_process";
import { TIMEOUTS } from "../constants";
import { stopDevProcess, killRemainingProcesses } from "./process-utils";
import { cleanupDocker, globalDockerCleanup } from "./docker-utils";
import {
  removeTestProject,
  cleanupLeftoverTestDirectories,
} from "./file-utils";

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
 * Standardized cleanup for E2E test suites
 *
 * Performs cleanup in the following order:
 * 1. Stops the dev process gracefully (SIGINT), with SIGKILL fallback
 * 2. Cleans up Docker containers and volumes (if includeDocker is true)
 * 3. Removes the test project directory
 *
 * On error, forces cleanup of process and directory even if Docker cleanup fails.
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
  }
}

/**
 * Performs global cleanup of all Docker resources, processes, and test directories
 */
export async function performGlobalCleanup(
  logMessage = "Running global cleanup...",
): Promise<void> {
  console.log(logMessage);

  try {
    // Kill any remaining moose-cli processes
    await killRemainingProcesses();

    // Clean up any remaining Docker resources
    await globalDockerCleanup();

    // Clean up any leftover test directories
    cleanupLeftoverTestDirectories();

    console.log("Global cleanup completed");
  } catch (error) {
    console.warn("Error during global cleanup:", error);
  }
}
