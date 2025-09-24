import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

/**
 * Removes a test project directory
 */
export const removeTestProject = (dir: string): void => {
  console.log(`Deleting ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
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
      fs.rmSync(dir, { recursive: true, force: true });
    }

    if (testDirs.length > 0) {
      console.log(`Cleaned up ${testDirs.length} leftover test directories`);
    }
  } catch (error) {
    console.warn("Error during leftover directory cleanup:", error);
  }
};
