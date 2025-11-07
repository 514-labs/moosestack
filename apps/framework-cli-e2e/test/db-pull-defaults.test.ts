/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for db-pull with SQL function defaults (ENG-1162)
 *
 * Tests the complete workflow for both Python and TypeScript:
 * 1. Create ClickHouse table with DEFAULT expressions using SQL functions
 * 2. Run `moose db-pull` to generate language-specific code
 * 3. Verify generated code has correctly formatted defaults
 * 4. Run `moose migrate apply` to verify the roundtrip works
 * 5. Insert data and verify defaults are applied
 *
 * This test reproduces the bug where function defaults like:
 *   DEFAULT xxHash64(_id)
 * were incorrectly generated with extra quotes:
 *   - Python: clickhouse_default("\"xxHash64(_id)\"")  ❌
 *   - TypeScript: ClickHouseDefault<"\"xxHash64(_id)\"">  ❌
 * instead of:
 *   - Python: clickhouse_default("xxHash64(_id)")  ✅
 *   - TypeScript: ClickHouseDefault<"xxHash64(_id)">  ✅
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient } from "@clickhouse/client";

import { TIMEOUTS, CLICKHOUSE_CONFIG } from "./constants";
import {
  waitForServerStart,
  cleanupClickhouseData,
  createTempTestDirectory,
  cleanupTestSuite,
  getTableSchema,
  setupPythonProject,
  setupTypeScriptProject,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);
const MOOSE_TS_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const CLICKHOUSE_URL = `http://${CLICKHOUSE_CONFIG.username}:${CLICKHOUSE_CONFIG.password}@localhost:18123?database=${CLICKHOUSE_CONFIG.database}`;

describe("python template tests - db-pull with SQL function defaults", () => {
  let devProcess: ChildProcess;
  let testProjectDir: string;
  let client: ReturnType<typeof createClient>;

  const TEST_TABLE_NAME = "test_defaults_pull_py";

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    console.log("\n=== Starting Python db-pull Defaults Test ===");

    // Create temp test directory
    testProjectDir = createTempTestDirectory("py-db-pull-defaults");
    console.log("Test project dir:", testProjectDir);

    // Setup Python project with dependencies
    await setupPythonProject(
      testProjectDir,
      "python-empty",
      CLI_PATH,
      MOOSE_PY_LIB_PATH,
      "test-app",
    );

    // Start moose dev for infrastructure
    console.log("\nStarting moose dev...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: testProjectDir,
      env: {
        ...process.env,
        VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
        PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
      },
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "development server started",
      "http://localhost:4000",
    );

    console.log("✓ Infrastructure ready");

    // Clean ClickHouse and create test table
    await cleanupClickhouseData();
    client = createClient(CLICKHOUSE_CONFIG);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    console.log("\n=== Cleaning up Python db-pull Defaults Test ===");

    if (client) {
      await client.close();
    }

    await cleanupTestSuite(devProcess, testProjectDir, "py-db-pull-defaults", {
      logPrefix: "Python db-pull Defaults Test",
    });
  });

  it("should handle SQL function defaults in db-pull workflow", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS * 2);

    // ============ STEP 1: Create ClickHouse Table with Function Defaults ============
    console.log("\n--- Creating ClickHouse table with function defaults ---");

    // Drop table if it exists from previous run
    await client.command({
      query: `DROP TABLE IF EXISTS ${TEST_TABLE_NAME}`,
    });

    const createTableSQL = `
    CREATE TABLE ${TEST_TABLE_NAME} (
      _id String,
      sample_hash UInt64 DEFAULT xxHash64(_id),
      _time_observed Int64,
      hour_stamp UInt64 DEFAULT toStartOfHour(toDateTime(_time_observed / 1000)),
      created_at DateTime DEFAULT now(),
      updated_at DateTime DEFAULT today(),
      literal_default String DEFAULT 'active',
      numeric_default Int32 DEFAULT 42
    ) ENGINE = MergeTree()
    ORDER BY _id
    `;

    await client.command({ query: createTableSQL });
    console.log("✓ Test table created with function defaults");

    // Verify table exists
    const tables = await client.query({
      query: "SHOW TABLES",
      format: "JSONEachRow",
    });
    const tableList: any[] = await tables.json();
    expect(tableList.map((t) => t.name)).to.include(TEST_TABLE_NAME);

    // ============ STEP 2: Run db pull ============
    console.log("\n--- Running db pull ---");

    const { stdout: pullOutput } = await execAsync(
      `"${CLI_PATH}" db pull --connection-string "${CLICKHOUSE_URL}"`,
      {
        cwd: testProjectDir,
        env: {
          ...process.env,
          VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
          PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
        },
      },
    );

    console.log("db-pull output:", pullOutput);

    // ============ STEP 3: Verify Generated Python Code ============
    console.log("\n--- Verifying generated Python code ---");

    const externalModelsPath = path.join(
      testProjectDir,
      "app",
      "external_models.py",
    );

    expect(fs.existsSync(externalModelsPath)).to.be.true;

    const generatedCode = fs.readFileSync(externalModelsPath, "utf-8");
    console.log("Generated Python code:\n", generatedCode);

    // CRITICAL: Verify defaults are NOT double-quoted
    // Bug would generate: clickhouse_default("\"xxHash64(_id)\"")  ❌
    // Correct should be:   clickhouse_default("xxHash64(_id)")    ✅

    expect(generatedCode).to.include('clickhouse_default("xxHash64(_id)")');
    expect(generatedCode).to.not.include('clickhouse_default("\\"xxHash64');
    expect(generatedCode).to.not.include("clickhouse_default(\"'xxHash64");

    expect(generatedCode).to.include(
      'clickhouse_default("toStartOfHour(toDateTime(_time_observed / 1000))")',
    );
    expect(generatedCode).to.not.include(
      'clickhouse_default("\\"toStartOfHour',
    );

    expect(generatedCode).to.include('clickhouse_default("now()")');
    expect(generatedCode).to.include('clickhouse_default("today()")');

    // Literal values should preserve quotes
    expect(generatedCode).to.include("clickhouse_default(\"'active'\")");
    expect(generatedCode).to.include('clickhouse_default("42")');

    console.log("✓ Generated Python code has correct default syntax");

    // ============ STEP 4: Generate Migration Plan ============
    console.log("\n--- Generating migration plan ---");

    const { stdout: planOutput } = await execAsync(
      `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --redis-url "redis://127.0.0.1:6379" --save`,
      {
        cwd: testProjectDir,
        env: {
          ...process.env,
          VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
          PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
        },
      },
    );

    console.log("Migration plan output:", planOutput);

    // ============ STEP 5: Apply Migration (Roundtrip Test) ============
    console.log("\n--- Applying migration (this would fail with the bug) ---");

    // This is where the bug manifests: ALTER TABLE tries to apply
    // DEFAULT 'xxHash64(_id)' (with quotes) instead of DEFAULT xxHash64(_id)

    try {
      const { stdout: migrateOutput } = await execAsync(
        `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
        {
          cwd: testProjectDir,
          env: {
            ...process.env,
            VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
            PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
          },
        },
      );
      console.log("Migration output:", migrateOutput);
      console.log("✓ Migration applied successfully (bug is fixed!)");
    } catch (error: any) {
      console.log("Migration failed:", error.stdout || error.message);

      // Check if it's the expected bug error
      if (error.stdout && error.stdout.includes("Cannot parse string")) {
        throw new Error(
          "Migration failed with 'Cannot parse string' error - BUG NOT FIXED!\n" +
            "The default expression is being quoted as a string literal.\n" +
            error.stdout,
        );
      }
      throw error;
    }

    // ============ STEP 6: Verify Table Schema ============
    console.log("\n--- Verifying table schema after migration ---");

    const schema = await getTableSchema(TEST_TABLE_NAME);
    console.log("Table schema:", schema);

    const sampleHashCol = schema.find((col) => col.name === "sample_hash");
    expect(sampleHashCol).to.exist;
    expect(sampleHashCol!.default_kind).to.equal("DEFAULT");
    expect(sampleHashCol!.default_expression).to.equal("xxHash64(_id)");

    const hourStampCol = schema.find((col) => col.name === "hour_stamp");
    expect(hourStampCol).to.exist;
    expect(hourStampCol!.default_kind).to.equal("DEFAULT");
    expect(hourStampCol!.default_expression).to.equal(
      "toStartOfHour(toDateTime(_time_observed / 1000))",
    );

    console.log("✓ Table schema is correct after migration");

    // ============ STEP 7: Test Data Insertion with Defaults ============
    console.log("\n--- Testing data insertion with defaults ---");

    const testId = "test-row-" + Date.now();
    const testTime = Date.now();

    await client.insert({
      table: TEST_TABLE_NAME,
      values: [
        {
          _id: testId,
          _time_observed: testTime,
        },
      ],
      format: "JSONEachRow",
    });

    console.log("✓ Data inserted (only provided _id and _time_observed)");

    // Verify defaults were applied
    const result = await client.query({
      query: `SELECT * FROM ${TEST_TABLE_NAME} WHERE _id = '${testId}'`,
      format: "JSONEachRow",
    });

    const rows: any[] = await result.json();
    expect(rows.length).to.equal(1);

    const row = rows[0];
    console.log("Inserted row:", row);

    // Verify computed defaults
    expect(row.sample_hash).to.be.a("string"); // xxHash64 result
    expect(row.hour_stamp).to.be.a("string"); // toStartOfHour result
    expect(row.created_at).to.match(/^\d{4}-\d{2}-\d{2}/); // now() result
    expect(row.updated_at).to.match(/^\d{4}-\d{2}-\d{2}/); // today() result
    expect(row.literal_default).to.equal("active");
    expect(row.numeric_default).to.equal(42);

    console.log("✓ All defaults applied correctly");
    console.log("✅ ENG-1162 Python test passed - bug is fixed!");
  });

  it("should handle defaults with special characters", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    const tableName = "test_special_chars_py";

    console.log("\n--- Testing special characters in defaults ---");

    // Drop table if it exists from previous run
    await client.command({
      query: `DROP TABLE IF EXISTS ${tableName}`,
    });

    await client.command({
      query: `
      CREATE TABLE ${tableName} (
        id String,
        quoted_str String DEFAULT 'it\\'s "quoted"',
        backslash String DEFAULT 'path\\\\to\\\\file'
      ) ENGINE = MergeTree() ORDER BY id
    `,
    });

    console.log("✓ Created table with special character defaults");

    // Run db pull
    await execAsync(
      `"${CLI_PATH}" db pull --connection-string "${CLICKHOUSE_URL}"`,
      {
        cwd: testProjectDir,
        env: {
          ...process.env,
          VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
          PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
        },
      },
    );

    const code = fs.readFileSync(
      path.join(testProjectDir, "app", "external_models.py"),
      "utf-8",
    );

    console.log("Generated code (snippet):");
    const lines = code.split("\n");
    const relevantLines = lines.filter(
      (line) =>
        line.includes("quoted_str") ||
        line.includes("backslash") ||
        line.includes("test_special_chars"),
    );
    console.log(relevantLines.join("\n"));

    // Verify proper escaping - the exact format depends on how ClickHouse stores the defaults
    // Just verify it doesn't have the double-quote bug
    expect(code).to.not.include('clickhouse_default("\\"\'it');
    expect(code).to.not.include('clickhouse_default("\\"\'path');

    console.log("✓ Special characters handled correctly");
  });
});

describe("typescript template tests - db-pull with SQL function defaults", () => {
  let devProcess: ChildProcess;
  let testProjectDir: string;
  let client: ReturnType<typeof createClient>;

  const TEST_TABLE_NAME = "test_defaults_pull_ts";

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    console.log("\n=== Starting TypeScript db-pull Defaults Test ===");

    // Create temp test directory
    testProjectDir = createTempTestDirectory("ts-db-pull-defaults");
    console.log("Test project dir:", testProjectDir);

    // Setup TypeScript project with dependencies
    await setupTypeScriptProject(
      testProjectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_TS_LIB_PATH,
      "test-app",
      "npm",
    );

    // Start moose dev for infrastructure
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

    // Clean ClickHouse and create test table
    await cleanupClickhouseData();
    client = createClient(CLICKHOUSE_CONFIG);
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    console.log("\n=== Cleaning up TypeScript db-pull Defaults Test ===");

    if (client) {
      await client.close();
    }

    await cleanupTestSuite(devProcess, testProjectDir, "ts-db-pull-defaults", {
      logPrefix: "TypeScript db-pull Defaults Test",
    });
  });

  it("should handle SQL function defaults in db-pull workflow", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS * 2);

    // ============ STEP 1: Create ClickHouse Table with Function Defaults ============
    console.log("\n--- Creating ClickHouse table with function defaults ---");

    // Drop table if it exists from previous run
    await client.command({
      query: `DROP TABLE IF EXISTS ${TEST_TABLE_NAME}`,
    });

    const createTableSQL = `
      CREATE TABLE ${TEST_TABLE_NAME} (
        _id String,
        sample_hash UInt64 DEFAULT xxHash64(_id),
        _time_observed Int64,
        hour_stamp UInt64 DEFAULT toStartOfHour(toDateTime(_time_observed / 1000)),
        created_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT today(),
        literal_default String DEFAULT 'active',
        numeric_default Int32 DEFAULT 42
      ) ENGINE = MergeTree()
      ORDER BY _id
    `;

    await client.command({ query: createTableSQL });
    console.log("✓ Test table created with function defaults");

    // Verify table exists
    const tables = await client.query({
      query: "SHOW TABLES",
      format: "JSONEachRow",
    });
    const tableList: any[] = await tables.json();
    expect(tableList.map((t) => t.name)).to.include(TEST_TABLE_NAME);

    // ============ STEP 2: Run db pull ============
    console.log("\n--- Running db pull ---");

    const { stdout: pullOutput } = await execAsync(
      `"${CLI_PATH}" db pull --connection-string "${CLICKHOUSE_URL}"`,
      { cwd: testProjectDir },
    );

    console.log("db-pull output:", pullOutput);

    // ============ STEP 3: Verify Generated TypeScript Code ============
    console.log("\n--- Verifying generated TypeScript code ---");

    const externalModelsPath = path.join(
      testProjectDir,
      "src",
      "datamodels",
      "external_models.ts",
    );

    expect(fs.existsSync(externalModelsPath)).to.be.true;

    const generatedCode = fs.readFileSync(externalModelsPath, "utf-8");
    console.log("Generated TypeScript code:\n", generatedCode);

    // CRITICAL: Verify defaults are NOT double-quoted
    // Bug would generate: ClickHouseDefault<"\"xxHash64(_id)\"">  ❌
    // Correct should be:   ClickHouseDefault<"xxHash64(_id)">    ✅

    expect(generatedCode).to.include('ClickHouseDefault<"xxHash64(_id)">');
    expect(generatedCode).to.not.include('ClickHouseDefault<"\\"xxHash64');
    expect(generatedCode).to.not.include("ClickHouseDefault<\"'xxHash64");

    expect(generatedCode).to.include(
      'ClickHouseDefault<"toStartOfHour(toDateTime(_time_observed / 1000))">',
    );
    expect(generatedCode).to.not.include('ClickHouseDefault<"\\"toStartOfHour');

    expect(generatedCode).to.include('ClickHouseDefault<"now()">');
    expect(generatedCode).to.include('ClickHouseDefault<"today()">');

    // Literal values should preserve quotes
    expect(generatedCode).to.include("ClickHouseDefault<\"'active'\">");
    expect(generatedCode).to.include('ClickHouseDefault<"42">');

    console.log("✓ Generated TypeScript code has correct default syntax");

    // ============ STEP 4: Generate Migration Plan ============
    console.log("\n--- Generating migration plan ---");

    const { stdout: planOutput } = await execAsync(
      `"${CLI_PATH}" generate migration --clickhouse-url "${CLICKHOUSE_URL}" --redis-url "redis://127.0.0.1:6379" --save`,
      {
        cwd: testProjectDir,
        env: {
          ...process.env,
          VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
          PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
        },
      },
    );

    console.log("Migration plan output:", planOutput);

    // ============ STEP 5: Apply Migration (Roundtrip Test) ============
    console.log("\n--- Applying migration (this would fail with the bug) ---");

    // This is where the bug manifests: ALTER TABLE tries to apply
    // DEFAULT 'xxHash64(_id)' (with quotes) instead of DEFAULT xxHash64(_id)

    try {
      const { stdout: migrateOutput } = await execAsync(
        `"${CLI_PATH}" migrate --clickhouse-url "${CLICKHOUSE_URL}"`,
        {
          cwd: testProjectDir,
          env: {
            ...process.env,
            VIRTUAL_ENV: path.join(testProjectDir, ".venv"),
            PATH: `${path.join(testProjectDir, ".venv", "bin")}:${process.env.PATH}`,
          },
        },
      );
      console.log("Migration output:", migrateOutput);
      console.log("✓ Migration applied successfully (bug is fixed!)");
    } catch (error: any) {
      console.log("Migration failed:", error.stdout || error.message);

      // Check if it's the expected bug error
      if (error.stdout && error.stdout.includes("Cannot parse string")) {
        throw new Error(
          "Migration failed with 'Cannot parse string' error - BUG NOT FIXED!\n" +
            "The default expression is being quoted as a string literal.\n" +
            error.stdout,
        );
      }
      throw error;
    }

    // ============ STEP 6: Verify Table Schema ============
    console.log("\n--- Verifying table schema after migration ---");

    const schema = await getTableSchema(TEST_TABLE_NAME);
    console.log("Table schema:", schema);

    const sampleHashCol = schema.find((col) => col.name === "sample_hash");
    expect(sampleHashCol).to.exist;
    expect(sampleHashCol!.default_kind).to.equal("DEFAULT");
    expect(sampleHashCol!.default_expression).to.equal("xxHash64(_id)");

    const hourStampCol = schema.find((col) => col.name === "hour_stamp");
    expect(hourStampCol).to.exist;
    expect(hourStampCol!.default_kind).to.equal("DEFAULT");
    expect(hourStampCol!.default_expression).to.equal(
      "toStartOfHour(toDateTime(_time_observed / 1000))",
    );

    console.log("✓ Table schema is correct after migration");

    // ============ STEP 7: Test Data Insertion with Defaults ============
    console.log("\n--- Testing data insertion with defaults ---");

    const testId = "test-row-" + Date.now();
    const testTime = Date.now();

    await client.insert({
      table: TEST_TABLE_NAME,
      values: [
        {
          _id: testId,
          _time_observed: testTime,
        },
      ],
      format: "JSONEachRow",
    });

    console.log("✓ Data inserted (only provided _id and _time_observed)");

    // Verify defaults were applied
    const result = await client.query({
      query: `SELECT * FROM ${TEST_TABLE_NAME} WHERE _id = '${testId}'`,
      format: "JSONEachRow",
    });

    const rows: any[] = await result.json();
    expect(rows.length).to.equal(1);

    const row = rows[0];
    console.log("Inserted row:", row);

    // Verify computed defaults
    expect(row.sample_hash).to.be.a("string"); // xxHash64 result
    expect(row.hour_stamp).to.be.a("string"); // toStartOfHour result
    expect(row.created_at).to.match(/^\d{4}-\d{2}-\d{2}/); // now() result
    expect(row.updated_at).to.match(/^\d{4}-\d{2}-\d{2}/); // today() result
    expect(row.literal_default).to.equal("active");
    expect(row.numeric_default).to.equal(42);

    console.log("✓ All defaults applied correctly");
    console.log("✅ ENG-1162 TypeScript test passed - bug is fixed!");
  });

  it("should handle defaults with special characters", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);

    const tableName = "test_special_chars_ts";

    console.log("\n--- Testing special characters in defaults ---");

    // Drop table if it exists from previous run
    await client.command({
      query: `DROP TABLE IF EXISTS ${tableName}`,
    });

    await client.command({
      query: `
        CREATE TABLE ${tableName} (
          id String,
          quoted_str String DEFAULT 'it\\'s "quoted"',
          backslash String DEFAULT 'path\\\\to\\\\file'
        ) ENGINE = MergeTree() ORDER BY id
      `,
    });

    console.log("✓ Created table with special character defaults");

    // Run db pull
    await execAsync(
      `"${CLI_PATH}" db pull --connection-string "${CLICKHOUSE_URL}"`,
      { cwd: testProjectDir },
    );

    const code = fs.readFileSync(
      path.join(testProjectDir, "src", "datamodels", "external_models.ts"),
      "utf-8",
    );

    console.log("Generated code (snippet):");
    const lines = code.split("\n");
    const relevantLines = lines.filter(
      (line) =>
        line.includes("quoted_str") ||
        line.includes("backslash") ||
        line.includes("test_special_chars_ts"),
    );
    console.log(relevantLines.join("\n"));

    // Verify proper escaping - the exact format depends on how ClickHouse stores the defaults
    // Just verify it doesn't have the double-quote bug
    expect(code).to.not.include('ClickHouseDefault<"\\"\'it');
    expect(code).to.not.include('ClickHouseDefault<"\\"\'path');

    console.log("✓ Special characters handled correctly");
  });
});
