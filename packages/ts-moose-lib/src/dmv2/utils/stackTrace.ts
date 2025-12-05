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
 * Source location with file, line, and column information.
 * Used for precise error location tracking.
 */
export interface SourceLocation {
  /** The file path */
  file: string;
  /** The line number */
  line: number;
  /** The column number (optional - may not always be available from stack trace) */
  column?: number;
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
 * Extracts source location (file, line, column) from a stack trace.
 *
 * Stack trace formats vary by environment:
 * - V8 (Node/Chrome): "    at Function (file.ts:10:15)"
 * - SpiderMonkey (Firefox): "Function@file.ts:10:15"
 *
 * @param stack - Error stack trace string
 * @returns SourceLocation or undefined if parsing fails
 */
export function getSourceLocationFromStack(
  stack: string | undefined,
): SourceLocation | undefined {
  if (!stack) return undefined;

  const lines = stack.split("\n");

  // Skip first line (error message) and internal frames
  for (const line of lines.slice(1)) {
    // Skip node_modules and internal moose-lib frames
    if (shouldSkipStackLine(line)) {
      continue;
    }

    // V8 format: "    at Function (file.ts:10:15)" or "    at file.ts:10:15"
    const v8Match = line.match(/at\s+(?:.*?\s+\()?(.+):(\d+):(\d+)\)?/);
    if (v8Match) {
      return {
        file: v8Match[1],
        line: parseInt(v8Match[2], 10),
        column: parseInt(v8Match[3], 10),
      };
    }

    // SpiderMonkey format: "Function@file.ts:10:15"
    const smMatch = line.match(/(?:.*@)?(.+):(\d+):(\d+)/);
    if (smMatch) {
      return {
        file: smMatch[1],
        line: parseInt(smMatch[2], 10),
        column: parseInt(smMatch[3], 10),
      };
    }
  }

  return undefined;
}

/**
 * Extract the first file path outside moose-lib internals from a stack trace.
 * Works in both development (npm link) and production (npm install) environments.
 *
 * @deprecated Use getSourceLocationFromStack instead
 * @param stack - The stack trace string from an Error object
 * @returns The first user-code file path, or undefined if not found
 */
export function getSourceFileFromStack(stack?: string): string | undefined {
  const location = getSourceLocationFromStack(stack);
  return location?.file;
}
