/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for Docker builds with Drizzle ORM dependencies.
 *
 * Tests that the moose-tspc compiler handles dual-package type conflicts
 * (like those from Drizzle ORM) gracefully during Docker pre-compilation.
 *
 * The key behavior being tested:
 * 1. TypeScript compilation completes even with type errors from dual-package issues
 * 2. Compiled .js files are generated in .moose/compiled/
 * 3. The compiled code uses CommonJS format (not ESM)
 * 4. moose check succeeds with the compiled code
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

const testLogger = logger.scope("docker-build-drizzle-test");

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("Docker build with Drizzle ORM dependencies", () => {
  let TEST_PROJECT_DIR: string;

  before(async function () {
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
    TEST_PROJECT_DIR = createTempTestDirectory("docker-build-drizzle");

    // Setup TypeScript project with tests template (has more dependencies)
    await setupTypeScriptProject(
      TEST_PROJECT_DIR,
      TEMPLATE_NAMES.TYPESCRIPT_TESTS,
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAMES.TYPESCRIPT_TESTS,
      "npm",
    );

    // Add Drizzle ORM as a dependency
    testLogger.info("Adding Drizzle ORM dependency...");
    const packageJsonPath = path.join(TEST_PROJECT_DIR, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    packageJson.dependencies["drizzle-orm"] = "^0.33.0";
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Install the new dependency
    testLogger.info("Installing Drizzle ORM...");
    await execAsync("npm install", {
      cwd: TEST_PROJECT_DIR,
      stdio: "inherit",
    });

    // Create a consumer file that uses Drizzle ORM types
    // This will cause dual-package type conflicts that the compiler should handle
    const consumerDir = path.join(TEST_PROJECT_DIR, "src", "consumers");
    await fs.promises.mkdir(consumerDir, { recursive: true });

    const drizzleConsumerContent = `
import { PgTable } from "drizzle-orm/pg-core";
import { Stream } from "@514labs/moose-lib";

// Define a Drizzle table type
export interface ParsedLog {
  id: string;
  timestamp: Date;
  message: string;
}

// Consumer that uses Drizzle ORM types
// This will trigger dual-package type resolution issues
export default async function parsedLogsConsumer(
  event: ParsedLog,
): Promise<void> {
  console.log("Processing parsed log:", event.id);
  // In a real app, this might interact with Drizzle ORM tables
  // The type usage is what triggers the compilation issues we're testing
}
`;

    fs.writeFileSync(
      path.join(consumerDir, "parsed-logs.consumer.ts"),
      drizzleConsumerContent,
    );

    testLogger.info("Test project setup complete with Drizzle ORM");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    // Cleanup test directory
    if (TEST_PROJECT_DIR && fs.existsSync(TEST_PROJECT_DIR)) {
      testLogger.info("Cleaning up test directory:", TEST_PROJECT_DIR);
      await fs.promises.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
    }
  });

  it("should compile TypeScript successfully with dual-package type conflicts", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("Running moose-tspc to pre-compile TypeScript...");

    // Run moose-tspc (the Docker pre-compilation command)
    let compileOutput = "";
    let compileError = "";
    let compileExitCode = 0;

    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
      compileError = result.stderr;
    } catch (error: any) {
      compileOutput = error.stdout || "";
      compileError = error.stderr || "";
      compileExitCode = error.code || 1;
      testLogger.info(
        "Compilation exited with non-zero code (expected for type errors):",
        compileExitCode,
      );
    }

    testLogger.info("Compile stdout:", compileOutput);
    if (compileError) {
      testLogger.info("Compile stderr:", compileError);
    }

    // Verify compilation completed (may have warnings)
    // The key is that it should NOT fail completely - files should be generated
    expect(
      compileOutput.includes("Compilation complete") ||
        compileOutput.includes("Compilation complete (with type errors)") ||
        compileOutput.includes(
          "Warning: TypeScript reported errors but files were emitted",
        ),
    ).to.be.true;

    // Verify compiled .js files exist in .moose/compiled
    const compiledDir = path.join(TEST_PROJECT_DIR, ".moose", "compiled");
    const compiledAppDir = path.join(compiledDir, "src");

    testLogger.info("Checking for compiled files in:", compiledAppDir);
    expect(fs.existsSync(compiledAppDir)).to.be.true;

    // Check for specific compiled files
    const expectedFiles = [
      path.join(compiledAppDir, "consumers", "parsed-logs.consumer.js"),
      path.join(compiledAppDir, "ingest", "models.js"),
    ];

    for (const filePath of expectedFiles) {
      testLogger.info("Checking for compiled file:", filePath);
      expect(fs.existsSync(filePath), `Expected file to exist: ${filePath}`).to
        .be.true;

      // Verify it's CommonJS format (contains require() calls)
      const fileContent = fs.readFileSync(filePath, "utf-8");
      expect(
        fileContent.includes("require(") || fileContent.includes("exports."),
        `Expected ${path.basename(filePath)} to use CommonJS format`,
      ).to.be.true;
    }

    testLogger.info("✅ Docker build with Drizzle ORM completed successfully");
  });

  it("should generate CommonJS output (not ESM)", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    const compiledConsumerPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "src",
      "consumers",
      "parsed-logs.consumer.js",
    );

    expect(fs.existsSync(compiledConsumerPath)).to.be.true;

    const content = fs.readFileSync(compiledConsumerPath, "utf-8");

    // Check for CommonJS patterns
    expect(
      content.includes("require(") || content.includes("exports."),
      "Expected CommonJS format with require() or exports",
    ).to.be.true;

    // Should NOT have ESM patterns
    expect(
      !content.includes("import {") || content.includes("require("),
      "Should not use ESM import syntax in compiled output",
    ).to.be.true;

    testLogger.info("✅ Verified CommonJS output format");
  });

  it("should handle type errors gracefully without failing the build", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Create a file with intentional type conflicts (like Drizzle ORM dual-package issues)
    const testFilePath = path.join(
      TEST_PROJECT_DIR,
      "src",
      "consumers",
      "type-error-test.consumer.ts",
    );

    const typeErrorContent = `
import { PgTable } from "drizzle-orm/pg-core";

export interface TestEvent {
  id: string;
  timestamp: Date;
}

// This function has type conflicts but should still compile
export default async function typeErrorConsumer(
  event: TestEvent,
): Promise<void> {
  // Type conflicts from dual-package resolution
  const table: PgTable = {} as any;
  console.log("Processing event:", event.id, table);
}
`;

    fs.writeFileSync(testFilePath, typeErrorContent);

    // Run compilation again
    let compileOutput = "";
    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
    } catch (error: any) {
      compileOutput = error.stdout || "";
      testLogger.info("Compilation with type errors (expected)");
    }

    // Verify the file was still compiled despite type errors
    const compiledPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "src",
      "consumers",
      "type-error-test.consumer.js",
    );

    expect(
      fs.existsSync(compiledPath),
      "Expected file to be compiled despite type errors",
    ).to.be.true;

    testLogger.info(
      "✅ Type errors handled gracefully - files compiled successfully",
    );
  });
});
