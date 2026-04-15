import { expect } from "chai";
import { ChildProcess, execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { TIMEOUTS } from "./constants";
import {
  createTempTestDirectory,
  logger,
  removeTestProject,
  setupTypeScriptProject,
  startMooseDev,
  stopDevProcess,
} from "./utils";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const testLogger = logger.scope("dockerless-binary-cache");

function createMinimalRuntimePath(binDir: string): void {
  const runtimeBins = [
    process.execPath,
    "/bin/sh",
    "/bin/bash",
    resolveBinaryPath("npm"),
    resolveBinaryPath("npx"),
    resolveBinaryPath("pnpm"),
  ].filter((candidate) => fs.existsSync(candidate));

  for (const sourcePath of runtimeBins) {
    fs.symlinkSync(sourcePath, path.join(binDir, path.basename(sourcePath)));
  }
}

function resolveBinaryPath(command: string): string {
  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim();
  } catch {
    return path.join("/missing", command);
  }
}

async function waitForClickHouseBinary(
  binariesRoot: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const clickhouseRoot = path.join(binariesRoot, "clickhouse");
    if (fs.existsSync(clickhouseRoot)) {
      const clickhouseVersions = fs.readdirSync(clickhouseRoot);
      if (clickhouseVersions.length > 0) {
        const platformRoot = path.join(clickhouseRoot, clickhouseVersions[0]);
        const platformDirs = fs.readdirSync(platformRoot);
        if (platformDirs.length > 0) {
          const clickhouseBinaryPath = path.join(
            platformRoot,
            platformDirs[0],
            "clickhouse",
          );
          if (fs.existsSync(clickhouseBinaryPath)) {
            return clickhouseBinaryPath;
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for clickhouse binary to appear under ${binariesRoot}`,
  );
}

describe("Dockerless Binary Cache", function () {
  this.timeout(300_000);

  let projectDir: string;
  let cacheHomeDir: string;
  let pathBinDir: string;
  let devProcess: ChildProcess | null = null;

  before(async function () {
    projectDir = createTempTestDirectory("dockerless-cache", {
      logger: testLogger,
    });
    cacheHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "moose-e2e-cache-home-"),
    );
    pathBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-e2e-bin-"));

    createMinimalRuntimePath(pathBinDir);

    await setupTypeScriptProject(
      projectDir,
      "typescript",
      CLI_PATH,
      MOOSE_LIB_PATH,
      "dockerless-cache-app",
      "npm",
      {
        env: {
          ...process.env,
          HOME: cacheHomeDir,
        },
        logger: testLogger,
      },
    );
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);

    if (devProcess) {
      await stopDevProcess(devProcess, { logger: testLogger });
      devProcess = null;
    }

    removeTestProject(projectDir, { logger: testLogger });
    removeTestProject(cacheHomeDir, { logger: testLogger });
    removeTestProject(pathBinDir, { logger: testLogger });
  });

  afterEach(async function () {
    if (devProcess) {
      await stopDevProcess(devProcess, { logger: testLogger });
      devProcess = null;
    }
  });

  it("uses the shared home cache without relying on PATH-installed binaries", async function () {
    devProcess = startMooseDev({
      cliPath: CLI_PATH,
      cwd: projectDir,
      projectDir,
      logger: testLogger,
      extraEnv: {
        HOME: cacheHomeDir,
        PATH: pathBinDir,
      },
    }).devProcess;

    const binariesRoot = path.join(cacheHomeDir, ".moose", "binaries");
    const clickhouseBinaryPath = await waitForClickHouseBinary(
      binariesRoot,
      TIMEOUTS.SERVER_STARTUP_MS,
    );

    expect(devProcess.exitCode).to.equal(null);
    expect(fs.existsSync(path.join(pathBinDir, "clickhouse"))).to.equal(false);
    expect(fs.existsSync(path.join(pathBinDir, "temporal"))).to.equal(false);
    expect(fs.existsSync(binariesRoot)).to.equal(true);
    expect(fs.existsSync(clickhouseBinaryPath)).to.equal(true);
  });
});
