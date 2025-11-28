/**
 * Stack trace utilities for extracting source file information.
 *
 * This module provides functions for parsing stack traces to determine
 * where user code is located, filtering out internal library paths.
 */

/**
 * Information extracted from a stack trace about source file location.
 */
export interface SourceFileInfo {
  /** The file path */
  file?: string;
  /** The line number (as a string) */
  line?: string;
}

/**
 * Check if a stack trace line should be skipped (internal/library code).
 * @internal
 */
function shouldSkipStackLine(line: string): boolean {
  return (
    line.includes("node_modules") || // Skip npm installed packages (prod)
    line.includes("internal/modules") || // Skip Node.js internals
    line.includes("ts-node") || // Skip TypeScript execution
    line.includes("/ts-moose-lib/") || // Skip dev/linked moose-lib (Unix)
    line.includes("\\ts-moose-lib\\") // Skip dev/linked moose-lib (Windows)
  );
}

/**
 * Extract file path and line number from a stack trace line.
 * @internal
 */
function parseStackLine(line: string): SourceFileInfo | undefined {
  const match =
    line.match(/\((.*):(\d+):(\d+)\)/) || line.match(/at (.*):(\d+):(\d+)/);
  if (match && match[1]) {
    return {
      file: match[1],
      line: match[2],
    };
  }
  return undefined;
}

/**
 * Extract source file information from a stack trace.
 * Works in both development (npm link) and production (npm install) environments.
 *
 * @param stack - The stack trace string from an Error object
 * @returns Object with file path and line number, or empty object if not found
 */
export function getSourceFileInfo(stack?: string): SourceFileInfo {
  if (!stack) return {};
  const lines = stack.split("\n");
  for (const line of lines) {
    if (shouldSkipStackLine(line)) continue;
    const info = parseStackLine(line);
    if (info) return info;
  }
  return {};
}

/**
 * Extract the first file path outside moose-lib internals from a stack trace.
 * Works in both development (npm link) and production (npm install) environments.
 *
 * @param stack - The stack trace string from an Error object
 * @returns The first user-code file path, or undefined if not found
 */
export function getSourceFileFromStack(stack?: string): string | undefined {
  return getSourceFileInfo(stack).file;
}
