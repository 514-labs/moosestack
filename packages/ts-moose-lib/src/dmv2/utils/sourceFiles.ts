import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
]);

/**
 * Returns true when the file path matches supported source extensions.
 */
export function isSourceFilePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DEFAULT_SOURCE_EXTENSIONS.has(ext);
}

/**
 * Recursively finds source files under a directory.
 *
 * Skips:
 * - `node_modules` directories
 * - hidden directories
 * - TypeScript declaration files (`.d.ts`, `.d.mts`, `.d.cts`)
 */
export function findSourceFiles(
  dir: string,
  onReadError?: (directory: string, error: unknown) => void,
): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) {
    return files;
  }

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      onReadError?.(current, error);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !isSourceFilePath(fullPath)) {
        continue;
      }
      if (
        fullPath.endsWith(".d.ts") ||
        fullPath.endsWith(".d.mts") ||
        fullPath.endsWith(".d.cts")
      ) {
        continue;
      }
      files.push(path.resolve(fullPath));
    }
  }

  return files;
}
