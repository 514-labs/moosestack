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

import { execFileSync } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import http from "http";
import os from "os";

import { TIMEOUTS, SERVER_CONFIG } from "./constants";
import { createTempTestDirectory, performGlobalCleanup } from "./utils";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLI_PATH = path.join(REPO_ROOT, "target/debug/moose-cli");
const TEMPLATE_SOURCE_DIR = path.join(
  REPO_ROOT,
  "template-packages/_staging_typescript-tests",
);
const MOOSE_LIB_DIR = path.join(REPO_ROOT, "packages/ts-moose-lib");
const COMPOSE_FIXTURE = path.resolve(
  __dirname,
  "fixtures/docker-compose.prod-test.yml",
);

const COMPOSE_PROJECT_NAME = "moose-prod-docker-test";
const IS_LINUX = os.platform() === "linux";

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

function dumpComposeLogs(cwd: string): void {
  try {
    const logs = execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.prod-test.yml",
        "-p",
        COMPOSE_PROJECT_NAME,
        "logs",
        "--tail=300",
      ],
      {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
    console.log("\n=== Docker Compose Logs ===\n" + logs);
  } catch (err: any) {
    console.error("Failed to collect compose logs:", err.message);
  }
}

/**
 * On Linux the native debug build is already a usable Linux binary.
 * On macOS we cross-compile inside Docker using the host's native arch
 * (arm64 on Apple Silicon, amd64 on Intel) so there's no QEMU penalty.
 * Returns the absolute path to the Linux moose-cli binary.
 */
function ensureLinuxCliBinary(): string {
  if (IS_LINUX) {
    console.log("  Linux detected – using native debug binary");
    return CLI_PATH;
  }

  const linuxBinary = path.join(REPO_ROOT, "target/debug/moose-cli-linux");
  if (fs.existsSync(linuxBinary)) {
    console.log(`  Reusing cached Linux binary: ${linuxBinary}`);
    return linuxBinary;
  }

  const rustToolchain =
    fs
      .readFileSync(path.join(REPO_ROOT, "rust-toolchain.toml"), "utf-8")
      .match(/channel\s*=\s*"(.+?)"/)?.[1] ?? "stable";

  console.log(
    `  macOS detected – cross-compiling moose-cli inside Docker (rust:${rustToolchain}, ${os.arch()})...`,
  );
  const startMs = Date.now();

  // Build artifacts go on a Docker volume (not the mounted host filesystem)
  // to avoid virtiofs race conditions that cause "can't find crate" errors.
  // After building, we copy the binary out to the host.
  const platform = os.arch() === "arm64" ? "arm64" : "amd64";
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      `linux/${platform}`,
      "-v",
      `${REPO_ROOT}:/workspace`,
      "-v",
      "moose-prod-test-cargo-registry:/usr/local/cargo/registry",
      "-v",
      "moose-prod-test-cargo-git:/usr/local/cargo/git",
      "-v",
      "moose-prod-test-target:/build-target",
      "-v",
      `${path.dirname(linuxBinary)}:/output`,
      "-w",
      "/workspace",
      `rust:${rustToolchain}`,
      "bash",
      "-c",
      `apt-get update -qq && apt-get install -y -qq protobuf-compiler > /dev/null 2>&1 && CARGO_TARGET_DIR=/build-target cargo build --package moose-cli && cp /build-target/debug/moose-cli /output/${path.basename(linuxBinary)}`,
    ],
    { encoding: "utf-8", stdio: "inherit", timeout: 20 * 60 * 1000 },
  );

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`  Linux binary built in ${elapsed}s: ${linuxBinary}`);
  return linuxBinary;
}

function runCommand(
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const startMs = Date.now();
  console.log(`  > ${file} ${args.join(" ")}`);
  const output = execFileSync(file, args, {
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
    // Extra time on macOS for cross-compiling the Linux binary inside Docker
    const crossCompileBuffer = IS_LINUX ? 0 : 20 * 60 * 1000;
    this.timeout(
      TIMEOUTS.TEST_SETUP_MS + TIMEOUTS.SERVER_STARTUP_MS + crossCompileBuffer,
    );

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
    const tgzFilename = execFileSync("pnpm", ["pack"], {
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

    // 3. Ensure we have a Linux moose-cli binary for the Docker image.
    // On Linux this is just the native debug build; on macOS we cross-compile
    // inside Docker using the host's native arch (no QEMU).
    const linuxCliBinary = ensureLinuxCliBinary();

    // 4. Build Docker image via moose-cli.
    // MOOSE_DOCKER_LOCAL_BUILD points to the Linux binary so the Dockerfile
    // generator copies it into the image instead of downloading a release.
    console.log("Building Docker image with moose-cli build --docker...");
    startMs = Date.now();
    try {
      runCommand(CLI_PATH, ["build", "--docker"], {
        cwd: testProjectDir,
        env: {
          MOOSE_TELEMETRY__ENABLED: "false",
          MOOSE_DOCKER_LOCAL_BUILD: linuxCliBinary,
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

    // 5. Copy compose file and start the stack
    const composeFile = path.join(
      testProjectDir,
      "docker-compose.prod-test.yml",
    );
    fs.copyFileSync(COMPOSE_FIXTURE, composeFile);

    console.log("Starting docker compose stack...");
    startMs = Date.now();
    runCommand(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.prod-test.yml",
        "-p",
        COMPOSE_PROJECT_NAME,
        "up",
        "-d",
      ],
      { cwd: testProjectDir },
    );
    elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  docker compose up completed in ${elapsed}s`);

    // 6. Wait for moose-app health
    console.log("Waiting for moose-app health check...");
    try {
      await waitForHealth(
        `${SERVER_CONFIG.url}/health`,
        TIMEOUTS.SERVER_STARTUP_MS,
      );
    } catch (err) {
      dumpComposeLogs(testProjectDir);
      throw err;
    }

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
      dumpComposeLogs(testProjectDir);

      try {
        console.log("Stopping docker compose stack...");
        execFileSync(
          "docker",
          [
            "compose",
            "-f",
            "docker-compose.prod-test.yml",
            "-p",
            COMPOSE_PROJECT_NAME,
            "down",
            "-v",
            "--remove-orphans",
          ],
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
      execFileSync("docker", ["rmi", "moose-df-deployment-local:latest"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // image may not exist
    }

    console.log("=== Prod Docker Mode - Cleanup Complete ===\n");
  });
});
