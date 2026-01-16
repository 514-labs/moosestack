#!/usr/bin/env node
/**
 * Pre-compiles TypeScript app code with moose compiler plugins and typia transforms.
 * Used during Docker build to eliminate ts-node overhead at runtime.
 *
 * Usage: moose-tspc [outDir]
 *   outDir: Output directory for compiled files (default: .moose/compiled)
 *
 * This script creates a temporary tsconfig that extends the user's config and adds
 * the required moose compiler plugins, then runs tspc to compile with transforms.
 */
import { execFileSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import path from "path";
import {
  MOOSE_COMPILER_PLUGINS,
  MOOSE_COMPILER_OPTIONS,
  detectModuleSystem,
  getModuleOptions,
} from "./compiler-config";
import { rewriteImportExtensions } from "./commons";

const outDir = process.argv[2] || ".moose/compiled";
const projectRoot = process.cwd();
const tsconfigPath = path.join(projectRoot, "tsconfig.json");
const tempTsconfigPath = path.join(projectRoot, "tsconfig.moose-build.json");

if (!existsSync(tsconfigPath)) {
  console.error("Error: tsconfig.json not found in", projectRoot);
  process.exit(1);
}

console.log(`Compiling TypeScript to ${outDir}...`);

try {
  // Auto-detect module system from package.json
  const moduleSystem = detectModuleSystem(projectRoot);
  const moduleOptions = getModuleOptions(moduleSystem);

  console.log(
    `Using ${moduleSystem.toUpperCase()} module output (detected from package.json)...`,
  );

  // Create a temporary tsconfig that extends the user's config and adds plugins.
  // We use extends (not spread) to properly inherit all user settings.
  // Only override what's needed for moose compilation.
  const buildTsconfig = {
    extends: "./tsconfig.json",
    compilerOptions: {
      ...MOOSE_COMPILER_OPTIONS,
      ...moduleOptions,
      plugins: [...MOOSE_COMPILER_PLUGINS],
      // Skip type checking of declaration files to avoid dual-package conflicts
      // This must be in compilerOptions (not just CLI flag) to fully work
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      // Additional settings to handle module resolution conflicts
      allowSyntheticDefaultImports: true,
      // CRITICAL: Emit JavaScript even when there are type errors
      // This is essential for Docker builds where we need compilation to succeed
      // Type errors are acceptable here since the code works at runtime
      noEmitOnError: false,
    },
  };

  // Write the temporary tsconfig
  writeFileSync(tempTsconfigPath, JSON.stringify(buildTsconfig, null, 2));
  console.log("Created temporary tsconfig with moose plugins...");

  // Use tspc (ts-patch compiler CLI) with the temporary tsconfig
  // Include source maps for better error messages in production
  // --rootDir . preserves directory structure (e.g., app/index.ts -> outDir/app/index.js)
  // Note: skipLibCheck and noEmitOnError are in compilerOptions
  try {
    execFileSync(
      "npx",
      [
        "tspc",
        "-p",
        tempTsconfigPath,
        "--outDir",
        outDir,
        "--rootDir",
        ".",
        "--sourceMap",
        "--inlineSources",
      ],
      {
        stdio: "inherit",
        cwd: projectRoot,
      },
    );
    console.log("TypeScript compilation complete.");
  } catch (compileError: any) {
    // TypeScript might exit with non-zero code even when noEmitOnError: false
    // Check if output files were actually created
    const sourceDir = process.env.MOOSE_SOURCE_DIR || "app";
    const outputIndexPath = path.join(projectRoot, outDir, sourceDir, "index.js");

    if (existsSync(outputIndexPath)) {
      console.warn(
        "Warning: TypeScript reported errors but files were emitted successfully.",
      );
      console.warn(
        "Type errors detected, but continuing with generated JavaScript.",
      );
      console.log("TypeScript compilation complete (with type errors).");
    } else {
      console.error("Compilation failed - no output files generated.");
      throw compileError;
    }
  }

  // Post-process ESM output to add .js extensions to relative imports
  // Node.js ESM requires explicit extensions which TypeScript doesn't add
  if (moduleSystem === "esm") {
    console.log("Post-processing ESM imports to add .js extensions...");
    const fullOutDir = path.join(projectRoot, outDir);
    rewriteImportExtensions(fullOutDir);
    console.log("ESM import rewriting complete.");
  }

  console.log("Compilation complete.");
} catch (error) {
  console.error("Build process failed:", error);
  process.exit(1);
} finally {
  // Clean up the temporary tsconfig
  if (existsSync(tempTsconfigPath)) {
    unlinkSync(tempTsconfigPath);
  }
}
