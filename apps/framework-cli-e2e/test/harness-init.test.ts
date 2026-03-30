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
const SKILLS_FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../apps/framework-cli/tests/fixtures/agent-skills",
);

const runHarnessInit = (
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
        MOOSE_HARNESS_SKILLS_DIR: SKILLS_FIXTURE_PATH,
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

describe("harness init", () => {
  it("runs the zero-arg interactive wizard", async function () {
    this.timeout(120_000);

    const homeDir = createTempDir("moose-harness-home");
    const projectDir = path.join(homeDir, "wizard-e2e");
    fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });

    const result = await runHarnessInit(["harness", "init"], {
      homeDir,
      stdin: "wizard-e2e\ntypescript\n\n\n\n\n",
    });

    expect(result.code).to.equal(0, result.stderr);
    expect(result.stdout).to.contain("Starting interactive harness setup");
    expect(fs.existsSync(path.join(projectDir, "package.json"))).to.equal(true);
    expect(
      fs.existsSync(
        path.join(homeDir, ".codex/skills/clickhouse--best-practices"),
      ),
    ).to.equal(true);
  });

  it("stays non-interactive in arg-driven mode", async function () {
    this.timeout(120_000);

    const homeDir = createTempDir("moose-harness-home");
    const projectDir = path.join(homeDir, "arg-e2e");
    fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });

    const result = await runHarnessInit(
      [
        "harness",
        "init",
        "arg-e2e",
        "typescript",
        "--location",
        projectDir,
        "--agent",
        "codex",
      ],
      { homeDir },
    );

    expect(result.code).to.equal(0, result.stderr);
    expect(result.stdout).to.not.contain("Project name");
    expect(result.stdout).to.not.contain("Coding agents");
    expect(fs.existsSync(path.join(projectDir, "package.json"))).to.equal(true);
    expect(fs.existsSync(path.join(homeDir, ".codex/config.toml"))).to.equal(
      true,
    );
  });

  it("rejects bare --from-remote in arg-driven mode", async function () {
    this.timeout(120_000);

    const homeDir = createTempDir("moose-harness-home");
    const projectDir = path.join(homeDir, "remote-e2e");
    fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });

    const result = await runHarnessInit(
      [
        "harness",
        "init",
        "remote-e2e",
        "typescript",
        "--location",
        projectDir,
        "--from-remote",
        "--agent",
        "none",
      ],
      { homeDir },
    );

    expect(result.code).to.not.equal(0);
    expect(result.stderr).to.contain(
      "a value is required for '--from-remote <CONNECTION_STRING>'",
    );
  });

  it("supports project names that would otherwise match the schema subcommand", async function () {
    this.timeout(120_000);

    const homeDir = createTempDir("moose-harness-home");
    const projectDir = path.join(homeDir, "schema");
    fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });

    const result = await runHarnessInit(
      [
        "harness",
        "init",
        "--name",
        "schema",
        "--template",
        "typescript",
        "--location",
        projectDir,
        "--agent",
        "none",
      ],
      { homeDir },
    );

    expect(result.code).to.equal(0, result.stderr);
    expect(fs.existsSync(path.join(projectDir, "package.json"))).to.equal(true);
  });
});
