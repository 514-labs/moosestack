#!/usr/bin/env node
/**
 * Pre-compiles TypeScript app code with moose compiler plugins and typia transforms.
 * Used during Docker build to eliminate ts-node overhead at runtime.
 *
 * Usage: moose-tspc [outDir]
 *   outDir: Output directory for compiled files (default: .moose/compiled)
 *
 * This script uses tspc (ts-patch compiler CLI) which applies the plugins
 * configured in tsconfig.json, including:
 * - @514labs/moose-lib/dist/compilerPlugin.js (moose transforms)
 * - typia/lib/transform (runtime type validation)
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

const outDir = process.argv[2] || ".moose/compiled";
const projectRoot = process.cwd();
const tsconfigPath = path.join(projectRoot, "tsconfig.json");

if (!existsSync(tsconfigPath)) {
  console.error("Error: tsconfig.json not found in", projectRoot);
  process.exit(1);
}

console.log(`Compiling TypeScript to ${outDir}...`);

try {
  // Use tspc (ts-patch compiler CLI) which applies the plugins from tsconfig.json
  // Include source maps for better error messages in production
  // --skipLibCheck avoids type-checking node_modules (some packages have type issues)
  // --rootDir . preserves directory structure (e.g., app/index.ts -> outDir/app/index.js)
  execSync(
    `npx tspc --outDir ${outDir} --rootDir . --sourceMap --inlineSources --skipLibCheck`,
    {
      stdio: "inherit",
      cwd: projectRoot,
    },
  );

  console.log("Compilation complete.");
} catch (error) {
  console.error("Compilation failed:", error);
  process.exit(1);
}
