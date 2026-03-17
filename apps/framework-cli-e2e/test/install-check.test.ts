/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Lightweight install-check test that validates template init + install
 * works for the given package manager. No Docker, no dev server.
 *
 * This test is designed to run in the CI install-compat matrix
 * (Node × PM) on lightweight runners without Docker.
 */

import { expect } from "chai";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { TEMPLATE_NAMES, APP_NAMES } from "./constants";
import {
  createTempTestDirectory,
  setupTypeScriptProject,
  logger,
} from "./utils";

const testLogger = logger.scope("install-check");

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const TEST_PACKAGE_MANAGER = (process.env.TEST_PACKAGE_MANAGER || "npm") as
  | "npm"
  | "pnpm";

describe("install check", function () {
  this.timeout(5 * 60 * 1000); // 5 minutes

  let projectDir: string;

  afterEach(function () {
    if (projectDir && fs.existsSync(projectDir)) {
      testLogger.info(`Cleaning up temp directory: ${projectDir}`);
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it(`should init and install with ${TEST_PACKAGE_MANAGER}`, async function () {
    // Create temp directory
    projectDir = createTempTestDirectory("install-check");
    testLogger.info(
      `Testing install with ${TEST_PACKAGE_MANAGER} in ${projectDir}`,
    );

    // Run moose init + replace moose-lib with local + install
    await setupTypeScriptProject(
      projectDir,
      TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAMES.TYPESCRIPT_DEFAULT,
      TEST_PACKAGE_MANAGER,
      { logger: testLogger },
    );

    // Assert: node_modules/@514labs/moose-lib exists
    const mooseLibNodeModules = path.join(
      projectDir,
      "node_modules",
      "@514labs",
      "moose-lib",
    );
    expect(
      fs.existsSync(mooseLibNodeModules),
      `Expected node_modules/@514labs/moose-lib to exist at ${mooseLibNodeModules}`,
    ).to.be.true;

    // Install optional peer dep so tsc can resolve the McpServer type
    // that moose-lib re-exports in its public API
    testLogger.info(
      "Installing optional peer dependency @modelcontextprotocol/sdk",
    );
    execSync(`${TEST_PACKAGE_MANAGER} add @modelcontextprotocol/sdk`, {
      cwd: projectDir,
      stdio: "inherit",
      timeout: 60_000,
    });

    // Assert: npx tsc --noEmit succeeds (TypeScript resolves all types)
    testLogger.info("Running tsc --noEmit to verify TypeScript types resolve");
    execSync("npx tsc --noEmit", {
      cwd: projectDir,
      stdio: "inherit",
      timeout: 120_000,
    });

    testLogger.info("Install check passed");
  });
});
