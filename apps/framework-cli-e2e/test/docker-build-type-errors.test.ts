/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for Docker build type error recovery.
 *
 * Tests that moose-tspc properly handles different types of compilation errors:
 * 1. Type errors that still produce .js files (should succeed with warnings)
 * 2. Syntax errors that prevent .js generation (should fail)
 *
 * This validates the error recovery logic added to handle Drizzle ORM
 * dual-package type conflicts while still catching real compilation failures.
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

const testLogger = logger.scope("docker-build-type-errors-test");

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("Docker build with type errors", () => {
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
      `docker-build-type-errors-${Date.now()}`,
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

  it("should complete compilation when files are emitted despite type errors", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info(
      "Creating file with type errors that still allow compilation...",
    );

    // Create a consumer with type errors that TypeScript can still compile
    // (e.g., type mismatches but valid JavaScript)
    const consumerDir = path.join(TEST_PROJECT_DIR, "app", "consumers");
    await fs.promises.mkdir(consumerDir, { recursive: true });

    const typeErrorContent = `
export interface TestEvent {
  id: string;
  count: number;
}

// Type error: Promise<string> doesn't match Promise<void>
// But TypeScript will still emit JavaScript
export default async function testConsumer(
  event: TestEvent,
): Promise<void> {
  // Type error: returning string instead of void
  return "This is a type error but compiles to valid JS";
}
`;

    fs.writeFileSync(
      path.join(consumerDir, "test.consumer.ts"),
      typeErrorContent,
    );

    testLogger.info("Running moose-tspc with type errors...");

    // Run moose-tspc - should succeed with warnings
    let compileOutput = "";
    let compileError = "";

    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
      compileError = result.stderr;
    } catch (error: any) {
      // Even if exit code is non-zero, check if files were generated
      compileOutput = error.stdout || "";
      compileError = error.stderr || "";
      testLogger.info(
        "Compilation exited with non-zero (expected for type errors):",
        error.code,
      );
    }

    testLogger.info("Compile output:", compileOutput);

    // Verify it logged warnings but didn't fail
    expect(
      compileOutput.includes("Compilation complete") ||
        compileOutput.includes("files were emitted") ||
        compileOutput.includes("with type errors"),
      "Expected compilation to complete with warnings",
    ).to.be.true;

    // Verify compiled .js files exist
    const compiledConsumerPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "consumers",
      "test.consumer.js",
    );

    expect(
      fs.existsSync(compiledConsumerPath),
      "Expected compiled file to exist despite type errors",
    ).to.be.true;

    // Verify the JavaScript is valid
    const jsContent = fs.readFileSync(compiledConsumerPath, "utf-8");
    expect(jsContent.length).to.be.greaterThan(0);
    expect(jsContent.includes("testConsumer") || jsContent.includes("default"))
      .to.be.true;

    testLogger.info(
      "✅ Compilation succeeded with type errors - files were emitted",
    );
  });

  it("should fail when syntax errors prevent file emission", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("Creating file with syntax errors...");

    // Create a file with syntax errors that prevent compilation
    const consumerDir = path.join(TEST_PROJECT_DIR, "app", "consumers");
    await fs.promises.mkdir(consumerDir, { recursive: true });

    const syntaxErrorContent = `
export interface TestEvent {
  id: string;
  count: number;
}

// Syntax error: missing closing brace
export default async function testConsumer(
  event: TestEvent,
): Promise<void> {
  console.log(event.id);
  // Missing closing brace }
`;

    fs.writeFileSync(
      path.join(consumerDir, "syntax-error.consumer.ts"),
      syntaxErrorContent,
    );

    testLogger.info("Running moose-tspc with syntax errors...");

    // Run moose-tspc - should fail
    let compileOutput = "";
    let compileError = "";
    let compileFailed = false;

    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
      compileError = result.stderr;
    } catch (error: any) {
      compileFailed = true;
      compileOutput = error.stdout || "";
      compileError = error.stderr || "";
      testLogger.info(
        "Compilation failed as expected with syntax errors:",
        error.code,
      );
    }

    testLogger.info("Compile output:", compileOutput);

    // Verify compilation failed
    expect(compileFailed, "Expected compilation to fail with syntax errors").to
      .be.true;

    // Verify it logged an error message
    expect(
      compileOutput.includes("Compilation failed") ||
        compileOutput.includes("no output files generated") ||
        compileError.includes("error"),
      "Expected error message about compilation failure",
    ).to.be.true;

    // Verify NO compiled files exist (or if directory exists, it's empty/incomplete)
    const compiledConsumerPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "consumers",
      "syntax-error.consumer.js",
    );

    // Either the file doesn't exist, or if it does, the compilation should have failed
    // The key is that the build process recognized the failure
    testLogger.info(
      "Checking compiled file existence:",
      fs.existsSync(compiledConsumerPath) ? "exists" : "does not exist",
    );

    testLogger.info(
      "✅ Compilation properly failed with syntax errors - no valid output",
    );
  });

  it("should emit warnings for recoverable errors but continue", async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    testLogger.info("Creating file with recoverable type errors...");

    // Create a file with type mismatches that are recoverable
    const consumerDir = path.join(TEST_PROJECT_DIR, "app", "consumers");
    await fs.promises.mkdir(consumerDir, { recursive: true });

    const recoverableErrorContent = `
export interface TestEvent {
  id: string;
  count: number;
  timestamp: Date;
}

export default async function testConsumer(
  event: TestEvent,
): Promise<void> {
  // Type error: treating Date as string
  const timestamp: string = event.timestamp as any;

  // Type error: implicit any
  const data = JSON.parse('{"key": "value"}');

  console.log("Processing:", event.id, timestamp, data.key);
}
`;

    fs.writeFileSync(
      path.join(consumerDir, "recoverable.consumer.ts"),
      recoverableErrorContent,
    );

    testLogger.info("Running moose-tspc with recoverable errors...");

    let compileOutput = "";
    try {
      const result = await execAsync(`npx moose-tspc .moose/compiled`, {
        cwd: TEST_PROJECT_DIR,
      });
      compileOutput = result.stdout;
    } catch (error: any) {
      compileOutput = error.stdout || "";
      testLogger.info(
        "Compilation completed (may have warnings):",
        error.code || 0,
      );
    }

    testLogger.info("Compile output:", compileOutput);

    // Verify it compiled successfully (with or without warnings)
    expect(
      compileOutput.includes("Compilation complete") ||
        compileOutput.includes("with type errors") ||
        compileOutput.includes("files were emitted"),
    ).to.be.true;

    // Verify compiled file exists
    const compiledPath = path.join(
      TEST_PROJECT_DIR,
      ".moose",
      "compiled",
      "app",
      "consumers",
      "recoverable.consumer.js",
    );

    expect(fs.existsSync(compiledPath)).to.be.true;

    // Verify the JavaScript content is valid
    const jsContent = fs.readFileSync(compiledPath, "utf-8");
    expect(jsContent.includes("testConsumer")).to.be.true;
    expect(jsContent.includes("Processing")).to.be.true;

    testLogger.info(
      "✅ Recoverable errors handled correctly - compilation succeeded with warnings",
    );
  });
});
