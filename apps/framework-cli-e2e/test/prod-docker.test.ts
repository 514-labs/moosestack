/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E test for production Docker mode.
 *
 * Builds the moose app as a Docker image using `moose build --docker`,
 * starts the full stack (app + infra) via docker-compose, and verifies
 * the service comes up healthy.
 */

import { execSync } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import http from "http";

import { TIMEOUTS, SERVER_CONFIG } from "./constants";
import { createTempTestDirectory, performGlobalCleanup } from "./utils";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const TEMPLATE_SOURCE_DIR = path.resolve(
  __dirname,
  "../../../template-packages/_staging_typescript-tests",
);
const MOOSE_LIB_DIR = path.resolve(__dirname, "../../../packages/ts-moose-lib");
const COMPOSE_FIXTURE = path.resolve(
  __dirname,
  "fixtures/docker-compose.prod-test.yml",
);

const COMPOSE_PROJECT_NAME = "moose-prod-docker-test";

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      })
      .on("error", reject);
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  const interval = 3000;

  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await httpGet(url);
      if (status === 200) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  health check passed after ${elapsed}s`);
        return;
      }
    } catch {
      // service not ready yet
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`Health check at ${url} did not pass within ${timeoutMs}ms`);
}

function runCommand(
  cmd: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const startMs = Date.now();
  console.log(`  > ${cmd}`);
  const output = execSync(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: TIMEOUTS.SERVER_STARTUP_MS,
  });
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`  (completed in ${elapsed}s)`);
  return output;
}

describe("Prod Docker Mode", function () {
  let testProjectDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.SERVER_STARTUP_MS);

    console.log("\n=== Prod Docker Mode - Setup ===");

    // Global cleanup from any prior runs
    await performGlobalCleanup();

    // 1. Create temp directory and copy template
    testProjectDir = createTempTestDirectory("prod-docker");
    fs.mkdirSync(testProjectDir, { recursive: true });
    console.log(`Test directory: ${testProjectDir}`);

    console.log("Copying typescript-tests template...");
    fs.cpSync(TEMPLATE_SOURCE_DIR, testProjectDir, { recursive: true });

    // 2. Pack local ts-moose-lib and inject into project so Docker uses it
    // instead of pulling @514labs/moose-lib@latest from npm.
    console.log("Packing local ts-moose-lib...");
    let startMs = Date.now();
    const tgzFilename = execSync("pnpm pack", {
      cwd: MOOSE_LIB_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    let elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  packed in ${elapsed}s: ${tgzFilename}`);

    // Place tgz inside the source dir so it's included in the Docker build
    // context (the Dockerfile does COPY ./src ./src).
    const tgzSource = path.join(MOOSE_LIB_DIR, tgzFilename);
    const tgzDest = path.join(testProjectDir, "src", "moose-lib.tgz");
    fs.copyFileSync(tgzSource, tgzDest);
    fs.unlinkSync(tgzSource);

    const pkgJsonPath = path.join(testProjectDir, "package.json");
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    for (const depKey of ["dependencies", "devDependencies"] as const) {
      if (pkgJson[depKey]?.["@514labs/moose-lib"]) {
        pkgJson[depKey]["@514labs/moose-lib"] = "file:./src/moose-lib.tgz";
      }
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
    console.log("  Patched package.json to use local moose-lib");

    // 3. Build Docker image via moose-cli
    // No local npm install needed -- Docker handles dependency installation.
    // Without a lockfile, the Dockerfile uses a non-strict install command.
    console.log("Building Docker image with moose-cli build --docker...");
    startMs = Date.now();
    try {
      runCommand(`${CLI_PATH} build --docker`, {
        cwd: testProjectDir,
        env: {
          MOOSE_TELEMETRY__ENABLED: "false",
          TEST_AWS_ACCESS_KEY_ID: "test-access-key",
          TEST_AWS_SECRET_ACCESS_KEY: "test-secret-key",
        },
      });
    } catch (err: any) {
      console.error("Docker build stdout:", err.stdout?.toString());
      console.error("Docker build stderr:", err.stderr?.toString());
      throw err;
    }
    elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  Docker image built in ${elapsed}s`);

    // 4. Copy compose file and start the stack
    const composeFile = path.join(
      testProjectDir,
      "docker-compose.prod-test.yml",
    );
    fs.copyFileSync(COMPOSE_FIXTURE, composeFile);

    console.log("Starting docker compose stack...");
    startMs = Date.now();
    runCommand(
      `docker compose -f docker-compose.prod-test.yml -p ${COMPOSE_PROJECT_NAME} up -d`,
      { cwd: testProjectDir },
    );
    elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  docker compose up completed in ${elapsed}s`);

    // 5. Wait for moose-app health
    console.log("Waiting for moose-app health check...");
    await waitForHealth(
      `${SERVER_CONFIG.url}/health`,
      TIMEOUTS.SERVER_STARTUP_MS,
    );

    console.log("=== Prod Docker Mode - Setup Complete ===\n");
  });

  it("should start healthy in production Docker mode", async function () {
    this.timeout(30_000);
    const { status } = await httpGet(`${SERVER_CONFIG.url}/health`);
    expect(status).to.equal(200);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    console.log("\n=== Prod Docker Mode - Cleanup ===");

    if (testProjectDir) {
      try {
        console.log("Stopping docker compose stack...");
        execSync(
          `docker compose -f docker-compose.prod-test.yml -p ${COMPOSE_PROJECT_NAME} down -v --remove-orphans`,
          {
            cwd: testProjectDir,
            encoding: "utf-8",
            stdio: "pipe",
            timeout: TIMEOUTS.DOCKER_COMPOSE_DOWN_MS,
          },
        );
        console.log("  docker compose down completed");
      } catch (err) {
        console.error("Failed to stop docker compose:", err);
      }

      try {
        fs.rmSync(testProjectDir, { recursive: true, force: true });
        console.log("  temp directory removed");
      } catch (err) {
        console.error("Failed to remove temp directory:", err);
      }
    }

    // Remove the locally-built test image
    try {
      execSync(
        "docker rmi moose-df-deployment-local:latest 2>/dev/null || true",
        {
          encoding: "utf-8",
          stdio: "pipe",
        },
      );
    } catch {
      // image may not exist
    }

    console.log("=== Prod Docker Mode - Cleanup Complete ===\n");
  });
});
