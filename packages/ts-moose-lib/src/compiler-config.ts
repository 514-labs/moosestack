import { existsSync, readFileSync } from "fs";
import path from "path";

/**
 * Shared TypeScript compiler configuration for moose projects.
 * Used by both moose-runner.ts (runtime) and moose-tspc.ts (pre-compilation).
 *
 * Moose now always uses pre-compiled JavaScript - no ts-node fallback.
 */

export const MOOSE_COMPILER_PLUGINS = [
  {
    transform: "./node_modules/@514labs/moose-lib/dist/compilerPlugin.js",
    // No longer using transformProgram - direct typia integration eliminates
    // the need for program replacement and the associated incremental compilation issues
  },
  {
    // Keep typia plugin for users who use typia directly (not through Moose resources)
    transform: "typia/lib/transform",
  },
] as const;

// Options required for moose compilation
// Note: We only set what's absolutely necessary to avoid conflicts with user projects
export const MOOSE_COMPILER_OPTIONS = {
  experimentalDecorators: true,
  esModuleInterop: true,
  // Disable strict module syntax checking to avoid dual-package type conflicts
  // This prevents errors where the same type imported with different resolution
  // modes (CJS vs ESM) is treated as incompatible
  verbatimModuleSyntax: false,
} as const;

// Module resolution options - only applied if not already set in user's tsconfig
// These help with ESM/CJS interop but can be overridden by user config
export const MOOSE_MODULE_OPTIONS = {
  module: "NodeNext",
  moduleResolution: "NodeNext",
} as const;

/**
 * Default source directory for user code.
 * Can be overridden via MOOSE_SOURCE_DIR environment variable.
 */
export function getSourceDir(): string {
  return process.env.MOOSE_SOURCE_DIR || "app";
}

/**
 * Default output directory for compiled code.
 */
export const DEFAULT_OUT_DIR = ".moose/compiled";

/**
 * Read the user's tsconfig.json and extract the outDir setting.
 * Supports JSONC (JSON with Comments) by evaluating as JavaScript
 * (JSON with comments is valid JS in ES2019+).
 *
 * Security note: This uses eval-like behavior (new Function), which means
 * malicious code in tsconfig.json would execute. This is acceptable because:
 * - The user controls their own tsconfig.json
 * - Same trust model as running `tsc` or any other tool that processes the file
 * - If you clone and run untrusted code, you're already at risk
 *
 * Returns the outDir if specified, or null if not.
 */
export function readUserOutDir(
  projectRoot: string = process.cwd(),
): string | null {
  try {
    let content = readFileSync(
      path.join(projectRoot, "tsconfig.json"),
      "utf-8",
    );
    // Strip UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    // eslint-disable-next-line no-eval
    const tsconfig = eval(`(${content})`);
    return tsconfig.compilerOptions?.outDir || null;
  } catch {
    return null;
  }
}

/**
 * Get the output directory for compiled code.
 * Uses user's tsconfig outDir if specified, otherwise defaults to .moose/compiled
 */
export function getOutDir(projectRoot: string = process.cwd()): string {
  const userOutDir = readUserOutDir(projectRoot);
  return userOutDir || DEFAULT_OUT_DIR;
}

/**
 * Get the path to the compiled index.js file.
 */
export function getCompiledIndexPath(
  projectRoot: string = process.cwd(),
): string {
  const outDir = getOutDir(projectRoot);
  const sourceDir = getSourceDir();
  // Resolve so that absolute outDir from tsconfig is handled correctly
  return path.resolve(projectRoot, outDir, sourceDir, "index.js");
}

/**
 * Check if pre-compiled artifacts exist for the current project.
 */
export function hasCompiledArtifacts(
  projectRoot: string = process.cwd(),
): boolean {
  return existsSync(getCompiledIndexPath(projectRoot));
}

/**
 * Module system type for compilation output.
 */
export type ModuleSystem = "esm" | "cjs";

/**
 * Detects the module system from the user's package.json.
 * Returns 'esm' if package.json has "type": "module", otherwise 'cjs'.
 *
 * @param projectRoot - Root directory containing package.json (defaults to cwd)
 * @returns The detected module system
 */
export function detectModuleSystem(
  projectRoot: string = process.cwd(),
): ModuleSystem {
  const pkgPath = path.join(projectRoot, "package.json");

  if (existsSync(pkgPath)) {
    try {
      const pkgContent = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent);
      if (pkg.type === "module") {
        return "esm";
      }
    } catch (e) {
      // If parsing fails, default to CJS
      console.debug(
        `[moose] Failed to parse package.json at ${pkgPath}, defaulting to CJS:`,
        e,
      );
    }
  }

  return "cjs";
}

/**
 * Get compiler module options based on detected module system.
 *
 * @param moduleSystem - The module system to get options for
 * @returns Compiler options for module and moduleResolution
 */
export function getModuleOptions(moduleSystem: ModuleSystem): {
  module: string;
  moduleResolution: string;
} {
  if (moduleSystem === "esm") {
    return {
      module: "ES2022",
      moduleResolution: "bundler",
    };
  }
  return {
    module: "CommonJS",
    moduleResolution: "Node",
  };
}

/**
 * Dynamic module loader that works with both CJS and ESM.
 * Uses detected module system to determine loading strategy.
 *
 * @param modulePath - Path to the module to load
 * @param projectRoot - Root directory for module system detection
 * @returns The loaded module
 */
export async function loadModule<T = any>(
  modulePath: string,
  projectRoot: string = process.cwd(),
): Promise<T> {
  const moduleSystem = detectModuleSystem(projectRoot);

  if (moduleSystem === "esm") {
    // Use dynamic import for ESM
    // pathToFileURL is needed for Windows compatibility with absolute paths
    const { pathToFileURL } = await import("url");
    const fileUrl = pathToFileURL(modulePath).href;
    return await import(fileUrl);
  }

  // Use require for CJS
  // Note: In ESM builds (compiled by tsup), this code path is replaced with
  // the appropriate ESM imports. The dual-package build ensures compatibility.
  return require(modulePath);
}
