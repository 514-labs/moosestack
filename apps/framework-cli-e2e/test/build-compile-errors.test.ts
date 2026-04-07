/**
 * E2E tests for build compile error handling.
 *
 * Verifies that `moose build` (via moose-tspc single compilation) fails
 * when TypeScript source contains compile errors, matching the behavior
 * of `moose dev` (watch mode compilation).
 *
 * Bug: moose-tspc single compilation sets noEmitOnError: false, allowing
 * builds to succeed despite TypeScript errors that would fail in dev mode.
 */
import { expect } from "chai";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createTempTestDirectory, removeTestProject } from "./utils/file-utils";
import { setupTypeScriptProject } from "./utils/project-setup";
import { logger } from "./utils/logger";

const testLogger = logger.scope("build-compile-errors");

describe("Build Compile Error Handling", function () {
  this.timeout(120_000);

  const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
  const MOOSE_LIB_PATH = path.resolve(
    __dirname,
    "../../../packages/ts-moose-lib",
  );

  describe("moose-tspc single compilation rejects type errors", function () {
    let projectDir: string;

    before(async function () {
      this.timeout(90_000);
      projectDir = createTempTestDirectory("build-compile-error", {
        logger: testLogger,
      });
      testLogger.info("Setting up project with type errors", { projectDir });

      await setupTypeScriptProject(
        projectDir,
        "typescript-empty",
        CLI_PATH,
        MOOSE_LIB_PATH,
        "build-error-test-app",
        "npm",
        { logger: testLogger },
      );

      // Write TypeScript source with a deliberate type error
      const indexTs = `
// This file has a deliberate type error to test that moose build fails
export function add(a: number, b: number): number {
  return a + b;
}

// Type error: assigning a string to a number variable
const result: number = add(1, 2);
const broken: number = "this is not a number";

export { result, broken };
`;
      fs.writeFileSync(path.join(projectDir, "app", "index.ts"), indexTs);
      testLogger.info("Added TypeScript file with deliberate type error");
    });

    after(function () {
      if (projectDir) {
        removeTestProject(projectDir, { logger: testLogger });
      }
    });

    it("should fail compilation when source has type errors", async function () {
      // Run moose-tspc in single compilation mode (same as moose build)
      // This should fail because of the type error, but currently succeeds
      // due to noEmitOnError: false
      let compilationFailed = false;
      let output = "";

      try {
        output = execSync("npx moose-tspc .moose/compiled", {
          cwd: projectDir,
          stdio: "pipe",
          env: { ...process.env, MOOSE_SOURCE_DIR: "app" },
          encoding: "utf-8",
        });
        testLogger.info("Compilation output", { output });
      } catch (error: any) {
        compilationFailed = true;
        testLogger.info("Compilation failed as expected", {
          exitCode: error.status,
          stderr: error.stderr?.toString(),
        });
      }

      expect(
        compilationFailed,
        "moose-tspc single compilation should fail on type errors " +
          "(parity with watch mode / moose dev). " +
          "Got output: " +
          output,
      ).to.be.true;
    });
  });
});
