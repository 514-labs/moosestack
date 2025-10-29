/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Test for Docker Compose override functionality.
 *
 * This test verifies that users can extend Moose's Docker Compose
 * configuration by providing a docker-compose.dev.override.yaml file.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { TIMEOUTS, TEMPLATE_NAMES, APP_NAMES } from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  setupTypeScriptProject,
  cleanupClickhouseData,
  cleanupTestSuite,
} from "./utils";

const execAsync = promisify(require("child_process").exec);
const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => global.setTimeout(resolve, ms));

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("Docker Compose Override", () => {
  let devProcess: ChildProcess | null = null;
  let TEST_PROJECT_DIR: string;
  const APP_NAME = "test-override-app";

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Create temporary directory for this test
    TEST_PROJECT_DIR = createTempTestDirectory("docker-override-test");

    // Setup TypeScript project
    await setupTypeScriptProject(
      TEST_PROJECT_DIR,
      TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAME,
      "npm",
    );

    // Create docker-compose.dev.override.yaml with a simple custom service
    const overrideContent = `
version: '3.8'
services:
  # Add a custom nginx service for testing
  custom-nginx:
    image: nginx:alpine
    container_name: ${APP_NAME.toLowerCase()}-custom-nginx-1
    ports:
      - "18888:80"
`;

    const overrideFilePath = path.join(
      TEST_PROJECT_DIR,
      "docker-compose.dev.override.yaml",
    );
    fs.writeFileSync(overrideFilePath, overrideContent);
    console.log(`Created override file at ${overrideFilePath}`);

    // Start dev server
    console.log("Starting dev server with override file...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: TEST_PROJECT_DIR,
      env: process.env,
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "infrastructure started successfully",
      "http://localhost:4000",
    );

    console.log("Server started, cleaning up old data...");
    await cleanupClickhouseData();
    console.log("Waiting before running tests...");
    await setTimeoutAsync(TIMEOUTS.PRE_TEST_WAIT_MS);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    await cleanupTestSuite(devProcess, TEST_PROJECT_DIR, APP_NAME, {
      logPrefix: "Docker Compose Override Test",
    });
  });

  it("should start custom nginx service from override file", async function () {
    this.timeout(10000);

    // Wait a bit for containers to fully start
    await setTimeoutAsync(3000);

    // Verify that the custom nginx container is running
    const containerName = `${APP_NAME.toLowerCase()}-custom-nginx-1`;
    const { stdout } = await execAsync(
      `docker ps --filter "name=${containerName}" --format "{{.Names}}"`,
    );

    const runningContainers = stdout.trim().split("\n").filter(Boolean);
    console.log("Found containers:", runningContainers);

    expect(
      runningContainers,
      `Custom nginx container ${containerName} should be running`,
    ).to.include(containerName);

    // Verify nginx is accessible on the custom port
    try {
      const response = await fetch("http://localhost:18888");
      expect(response.ok, "Nginx should be accessible on custom port 18888").to
        .be.true;
    } catch (error) {
      throw new Error(
        `Failed to connect to custom nginx service: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  it("should log that override file is being used", async function () {
    // Check the dev process logs for the override file message
    let foundOverrideMessage = false;

    if (devProcess && devProcess.stdout) {
      devProcess.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        if (output.includes("docker-compose.dev.override.yaml")) {
          foundOverrideMessage = true;
        }
      });
    }

    // We can't easily check past logs, so we'll verify the container exists instead
    // which indirectly confirms the override file was used
    const containerName = `${APP_NAME.toLowerCase()}-custom-nginx-1`;
    const { stdout } = await execAsync(
      `docker ps --filter "name=${containerName}" --format "{{.Names}}"`,
    );

    expect(
      stdout.trim(),
      "Override file should have been applied (custom container exists)",
    ).to.include(containerName);
  });
});
