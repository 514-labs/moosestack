#!/usr/bin/env node
/**
 * Pre-compiles TypeScript app code with moose compiler plugins and typia transforms.
 * Used during Docker build to eliminate ts-node overhead at runtime.
 *
 * Usage: moose-tspc [outDir] [--watch]
 *   outDir: Output directory for compiled files (default: .moose/compiled)
 *   --watch: Enable watch mode for incremental compilation (outputs JSON events)
 *
 * This script creates a temporary tsconfig that extends the user's config and adds
 * the required moose compiler plugins, then runs tspc to compile with transforms.
 *
 * In watch mode, outputs JSON events to stdout for the Rust CLI to parse:
 *   {"event": "compile_start"}
 *   {"event": "compile_complete", "errors": 0, "warnings": 2}
 *   {"event": "compile_error", "errors": 3, "diagnostics": [...]}
 */
import { execFileSync, spawn } from "child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import path from "path";
import {
  MOOSE_COMPILER_PLUGINS,
  MOOSE_COMPILER_OPTIONS,
  detectModuleSystem,
  getModuleOptions,
  getSourceDir,
  type ModuleSystem,
} from "./compiler-config";
import { rewriteImportExtensions } from "./commons";

// Parse command line arguments
const args = process.argv.slice(2);
const watchMode = args.includes("--watch");
const outDir = args.find((arg) => !arg.startsWith("--")) || ".moose/compiled";

const projectRoot = process.cwd();
const tsconfigPath = path.join(projectRoot, "tsconfig.json");
const tempTsconfigPath = path.join(projectRoot, "tsconfig.moose-build.json");

/**
 * JSON event protocol for watch mode communication with Rust CLI.
 */
interface CompileEvent {
  event: "compile_start" | "compile_complete" | "compile_error";
  errors?: number;
  warnings?: number;
  diagnostics?: string[];
}

/**
 * Emit a JSON event to stdout for the Rust CLI to parse.
 */
function emitEvent(event: CompileEvent): void {
  console.log(JSON.stringify(event));
}

/**
 * Create the build tsconfig with moose plugins.
 */
function createBuildTsconfig(
  moduleOptions: ReturnType<typeof getModuleOptions>,
) {
  return {
    extends: "./tsconfig.json",
    compilerOptions: {
      ...MOOSE_COMPILER_OPTIONS,
      ...moduleOptions,
      plugins: [...MOOSE_COMPILER_PLUGINS],
      // Skip type checking of declaration files to avoid dual-package conflicts
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      // Additional settings to handle module resolution conflicts
      allowSyntheticDefaultImports: true,
      // In watch mode, we want to block on errors (noEmitOnError: true)
      // In build mode, we allow emission with errors for Docker builds
      noEmitOnError: watchMode,
      // Enable incremental compilation for faster rebuilds
      incremental: true,
      tsBuildInfoFile: path.join(outDir, ".tsbuildinfo"),
    },
  };
}

/**
 * Run a single compilation (non-watch mode).
 */
function runSingleCompilation(moduleSystem: ModuleSystem): void {
  const moduleOptions = getModuleOptions(moduleSystem);
  const buildTsconfig = createBuildTsconfig(moduleOptions);
  // Override noEmitOnError for single compilation (allow errors)
  buildTsconfig.compilerOptions.noEmitOnError = false;

  writeFileSync(tempTsconfigPath, JSON.stringify(buildTsconfig, null, 2));
  console.log("Created temporary tsconfig with moose plugins...");

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
    const sourceDir = getSourceDir();
    const outputIndexPath = path.join(
      projectRoot,
      outDir,
      sourceDir,
      "index.js",
    );

    if (existsSync(outputIndexPath)) {
      console.warn("");
      console.warn("BUILD SAFETY WARNING");
      console.warn(
        "===============================================================",
      );
      console.warn(
        "TypeScript detected type errors but JavaScript was still emitted.",
      );
      console.warn("");
      console.warn(
        "IMPORTANT: Type errors can indicate code that will fail at runtime.",
      );
      console.warn(
        "While this build will succeed, the resulting code may crash when:",
      );
      console.warn("  - Functions receive unexpected argument types");
      console.warn(
        "  - Properties are accessed on potentially null/undefined values",
      );
      console.warn("  - Incorrect types flow through your application logic");
      console.warn("");
      console.warn(
        "RECOMMENDATION: Run `npx tsc --noEmit` to review type errors before",
      );
      console.warn(
        "deploying to production. Fix any errors that could cause runtime issues.",
      );
      console.warn(
        "===============================================================",
      );
      console.warn("");
      console.log("TypeScript compilation complete (with type warnings).");
    } else {
      console.error("Compilation failed - no output files generated.");
      throw compileError;
    }
  }

  // Post-process ESM output to add .js extensions to relative imports
  if (moduleSystem === "esm") {
    console.log("Post-processing ESM imports to add .js extensions...");
    const fullOutDir = path.join(projectRoot, outDir);
    rewriteImportExtensions(fullOutDir);
    console.log("ESM import rewriting complete.");
  }
}

/**
 * Run watch mode compilation with JSON event output.
 * Uses tspc --watch and parses its output to emit structured events.
 */
function runWatchCompilation(moduleSystem: ModuleSystem): void {
  const moduleOptions = getModuleOptions(moduleSystem);
  const buildTsconfig = createBuildTsconfig(moduleOptions);

  // Write the tsconfig (it stays for the duration of watch mode)
  writeFileSync(tempTsconfigPath, JSON.stringify(buildTsconfig, null, 2));

  // Ensure output directory exists for incremental build info
  const fullOutDir = path.join(projectRoot, outDir);
  if (!existsSync(fullOutDir)) {
    mkdirSync(fullOutDir, { recursive: true });
  }

  // Track diagnostics between compilation cycles
  let currentDiagnostics: string[] = [];
  let errorCount = 0;
  let warningCount = 0;

  // Spawn tspc in watch mode
  const tspcProcess = spawn(
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
      "--watch",
      "--preserveWatchOutput",
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // Handle process termination
  const cleanup = () => {
    if (existsSync(tempTsconfigPath)) {
      unlinkSync(tempTsconfigPath);
    }
    tspcProcess.kill();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Parse tspc output line by line
  let buffer = "";

  const processLine = (line: string) => {
    // TypeScript watch mode outputs these key messages:
    // "Starting compilation in watch mode..."
    // "File change detected. Starting incremental compilation..."
    // "Found X errors. Watching for file changes."
    // Error lines: "path(line,col): error TSxxxx: message"
    // Warning lines: "path(line,col): warning TSxxxx: message"

    if (
      line.includes("Starting compilation in watch mode") ||
      line.includes("Starting incremental compilation")
    ) {
      // New compilation cycle starting
      currentDiagnostics = [];
      errorCount = 0;
      warningCount = 0;
      emitEvent({ event: "compile_start" });
    } else if (line.includes("Found") && line.includes("error")) {
      // Compilation complete - parse error count
      const match = line.match(/Found (\d+) error/);
      if (match) {
        errorCount = parseInt(match[1], 10);
      }

      // Post-process ESM if successful
      if (errorCount === 0 && moduleSystem === "esm") {
        try {
          rewriteImportExtensions(fullOutDir);
        } catch (e) {
          // Log but don't fail - import rewriting is best-effort
          console.error("Warning: ESM import rewriting failed:", e);
        }
      }

      if (errorCount > 0) {
        emitEvent({
          event: "compile_error",
          errors: errorCount,
          warnings: warningCount,
          diagnostics: currentDiagnostics,
        });
      } else {
        emitEvent({
          event: "compile_complete",
          errors: 0,
          warnings: warningCount,
          diagnostics: warningCount > 0 ? currentDiagnostics : undefined,
        });
      }
    } else if (line.match(/\(\d+,\d+\):\s*(error|warning)\s+TS\d+:/)) {
      // This is a diagnostic line
      currentDiagnostics.push(line.trim());
      if (line.includes(": error ")) {
        errorCount++;
      } else if (line.includes(": warning ")) {
        warningCount++;
      }
    }
  };

  tspcProcess.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer
    for (const line of lines) {
      if (line.trim()) {
        processLine(line);
      }
    }
  });

  tspcProcess.stderr.on("data", (data: Buffer) => {
    // Forward stderr for debugging but don't parse it
    process.stderr.write(data.toString());
  });

  tspcProcess.on("error", (err) => {
    console.error("Failed to start tspc:", err);
    cleanup();
    process.exit(1);
  });

  tspcProcess.on("exit", (code) => {
    cleanup();
    if (code !== 0) {
      process.exit(code || 1);
    }
  });
}

// Main execution
if (!existsSync(tsconfigPath)) {
  console.error("Error: tsconfig.json not found in", projectRoot);
  process.exit(1);
}

try {
  // Auto-detect module system from package.json
  const moduleSystem = detectModuleSystem(projectRoot);

  if (watchMode) {
    // Watch mode - run indefinitely with JSON event output
    runWatchCompilation(moduleSystem);
  } else {
    // Single compilation mode
    console.log(`Compiling TypeScript to ${outDir}...`);
    console.log(
      `Using ${moduleSystem.toUpperCase()} module output (detected from package.json)...`,
    );
    runSingleCompilation(moduleSystem);
    console.log("Compilation complete.");

    // Clean up the temporary tsconfig
    if (existsSync(tempTsconfigPath)) {
      unlinkSync(tempTsconfigPath);
    }
  }
} catch (error) {
  console.error("Build process failed:", error);
  // Clean up the temporary tsconfig
  if (existsSync(tempTsconfigPath)) {
    unlinkSync(tempTsconfigPath);
  }
  process.exit(1);
}
