import { ChildProcess } from "child_process";
import { TIMEOUTS } from "../constants";
import { stopDevProcess, killRemainingProcesses } from "./process-utils";
import { cleanupDocker, globalDockerCleanup } from "./docker-utils";
import {
  removeTestProject,
  cleanupLeftoverTestDirectories,
} from "./file-utils";
import { logger, ScopedLogger } from "./logger";

const cleanupLogger = logger.scope("utils:cleanup");

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
  /** Optional logger (uses test context logger if provided) */
  logger?: ScopedLogger;
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
  const {
    includeDocker = true,
    logPrefix = "Test suite",
    logger: log = cleanupLogger,
  } = options;

  try {
    if (logPrefix) {
      log.info(`Starting cleanup for ${logPrefix}`);
    }

    // Step 1: Stop the dev process
    log.debug("Stopping dev process");
    await stopDevProcess(devProcess, { logger: log });

    // Step 2: Clean up Docker resources (if enabled)
    if (includeDocker) {
      log.debug("Cleaning up Docker resources", { appName });
      await cleanupDocker(testProjectDir, appName, { logger: log });
    }

    // Step 3: Remove test project directory
    log.debug("Removing test project directory", { path: testProjectDir });
    removeTestProject(testProjectDir, { logger: log });

    if (logPrefix) {
      log.info(`✓ Cleanup completed for ${logPrefix}`);
    }
  } catch (error) {
    log.error("Error during cleanup", error);

    // Force cleanup even if some steps fail
    try {
      if (devProcess && !devProcess.killed) {
        log.warn("Force killing process with SIGKILL");
        devProcess.kill("SIGKILL");
      }
    } catch (killError) {
      log.error("Error killing process", killError);
    }

    // Always try to remove the test directory
    removeTestProject(testProjectDir, { logger: log });
  }
}

/**
 * Performs global cleanup of all Docker resources, processes, and test directories
 */
export async function performGlobalCleanup(
  logMessage = "Running global cleanup...",
): Promise<void> {
  const globalLogger = logger.scope("global-cleanup");
  globalLogger.info(logMessage);

  try {
    // Kill any remaining moose-cli processes
    globalLogger.debug("Killing remaining moose-cli processes");
    await killRemainingProcesses();

    // Clean up any remaining Docker resources
    globalLogger.debug("Cleaning up Docker resources");
    await globalDockerCleanup({ logger: globalLogger });

    // Clean up any leftover test directories
    globalLogger.debug("Cleaning up leftover test directories");
    cleanupLeftoverTestDirectories({ logger: globalLogger });

    globalLogger.info("✓ Global cleanup completed");
  } catch (error) {
    globalLogger.warn("Error during global cleanup", error);
  }
}
