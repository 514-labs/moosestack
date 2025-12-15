import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { logger, ScopedLogger } from "./logger";

const fileLogger = logger.scope("utils:file");

export interface FileOptions {
  logger?: ScopedLogger;
}

/**
 * Removes a test project directory with retry logic for race conditions
 */
export const removeTestProject = (
  dir: string,
  options: FileOptions = {},
): void => {
  const log = options.logger ?? fileLogger;
  log.debug("Deleting test directory", { path: dir });

  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    log.debug("✓ Test directory deleted");
  } catch (error: any) {
    // Log but don't throw to avoid breaking tests
    log.warn(`Failed to delete ${dir}`, { error: error.message });
  }
};

/**
 * Generates a random temporary directory path for test projects
 * Returns the full path (directory is not created yet - CLI will create it)
 */
export const createTempTestDirectory = (
  suffix: string,
  options: FileOptions = {},
): string => {
  const log = options.logger ?? fileLogger;
  const tempDir = os.tmpdir();
  const randomDir = `moose-e2e-test-${suffix}-${randomUUID()}`;
  const fullPath = path.join(tempDir, randomDir);

  log.debug("Generated temporary test directory path", { path: fullPath });
  return fullPath;
};

/**
 * Cleans up leftover test directories in the temp folder
 */
export const cleanupLeftoverTestDirectories = (
  options: FileOptions = {},
): void => {
  const log = options.logger ?? fileLogger;

  try {
    const tempDir = os.tmpdir();
    const entries = fs.readdirSync(tempDir, { withFileTypes: true });

    const testDirs = entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith("moose-e2e-test-"),
      )
      .map((entry) => path.join(tempDir, entry.name));

    for (const dir of testDirs) {
      log.debug("Removing leftover test directory", { path: dir });
      removeTestProject(dir, { logger: log });
    }

    if (testDirs.length > 0) {
      log.info(`✓ Cleaned up ${testDirs.length} leftover test directories`);
    }
  } catch (error) {
    log.warn("Error during leftover directory cleanup", error);
  }
};
