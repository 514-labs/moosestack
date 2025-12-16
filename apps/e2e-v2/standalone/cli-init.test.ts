/**
 * CLI Init Standalone Tests
 *
 * Tests for `moose init` command that don't require running templates.
 */

import { expect } from "chai";
import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const MOOSE_BINARY =
  process.env.MOOSE_BINARY ||
  path.join(__dirname, "../../../target/debug/moose-cli");

describe("Standalone: CLI Init", function () {
  this.timeout(60000);

  let testDir: string;

  before(function () {
    // Create a temp directory for test projects
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-e2e-v2-"));
  });

  after(function () {
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("moose init with templates", function () {
    it("should initialize a TypeScript project from typescript-empty template", function () {
      const projectName = "test-ts-empty";
      const projectPath = path.join(testDir, projectName);

      const result = spawnSync(
        MOOSE_BINARY,
        ["init", projectName, "typescript-empty"],
        {
          cwd: testDir,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).to.equal(0);
      expect(fs.existsSync(projectPath)).to.be.true;
      expect(fs.existsSync(path.join(projectPath, "moose.config.toml"))).to.be
        .true;
      expect(fs.existsSync(path.join(projectPath, "package.json"))).to.be.true;
      expect(fs.existsSync(path.join(projectPath, "tsconfig.json"))).to.be.true;
    });

    it("should initialize a Python project from python-empty template", function () {
      const projectName = "test-py-empty";
      const projectPath = path.join(testDir, projectName);

      const result = spawnSync(
        MOOSE_BINARY,
        ["init", projectName, "python-empty"],
        {
          cwd: testDir,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).to.equal(0);
      expect(fs.existsSync(projectPath)).to.be.true;
      expect(fs.existsSync(path.join(projectPath, "moose.config.toml"))).to.be
        .true;
    });

    it("should fail with invalid template name", function () {
      const projectName = "test-invalid";

      const result = spawnSync(
        MOOSE_BINARY,
        ["init", projectName, "nonexistent-template"],
        {
          cwd: testDir,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).to.not.equal(0);
    });

    it("should fail with invalid project name", function () {
      const result = spawnSync(
        MOOSE_BINARY,
        ["init", "invalid name with spaces", "typescript-empty"],
        {
          cwd: testDir,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).to.not.equal(0);
    });
  });

  describe("moose init with --language flag", function () {
    it("should initialize a TypeScript project with --language typescript", function () {
      const projectName = "test-ts-lang";
      const projectPath = path.join(testDir, projectName);

      const result = spawnSync(
        MOOSE_BINARY,
        ["init", projectName, "--language", "typescript"],
        {
          cwd: testDir,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).to.equal(0);
      expect(fs.existsSync(projectPath)).to.be.true;

      // Verify it's a TypeScript project
      const configPath = path.join(projectPath, "moose.config.toml");
      const config = fs.readFileSync(configPath, "utf-8");
      expect(config).to.include('language = "Typescript"');
    });

    it("should initialize a Python project with --language python", function () {
      const projectName = "test-py-lang";
      const projectPath = path.join(testDir, projectName);

      const result = spawnSync(
        MOOSE_BINARY,
        ["init", projectName, "--language", "python"],
        {
          cwd: testDir,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

      expect(result.status).to.equal(0);
      expect(fs.existsSync(projectPath)).to.be.true;

      // Verify it's a Python project
      const configPath = path.join(projectPath, "moose.config.toml");
      const config = fs.readFileSync(configPath, "utf-8");
      expect(config).to.include('language = "Python"');
    });
  });
});
