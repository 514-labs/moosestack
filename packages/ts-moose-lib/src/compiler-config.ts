import { existsSync } from "fs";
import path from "path";

/**
 * Shared TypeScript compiler configuration for moose projects.
 * Used by both moose-runner.ts (runtime) and moose-tspc.ts (pre-compilation).
 *
 * This ensures identical compilation behavior between:
 * - Development: ts-node with plugins (dynamic compilation)
 * - Production: Pre-compiled JavaScript (via moose-tspc)
 */

export const MOOSE_COMPILER_PLUGINS = [
  {
    transform: "./node_modules/@514labs/moose-lib/dist/compilerPlugin.js",
    transformProgram: true,
  },
  {
    transform: "typia/lib/transform",
  },
] as const;

export const MOOSE_COMPILER_OPTIONS = {
  experimentalDecorators: true,
  // Match ts-node's ESM mode for consistent module output
  module: "NodeNext",
  moduleResolution: "NodeNext",
  esModuleInterop: true,
} as const;

// Commands that require full plugin compilation (moose transforms + typia)
export const COMMANDS_REQUIRING_PLUGINS = [
  "consumption-apis",
  "consumption-type-serializer",
  "dmv2-serializer",
  "streaming-functions",
  "scripts",
] as const;

/**
 * Default source directory for user code.
 * Can be overridden via MOOSE_SOURCE_DIR environment variable.
 */
export function getSourceDir(): string {
  return process.env.MOOSE_SOURCE_DIR || "app";
}

/**
 * Check if pre-compiled artifacts exist for the current project.
 * Used to determine whether to use compiled code or fall back to ts-node.
 */
export function hasCompiledArtifacts(
  projectRoot: string = process.cwd(),
): boolean {
  const sourceDir = getSourceDir();
  const compiledIndexPath = path.join(
    projectRoot,
    ".moose",
    "compiled",
    sourceDir,
    "index.js",
  );
  return existsSync(compiledIndexPath);
}

/**
 * Determine if we should use pre-compiled code.
 * Returns true if MOOSE_USE_COMPILED=true AND compiled artifacts exist.
 * This provides automatic fallback to ts-node if compilation wasn't run.
 */
export function shouldUseCompiled(
  projectRoot: string = process.cwd(),
): boolean {
  const envSaysCompiled = process.env.MOOSE_USE_COMPILED === "true";
  if (!envSaysCompiled) {
    return false;
  }

  const hasArtifacts = hasCompiledArtifacts(projectRoot);
  if (!hasArtifacts) {
    console.warn(
      "[moose] MOOSE_USE_COMPILED=true but no compiled artifacts found at " +
        `.moose/compiled/${getSourceDir()}/index.js. Falling back to ts-node.`,
    );
  }
  return hasArtifacts;
}
