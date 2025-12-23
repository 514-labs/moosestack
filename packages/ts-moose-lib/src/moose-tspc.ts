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
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import path from "path";

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
  // Read the user's tsconfig.json
  const userTsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));

  // Create a temporary tsconfig that extends the user's config and adds plugins
  // The plugins are normally added at runtime by moose-runner, but we need them
  // at compile time for pre-compilation to work
  // Note: Use relative path from project root since package exports don't include compilerPlugin
  const buildTsconfig = {
    extends: "./tsconfig.json",
    compilerOptions: {
      ...userTsconfig.compilerOptions,
      experimentalDecorators: true,
      plugins: [
        {
          transform: "./node_modules/@514labs/moose-lib/dist/compilerPlugin.js",
          transformProgram: true,
        },
        {
          transform: "typia/lib/transform",
        },
      ],
    },
  };

  // Write the temporary tsconfig
  writeFileSync(tempTsconfigPath, JSON.stringify(buildTsconfig, null, 2));
  console.log("Created temporary tsconfig with moose plugins...");

  // Use tspc (ts-patch compiler CLI) with the temporary tsconfig
  // Include source maps for better error messages in production
  // --skipLibCheck avoids type-checking node_modules (some packages have type issues)
  // --rootDir . preserves directory structure (e.g., app/index.ts -> outDir/app/index.js)
  execSync(
    `npx tspc -p ${tempTsconfigPath} --outDir ${outDir} --rootDir . --sourceMap --inlineSources --skipLibCheck`,
    {
      stdio: "inherit",
      cwd: projectRoot,
    },
  );

  console.log("Compilation complete.");
} catch (error) {
  console.error("Compilation failed:", error);
  process.exit(1);
} finally {
  // Clean up the temporary tsconfig
  if (existsSync(tempTsconfigPath)) {
    unlinkSync(tempTsconfigPath);
  }
}
