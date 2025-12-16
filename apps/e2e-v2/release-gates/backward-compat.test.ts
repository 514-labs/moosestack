/**
 * Backward Compatibility Release Gate Tests
 *
 * These tests verify backward compatibility requirements that must pass
 * before any release. They ensure existing projects continue to work.
 */

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const MOOSE_BINARY =
  process.env.MOOSE_BINARY ||
  path.join(__dirname, "../../target/debug/moose-cli");

describe("Release Gate: Backward Compatibility", function () {
  this.timeout(120000);

  let testDir: string;

  before(function () {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-release-gate-"));
  });

  after(function () {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Config File Compatibility", function () {
    it("should accept minimal moose.config.toml", function () {
      const projectName = "minimal-config";
      const projectPath = path.join(testDir, projectName);

      // Create minimal project structure
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(path.join(projectPath, "src"), { recursive: true });

      // Write minimal config
      const minimalConfig = `
language = "Typescript"
source_dir = "src"
`;
      fs.writeFileSync(
        path.join(projectPath, "moose.config.toml"),
        minimalConfig,
      );

      // Write minimal package.json
      fs.writeFileSync(
        path.join(projectPath, "package.json"),
        JSON.stringify({ name: projectName, version: "1.0.0" }),
      );

      // Write empty index.ts
      fs.writeFileSync(path.join(projectPath, "src", "index.ts"), "");

      // Run moose check
      const result = spawnSync(MOOSE_BINARY, ["check"], {
        cwd: projectPath,
        encoding: "utf-8",
        timeout: 30000,
      });

      // Check should pass with minimal config
      expect(result.status).to.equal(0);
    });

    it("should accept moose.config.toml with legacy field names", function () {
      const projectName = "legacy-config";
      const projectPath = path.join(testDir, projectName);

      // Create project structure
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(path.join(projectPath, "src"), { recursive: true });

      // Write config with fields that might have changed names
      const legacyConfig = `
language = "Typescript"
source_dir = "src"

[clickhouse_config]
db_name = "local"
host = "localhost"
host_port = 18123
`;
      fs.writeFileSync(
        path.join(projectPath, "moose.config.toml"),
        legacyConfig,
      );

      fs.writeFileSync(
        path.join(projectPath, "package.json"),
        JSON.stringify({ name: projectName, version: "1.0.0" }),
      );

      fs.writeFileSync(path.join(projectPath, "src", "index.ts"), "");

      const result = spawnSync(MOOSE_BINARY, ["check"], {
        cwd: projectPath,
        encoding: "utf-8",
        timeout: 30000,
      });

      expect(result.status).to.equal(0);
    });
  });

  describe("Template Compatibility", function () {
    const requiredTemplates = [
      "typescript-empty",
      "typescript",
      "python-empty",
      "python",
    ];

    for (const template of requiredTemplates) {
      it(`should successfully initialize ${template} template`, function () {
        const projectName = `compat-${template}`;
        const projectPath = path.join(testDir, projectName);

        const result = spawnSync(
          MOOSE_BINARY,
          ["init", projectName, template],
          {
            cwd: testDir,
            encoding: "utf-8",
            timeout: 60000,
          },
        );

        expect(
          result.status,
          `Failed to init ${template}: ${result.stderr}`,
        ).to.equal(0);
        expect(fs.existsSync(projectPath)).to.be.true;
        expect(fs.existsSync(path.join(projectPath, "moose.config.toml"))).to.be
          .true;
      });
    }
  });

  describe("CLI Command Availability", function () {
    const requiredCommands = [
      { cmd: ["--help"], expectSuccess: true },
      { cmd: ["init", "--help"], expectSuccess: true },
      { cmd: ["dev", "--help"], expectSuccess: true },
      { cmd: ["build", "--help"], expectSuccess: true },
      { cmd: ["check", "--help"], expectSuccess: true },
      { cmd: ["ls", "--help"], expectSuccess: true },
      { cmd: ["ready", "--help"], expectSuccess: true },
    ];

    for (const { cmd, expectSuccess } of requiredCommands) {
      it(`should have working command: moose ${cmd.join(" ")}`, function () {
        const result = spawnSync(MOOSE_BINARY, cmd, {
          encoding: "utf-8",
          timeout: 10000,
        });

        if (expectSuccess) {
          expect(result.status).to.equal(0);
        }
        // Help commands should output something
        expect(result.stdout.length + result.stderr.length).to.be.greaterThan(
          0,
        );
      });
    }
  });
});
