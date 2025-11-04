/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for .env file configuration loading
 *
 * Tests verify that .env files are loaded correctly and configuration precedence is respected.
 * These tests follow the same pattern as the main template tests - setup once, test multiple scenarios.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

// Import constants and utilities
import { TIMEOUTS, SERVER_CONFIG } from "./constants";

import {
  stopDevProcess,
  waitForServerStart,
  killRemainingProcesses,
  cleanupDocker,
  globalDockerCleanup,
  removeTestProject,
  createTempTestDirectory,
  cleanupLeftoverTestDirectories,
  setupTypeScriptProject,
  setupPythonProject,
} from "./utils";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);

const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => global.setTimeout(resolve, ms));

describe("typescript template tests - .env file configuration", function () {
  let devProcess: ChildProcess | null = null;
  let TEST_PROJECT_DIR: string;
  const APP_NAME = "ts-dotenv-config-test";

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Cleanup first
    await globalDockerCleanup();
    await cleanupLeftoverTestDirectories();

    // Create test directory
    TEST_PROJECT_DIR = createTempTestDirectory("ts-dotenv-config");

    // Setup TypeScript project
    await setupTypeScriptProject(
      TEST_PROJECT_DIR,
      "typescript-empty",
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAME,
    );

    // Create .env files to test precedence
    // Base file with port 9990
    fs.writeFileSync(
      path.join(TEST_PROJECT_DIR, ".env"),
      "MOOSE_HTTP_SERVER_CONFIG__PORT=9990\n",
    );

    // Dev file with port 9991 (should override base)
    fs.writeFileSync(
      path.join(TEST_PROJECT_DIR, ".env.dev"),
      "MOOSE_HTTP_SERVER_CONFIG__PORT=9991\n",
    );

    // Local file with port 9992 (should override both in dev mode)
    fs.writeFileSync(
      path.join(TEST_PROJECT_DIR, ".env.local"),
      "MOOSE_HTTP_SERVER_CONFIG__PORT=9992\nMOOSE_LOGGER__LEVEL=debug\n",
    );

    // Start dev server
    console.log("Starting dev server for .env configuration tests...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: TEST_PROJECT_DIR,
      env: { ...process.env },
    });

    // Wait for server to start
    // If .env files work correctly, it should start on port 9992 (from .env.local)
    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "Your local development server is running",
      "http://localhost:9992",
    );

    console.log("Server started successfully!");
    // Brief wait to ensure server is fully ready
    await setTimeoutAsync(5000);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);

    // Stop dev process
    if (devProcess) {
      await stopDevProcess(devProcess);
      devProcess = null;
    }

    // Cleanup
    await killRemainingProcesses();
    await cleanupDocker(TEST_PROJECT_DIR, "ts-dotenv-config");
    removeTestProject(TEST_PROJECT_DIR);
    await cleanupLeftoverTestDirectories();
  });

  it("should load .env files with correct precedence (.env < .env.dev < .env.local)", async () => {
    // Verify server is running on port 9992 (from .env.local)
    const response = await fetch("http://localhost:9992/health");
    expect(response.ok).to.be.true;

    const health = await response.json();
    expect(health).to.have.property("healthy");

    console.log(
      "✓ Server is running on port 9992 from .env.local (correct precedence)",
    );
  });

  it("should have .env.local values accessible via environment", async () => {
    // The .env files are loaded, we can verify the server responds correctly
    const response = await fetch("http://localhost:9992/health");
    expect(response.status).to.equal(200);

    console.log("✓ .env.local configuration is active");
  });
});

describe("python template tests - .env file configuration", function () {
  let devProcess: ChildProcess | null = null;
  let TEST_PROJECT_DIR: string;
  const APP_NAME = "py-dotenv-config-test";

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Cleanup first
    await globalDockerCleanup();
    await cleanupLeftoverTestDirectories();

    // Create test directory
    TEST_PROJECT_DIR = createTempTestDirectory("py-dotenv-config");

    // Setup Python project
    await setupPythonProject(
      TEST_PROJECT_DIR,
      "python-empty",
      CLI_PATH,
      MOOSE_PY_LIB_PATH,
      APP_NAME,
    );

    // Create .env files to test precedence
    // Base file with port 9980
    fs.writeFileSync(
      path.join(TEST_PROJECT_DIR, ".env"),
      "MOOSE_HTTP_SERVER_CONFIG__PORT=9980\n",
    );

    // Dev file with port 9981 (should override base)
    fs.writeFileSync(
      path.join(TEST_PROJECT_DIR, ".env.dev"),
      "MOOSE_HTTP_SERVER_CONFIG__PORT=9981\n",
    );

    // Local file with port 9982 (should override both in dev mode)
    fs.writeFileSync(
      path.join(TEST_PROJECT_DIR, ".env.local"),
      "MOOSE_HTTP_SERVER_CONFIG__PORT=9982\nMOOSE_LOGGER__LEVEL=debug\n",
    );

    // Start dev server
    console.log("Starting dev server for Python .env configuration tests...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: TEST_PROJECT_DIR,
      env: {
        ...process.env,
        VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
        PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
      },
    });

    // Wait for server to start
    // If .env files work correctly, it should start on port 9982 (from .env.local)
    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "Your local development server is running",
      "http://localhost:9982",
    );

    console.log("Python server started successfully!");
    // Brief wait to ensure server is fully ready
    await setTimeoutAsync(5000);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);

    // Stop dev process
    if (devProcess) {
      await stopDevProcess(devProcess);
      devProcess = null;
    }

    // Cleanup
    await killRemainingProcesses();
    await cleanupDocker(TEST_PROJECT_DIR, "py-dotenv-config");
    removeTestProject(TEST_PROJECT_DIR);
    await cleanupLeftoverTestDirectories();
  });

  it("should load .env files with correct precedence (.env < .env.dev < .env.local)", async () => {
    // Verify server is running on port 9982 (from .env.local)
    const response = await fetch("http://localhost:9982/health");
    expect(response.ok).to.be.true;

    const health = await response.json();
    expect(health).to.have.property("healthy");

    console.log(
      "✓ Python server is running on port 9982 from .env.local (correct precedence)",
    );
  });

  it("should have .env.local values accessible via environment", async () => {
    // The .env files are loaded, we can verify the server responds correctly
    const response = await fetch("http://localhost:9982/health");
    expect(response.status).to.equal(200);

    console.log("✓ Python .env.local configuration is active");
  });
});
