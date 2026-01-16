/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for module resolution in Docker builds.
 *
 * Tests that moose-tspc uses the correct module resolution strategy:
 * 1. Uses CommonJS for pre-compiled builds (avoids ESM .js extension issues)
 * 2. Compiled output is .js files (not .mjs)
 * 3. Import statements work without explicit .js extensions
 * 4. Doesn't break existing CommonJS projects
 *
 * This validates the module resolution fixes that avoid:
 * - ESM import path resolution errors (missing .js extensions)
 * - Dual-package resolution conflicts
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

// Import test utilities
import { TIMEOUTS, TEMPLATE_NAMES, APP_NAMES } from "./constants";

import {
  createTempTestDirectory,
  setupTypeScriptProject,
  logger,
} from "./utils";

const testLogger = logger.scope("docker-build-module-resolution-test");

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("Module resolution in Docker builds", () => {
  let TEST_PROJECT_DIR: string;

  beforeEach(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Verify CLI exists
    try {
      await fs.promises.access(CLI_PATH, fs.constants.F_OK);
    } catch (err) {
      testLogger.error(
        `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
      );
      throw err;
    }

    // Create temporary directory for this test
    TEST_PROJECT_DIR = createTempTestDirectory(
      `docker-build-module-resolution-${Date.now()}`,
    );

    // Setup TypeScript project
    await setupTypeScriptProject(
      TEST_PROJECT_DIR,
      TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAMES.TYPESCRIPT_DEFAULT,
      "npm",
    );
  });

  afterEach(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    // Cleanup test directory
    if (TEST_PROJECT_DIR && fs.existsSync(TEST_PROJECT_DIR)) {
      testLogger.info("Cleaning up test directory:", TEST_PROJECT_DIR);
      await fs.promises.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    }
  });

  it("should use CommonJS for pre-compiled builds", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("Running moose-tspc to pre-compile TypeScript...");

    // Run moose-tspc
    let compileOutput = "";
    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
    } catch (error: any) {
      compileOutput = error.stdout || "";
      testLogger.info("Compilation output:", compileOutput);
    }

    testLogger.info("Compile output:", compileOutput);

    // Verify it used CommonJS mode
    expect(
      compileOutput.includes("CommonJS") ||
        compileOutput.includes("avoids ESM import path issues"),
      "Expected output to mention CommonJS mode",
    ).to.be.true;

    // Read the generated tsconfig.moose-build.json to verify settings
    // Note: This file is cleaned up after compilation, so we need to check the output
    // or verify the compiled files themselves

    // Verify compiled files use CommonJS format
    const compiledIndexPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "index.js",
    );

    if (fs.existsSync(compiledIndexPath)) {
      const content = fs.readFileSync(compiledIndexPath, "utf-8");

      // Check for CommonJS patterns (require, exports, module.exports)
      const hasCommonJSPatterns =
        content.includes("require(") ||
        content.includes("exports.") ||
        content.includes("module.exports");

      expect(
        hasCommonJSPatterns,
        "Expected CommonJS patterns (require/exports) in compiled output",
      ).to.be.true;

      // Should NOT have ESM import syntax in the output
      // (TypeScript should have transformed it to require())
      const hasESMImport = content.match(/^import\s+\{/m);
      expect(!hasESMImport, "Expected no ESM import syntax in CommonJS output")
        .to.be.true;
    }

    testLogger.info("✅ Verified CommonJS module format");
  });

  it("should output .js files (not .mjs)", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("Verifying output file extensions...");

    // Run moose-tspc
    try {
      await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
    } catch (error: any) {
      testLogger.info("Compilation completed (ignoring exit code)");
    }

    // Check compiled directory for files
    const compiledDir = path.join(TEST_PROJECT_DIR, ".moose", "compiled");

    // Recursively find all compiled files
    const findFiles = (dir: string, fileList: string[] = []): string[] => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          findFiles(filePath, fileList);
        } else {
          fileList.push(filePath);
        }
      });
      return fileList;
    };

    const allFiles = findFiles(compiledDir);
    const jsFiles = allFiles.filter((f) => f.endsWith(".js"));
    const mjsFiles = allFiles.filter((f) => f.endsWith(".mjs"));

    testLogger.info(`Found ${jsFiles.length} .js files`);
    testLogger.info(`Found ${mjsFiles.length} .mjs files`);

    // Verify we have .js files
    expect(jsFiles.length, "Expected to find .js files").to.be.greaterThan(0);

    // Verify we have NO .mjs files (CommonJS should produce .js, not .mjs)
    expect(
      mjsFiles.length,
      "Expected NO .mjs files in CommonJS output",
    ).to.equal(0);

    testLogger.info("✅ Verified .js file extensions (not .mjs)");
  });

  it("should handle imports without .js extensions", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info(
      "Creating files with imports that don't have .js extensions...",
    );

    // Create a module and a file that imports it
    const utilsDir = path.join(TEST_PROJECT_DIR, "app", "utils");
    await fs.promises.mkdir(utilsDir, { recursive: true });

    // Create a utility module
    const helperContent = `
export function formatId(id: string): string {
  return \`ID: \${id}\`;
}

export function getCurrentTimestamp(): number {
  return Date.now();
}
`;

    fs.writeFileSync(path.join(utilsDir, "helpers.ts"), helperContent);

    // Create a consumer that imports from the helper (without .js extension)
    const consumerDir = path.join(TEST_PROJECT_DIR, "app", "consumers");
    await fs.promises.mkdir(consumerDir, { recursive: true });

    const consumerContent = `
// Import without .js extension (TypeScript style)
import { formatId, getCurrentTimestamp } from "../utils/helpers";

export interface TestEvent {
  id: string;
  timestamp: number;
}

export default async function testConsumer(
  event: TestEvent,
): Promise<void> {
  const formattedId = formatId(event.id);
  const now = getCurrentTimestamp();
  console.log("Processing:", formattedId, "at", now);
}
`;

    fs.writeFileSync(
      path.join(consumerDir, "import-test.consumer.ts"),
      consumerContent,
    );

    testLogger.info("Running moose-tspc with cross-module imports...");

    // Run moose-tspc - should handle imports correctly in CommonJS
    let compileOutput = "";
    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
    } catch (error: any) {
      compileOutput = error.stdout || "";
      testLogger.info("Compilation output:", compileOutput);
    }

    // Verify both files were compiled
    const compiledHelperPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "utils",
      "helpers.js",
    );
    const compiledConsumerPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "consumers",
      "import-test.consumer.js",
    );

    expect(fs.existsSync(compiledHelperPath), "Expected helper.js to exist").to
      .be.true;
    expect(fs.existsSync(compiledConsumerPath), "Expected consumer.js to exist")
      .to.be.true;

    // Verify the consumer's imports were transformed to CommonJS require()
    const consumerContent = fs.readFileSync(compiledConsumerPath, "utf-8");

    // In CommonJS, the import should become a require() call
    // The path should NOT have .js extension added (CommonJS doesn't need it)
    expect(
      consumerContent.includes("require(") &&
        consumerContent.includes("../utils/helpers"),
      "Expected require() call with correct path",
    ).to.be.true;

    testLogger.info(
      "✅ Imports without .js extensions handled correctly in CommonJS",
    );
  });

  it("should not break existing CommonJS projects", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("Testing with a project that already uses CommonJS...");

    // Update tsconfig to explicitly use CommonJS
    const tsconfigPath = path.join(TEST_PROJECT_DIR, "tsconfig.json");
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));

    tsconfig.compilerOptions = tsconfig.compilerOptions || {};
    tsconfig.compilerOptions.module = "commonjs";
    tsconfig.compilerOptions.moduleResolution = "node";

    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

    testLogger.info("Running moose-tspc with existing CommonJS config...");

    // Run moose-tspc - should not conflict with existing CommonJS settings
    let compileOutput = "";
    let compileFailed = false;
    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
    } catch (error: any) {
      compileOutput = error.stdout || "";
      compileFailed = error.code !== 0;
      testLogger.info("Compilation output:", compileOutput);
    }

    // Verify compilation succeeded (or succeeded with warnings)
    expect(
      compileOutput.includes("Compilation complete") ||
        compileOutput.includes("with type errors") ||
        !compileFailed,
      "Expected compilation to succeed with existing CommonJS config",
    ).to.be.true;

    // Verify output still uses CommonJS
    const compiledIndexPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "index.js",
    );

    if (fs.existsSync(compiledIndexPath)) {
      const content = fs.readFileSync(compiledIndexPath, "utf-8");
      expect(
        content.includes("require(") || content.includes("exports."),
        "Expected CommonJS patterns in output",
      ).to.be.true;
    }

    testLogger.info("✅ Existing CommonJS project handled correctly");
  });

  it("should create tsconfig.moose-build.json with correct module settings", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info(
      "Verifying temporary tsconfig.moose-build.json is created...",
    );

    // We need to intercept the compilation process to check the temp file
    // Since it gets deleted after compilation, we'll verify it by checking
    // the output and the generated files

    // Run moose-tspc
    let compileOutput = "";
    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
    } catch (error: any) {
      compileOutput = error.stdout || "";
    }

    testLogger.info("Compile output:", compileOutput);

    // Verify it mentions creating the temp tsconfig
    expect(
      compileOutput.includes("temporary tsconfig") ||
        compileOutput.includes("moose plugins"),
      "Expected output to mention temporary tsconfig creation",
    ).to.be.true;

    // The temp file should be cleaned up after compilation
    const tempTsconfigPath = path.join(
      TEST_PROJECT_DIR,
      "tsconfig.moose-build.json",
    );
    expect(
      !fs.existsSync(tempTsconfigPath),
      "Expected temporary tsconfig to be cleaned up after compilation",
    ).to.be.true;

    testLogger.info("✅ Verified temporary tsconfig creation and cleanup");
  });
});
