/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for moose query command (ENG-1226)
 *
 * Tests the query command functionality:
 * 1. Execute SQL from command line argument
 * 2. Execute SQL from file
 * 3. Execute SQL from stdin
 * 4. Respect limit parameter
 * 5. Handle errors gracefully
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { TIMEOUTS } from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  cleanupTestSuite,
  setupTypeScriptProject,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_TS_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("moose query command", () => {
  let devProcess: ChildProcess;
  let testProjectDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    console.log("\n=== Starting Query Command Test ===");

    // Create temp test directory
    testProjectDir = createTempTestDirectory("query-cmd-test");
    console.log("Test project dir:", testProjectDir);

    // Setup TypeScript project
    await setupTypeScriptProject(
      testProjectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_TS_LIB_PATH,
      "test-query-cmd",
      "npm",
    );

    // Start moose dev
    console.log("\nStarting moose dev...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: testProjectDir,
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "development server started",
      "http://localhost:4000",
    );

    console.log("✓ Infrastructure ready");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    console.log("\n=== Cleaning up Query Command Test ===");

    await cleanupTestSuite(devProcess, testProjectDir, "query-cmd-test", {
      logPrefix: "Query Command Test",
    });
  });

  it("should execute simple SELECT query from argument", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing query from argument ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query "SELECT 1 as num"`,
      {
        cwd: testProjectDir,
      },
    );

    console.log("Query output:", stdout);

    expect(stdout).to.include('{"num":1}');
    expect(stdout).to.include("1 rows");

    console.log("✓ Query from argument works");
  });

  it("should execute query with multiple rows", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing query with multiple rows ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query "SELECT number FROM system.numbers LIMIT 5"`,
      { cwd: testProjectDir },
    );

    const lines = stdout
      .trim()
      .split("\n")
      .filter((l: string) => l.startsWith("{"));
    expect(lines.length).to.equal(5);

    // Verify JSON format
    lines.forEach((line: string, idx: number) => {
      const parsed = JSON.parse(line);
      expect(parsed.number).to.equal(idx);
    });

    console.log("✓ Multiple rows returned correctly");
  });

  it("should execute query from file", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing query from file ---");

    const queryFile = path.join(testProjectDir, "test-query.sql");
    fs.writeFileSync(queryFile, "SELECT 'hello' as greeting, 42 as answer");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query -f test-query.sql`,
      { cwd: testProjectDir },
    );

    console.log("Query output:", stdout);

    expect(stdout).to.include('"greeting":"hello"');
    expect(stdout).to.include('"answer":42');

    console.log("✓ Query from file works");
  });

  it("should execute query from stdin", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing query from stdin ---");

    const { stdout } = await execAsync(
      `echo "SELECT 'stdin' as source" | "${CLI_PATH}" query`,
      { cwd: testProjectDir, shell: "/bin/bash" },
    );

    console.log("Query output:", stdout);

    expect(stdout).to.include('"source":"stdin"');

    console.log("✓ Query from stdin works");
  });

  it("should respect limit parameter", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing limit parameter ---");

    const { stdout } = await execAsync(
      `"${CLI_PATH}" query "SELECT number FROM system.numbers" --limit 3`,
      { cwd: testProjectDir },
    );

    const lines = stdout
      .trim()
      .split("\n")
      .filter((l: string) => l.startsWith("{"));
    expect(lines.length).to.equal(3);
    expect(stdout).to.include("3 rows");

    console.log("✓ Limit parameter works");
  });

  it("should handle query errors gracefully", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    console.log("\n--- Testing error handling ---");

    try {
      await execAsync(
        `"${CLI_PATH}" query "SELECT * FROM nonexistent_table_xyz"`,
        { cwd: testProjectDir },
      );
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("ClickHouse query error");
      console.log("✓ Query errors handled gracefully");
    }
  });

  describe("format query flag", () => {
    it("should format query as Python code", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing Python formatting ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c python "SELECT * FROM users WHERE email REGEXP '[a-z]+'"`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include('r"""');
      expect(stdout).to.include(
        "SELECT * FROM users WHERE email REGEXP '[a-z]+'",
      );
      expect(stdout).to.include('"""');
      expect(stdout).not.to.include("{"); // Should not have JSON output

      console.log("✓ Python formatting works");
    });

    it("should format query as TypeScript code", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing TypeScript formatting ---");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c typescript "SELECT * FROM users"`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include("`");
      expect(stdout).to.include("SELECT * FROM users");
      expect(stdout).not.to.include("{"); // Should not have JSON output

      console.log("✓ TypeScript formatting works");
    });

    it("should format query from file", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing format from file ---");

      const queryFile = path.join(testProjectDir, "format-test.sql");
      fs.writeFileSync(queryFile, "SELECT count(*) as total FROM events");

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c python -f format-test.sql`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include('r"""');
      expect(stdout).to.include("SELECT count(*) as total FROM events");

      console.log("✓ Format from file works");
    });

    it("should reject invalid language", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing invalid language ---");

      try {
        await execAsync(`"${CLI_PATH}" query -c java "SELECT 1"`, {
          cwd: testProjectDir,
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Unsupported language");
        console.log("✓ Invalid language rejected");
      }
    });

    it("should accept language aliases", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing language aliases ---");

      const pyResult = await execAsync(`"${CLI_PATH}" query -c py "SELECT 1"`, {
        cwd: testProjectDir,
      });
      expect(pyResult.stdout).to.include('r"""');

      const tsResult = await execAsync(`"${CLI_PATH}" query -c ts "SELECT 1"`, {
        cwd: testProjectDir,
      });
      expect(tsResult.stdout).to.include("`");

      console.log("✓ Language aliases work");
    });

    it("should format multi-line SQL with proper indentation", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing multi-line SQL ---");

      const queryFile = path.join(testProjectDir, "multiline-query.sql");
      const multilineSQL = `SELECT
    user_id,
    email,
    created_at
FROM users
WHERE status = 'active'
ORDER BY created_at DESC`;
      fs.writeFileSync(queryFile, multilineSQL);

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c python -f multiline-query.sql`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include('r"""');
      expect(stdout).to.include("    user_id,");
      expect(stdout).to.include("ORDER BY created_at DESC");
      expect(stdout).to.include('"""');

      console.log("✓ Multi-line SQL preserved correctly");
    });

    it("should format SQL with complex regex patterns", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing complex regex patterns ---");

      const complexQuery = `SELECT * FROM logs WHERE message REGEXP '\\\\d{4}-\\\\d{2}-\\\\d{2}\\\\s+\\\\w+'`;

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c python "${complexQuery}"`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include('r"""');
      // Raw strings should preserve backslashes
      expect(stdout).to.include("\\d{4}");
      expect(stdout).to.include("REGEXP");

      console.log("✓ Complex regex patterns preserved");
    });

    it("should format SQL with email regex pattern", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing email regex pattern ---");

      const emailQuery = `SELECT * FROM users WHERE email REGEXP '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$'`;

      const pyResult = await execAsync(
        `"${CLI_PATH}" query -c python "${emailQuery}"`,
        { cwd: testProjectDir },
      );

      expect(pyResult.stdout).to.include('r"""');
      expect(pyResult.stdout).to.include("[a-zA-Z0-9._%+-]+");

      const tsResult = await execAsync(
        `"${CLI_PATH}" query -c typescript "${emailQuery}"`,
        { cwd: testProjectDir },
      );

      expect(tsResult.stdout).to.include("`");
      expect(tsResult.stdout).to.include("[a-zA-Z0-9._%+-]+");

      console.log("✓ Email regex pattern preserved");
    });

    it("should handle queries with single quotes and backslashes", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing quotes and backslashes ---");

      const queryFile = path.join(testProjectDir, "complex-pattern.sql");
      const complexSQL = `SELECT * FROM data WHERE pattern REGEXP '\\\\b(foo|bar)\\\\b' AND name = 'test'`;
      fs.writeFileSync(queryFile, complexSQL);

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c python -f complex-pattern.sql`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include('r"""');
      expect(stdout).to.include("name = 'test'");
      expect(stdout).to.include("\\b(foo|bar)\\b");

      console.log("✓ Quotes and backslashes preserved");
    });

    it("should prettify SQL when --prettify flag is used", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing prettify functionality ---");

      const messyQuery =
        "SELECT id, name FROM users WHERE active = 1 ORDER BY name LIMIT 10";

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c python -p "${messyQuery}"`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include('r"""');
      expect(stdout).to.include("SELECT");
      expect(stdout).to.include("FROM");
      expect(stdout).to.include("WHERE");
      expect(stdout).to.include("ORDER BY");
      // Should have line breaks (prettified)
      const lines = stdout.split("\n");
      expect(lines.length).to.be.greaterThan(3);

      console.log("✓ Prettify works");
    });

    it("should prettify complex SQL with TypeScript", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing prettify with TypeScript ---");

      const complexQuery =
        "SELECT u.id, u.name, o.total FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.active = 1 AND o.total > 100 ORDER BY o.total DESC";

      const { stdout } = await execAsync(
        `"${CLI_PATH}" query -c typescript -p "${complexQuery}"`,
        { cwd: testProjectDir },
      );

      console.log("Format output:", stdout);

      expect(stdout).to.include("`");
      expect(stdout).to.include("SELECT");
      expect(stdout).to.include("LEFT JOIN");
      expect(stdout).to.include("WHERE");
      expect(stdout).to.include("ORDER BY");

      console.log("✓ Prettify with TypeScript works");
    });

    it("should require format-query flag when using prettify", async function () {
      this.timeout(TIMEOUTS.MIGRATION_MS);

      console.log("\n--- Testing prettify requires format-query ---");

      try {
        await execAsync(`"${CLI_PATH}" query -p "SELECT 1"`, {
          cwd: testProjectDir,
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        // clap should enforce this requirement
        expect(error.message).to.match(
          /requires.*format-query|required argument/i,
        );
        console.log("✓ Prettify requires format-query flag");
      }
    });
  });
});
