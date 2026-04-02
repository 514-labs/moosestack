/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");

const runInit = (
  args: string[],
  options: {
    homeDir: string;
    cwd?: string;
    stdin?: string;
  },
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(CLI_PATH, args, {
      cwd: options.cwd ?? options.homeDir,
      env: {
        ...process.env,
        HOME: options.homeDir,
        MOOSE_TELEMETRY__ENABLED: "false",
      },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });

const createTempDir = (prefix: string) =>
  fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${randomUUID()}-`));

describe("init", () => {
  it("prompts for a template when none is provided", async function () {
    this.timeout(120_000);

    const homeDir = createTempDir("moose-init-home");
    const projectDir = path.join(homeDir, "interactive-app");

    const result = await runInit(
      ["init", "interactive-app", "--location", projectDir],
      {
        homeDir,
        stdin: "typescript-empty\n",
      },
    );

    expect(result.code).to.equal(0, result.stderr);
    expect(result.stdout).to.contain("Select template");
    expect(fs.existsSync(path.join(projectDir, "package.json"))).to.equal(true);
    expect(fs.existsSync(path.join(projectDir, "moose.config.toml"))).to.equal(
      true,
    );
  });

  it("accepts an explicit template together with --from-remote", async function () {
    this.timeout(120_000);

    const homeDir = createTempDir("moose-init-home");
    const projectDir = path.join(homeDir, "remote-app");

    const result = await runInit(
      [
        "init",
        "remote-app",
        "typescript-empty",
        "--from-remote",
        "not-a-clickhouse-url",
        "--location",
        projectDir,
      ],
      { homeDir },
    );

    expect(result.code).to.not.equal(0);
    expect(fs.existsSync(path.join(projectDir, "package.json"))).to.equal(true);
    expect(`${result.stdout}\n${result.stderr}`).to.contain(
      "Failed to parse ClickHouse URL",
    );
  });
});
