import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

/**
 * Removes a test project directory with retry logic for race conditions
 */
export const removeTestProject = (dir: string): void => {
  console.log(`Deleting ${dir}`);

  // Retry with exponential backoff for race conditions (especially on Node 22)
  const maxRetries = 3;
  const baseDelay = 100; // ms

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      return; // Success
    } catch (error: any) {
      if (attempt === maxRetries) {
        // Last attempt failed, log but don't throw to avoid breaking tests
        console.warn(
          `Failed to delete ${dir} after ${maxRetries + 1} attempts:`,
          error.message,
        );
        return;
      }

      // Only retry on ENOTEMPTY, EBUSY, or EPERM errors (file handle race conditions)
      if (
        error.code === "ENOTEMPTY" ||
        error.code === "EBUSY" ||
        error.code === "EPERM"
      ) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(
          `Retry ${attempt + 1}/${maxRetries} after ${delay}ms due to ${error.code}`,
        );

        // Synchronous sleep
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait
        }
      } else {
        // Different error, don't retry
        throw error;
      }
    }
  }
};

/**
 * Generates a random temporary directory path for test projects
 * Returns the full path (directory is not created yet - CLI will create it)
 */
export const createTempTestDirectory = (suffix: string): string => {
  const tempDir = os.tmpdir();
  const randomDir = `moose-e2e-test-${suffix}-${randomUUID()}`;
  const fullPath = path.join(tempDir, randomDir);

  console.log(`Generated temporary test directory path: ${fullPath}`);
  return fullPath;
};

/**
 * Cleans up leftover test directories in the temp folder
 */
export const cleanupLeftoverTestDirectories = (): void => {
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
      console.log(`Removing leftover test directory: ${dir}`);
      try {
        fs.rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (error: any) {
        console.warn(`Failed to remove ${dir}:`, error.message);
      }
    }

    if (testDirs.length > 0) {
      console.log(`Cleaned up ${testDirs.length} leftover test directories`);
    }
  } catch (error) {
    console.warn("Error during leftover directory cleanup:", error);
  }
};
