/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for moose migrate command
 *
 * These tests verify the serverless/OLAP-only migration flow:
 * 1. Fresh ClickHouse database (no moose dev involved)
 * 2. Generate migration plan
 * 3. Apply migration with moose migrate
 * 4. Verify tables are created correctly
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

// Import constants and utilities
import { TIMEOUTS } from "./constants";

import {
  spawnClickHouseForMigrationTest,
  stopClickHouseContainer,
  queryClickHouseInstance,
  execClickHouseCommand,
  ClickHouseTestInstance,
  removeTestProject,
  createTempTestDirectory,
  setupTypeScriptProject,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const TEMPLATE_NAME = "typescript-migrate-test";
const APP_NAME = "moose-migrate-test-app";

describe("typescript template tests - migration", () => {
  describe("First-time migration (Happy Path)", () => {
    let clickhouse: ClickHouseTestInstance;
    let projectDir: string;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      console.log("\n=== Setting up Happy Path Migration Test ===");

      // 1. Spin up fresh ClickHouse container
      clickhouse = await spawnClickHouseForMigrationTest("happy");

      // 2. Setup TypeScript project from template
      projectDir = createTempTestDirectory("migrate-happy");
      await setupTypeScriptProject(
        projectDir,
        TEMPLATE_NAME,
        CLI_PATH,
        MOOSE_LIB_PATH,
        APP_NAME,
        "npm",
      );

      // 3. Update moose.config.toml with the test ClickHouse settings
      console.log(
        "Updating moose.config.toml with test ClickHouse settings...",
      );
      const configPath = path.join(projectDir, "moose.config.toml");
      let config = await fs.promises.readFile(configPath, "utf-8");
      // Update ClickHouse config with test database settings
      config = config.replace(
        /db_name = "[^"]*"/,
        `db_name = "${clickhouse.dbName}"`,
      );
      config = config.replace(
        /host_port = \d+/,
        `host_port = ${clickhouse.port}`,
      );
      config = config.replace(/user = "[^"]*"/, `user = "${clickhouse.user}"`);
      config = config.replace(
        /password = "[^"]*"/,
        `password = "${clickhouse.password}"`,
      );
      await fs.promises.writeFile(configPath, config);

      console.log("✓ Test setup complete");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      console.log("\n=== Cleaning up Happy Path Test ===");
      await stopClickHouseContainer(clickhouse.containerName);
      removeTestProject(projectDir);
    });

    it("should generate migration plan from empty database", async function () {
      this.timeout(60000);

      console.log("\n--- Testing: Generate Migration Plan ---");

      // Build the project first so TypeScript code is compiled
      console.log("Building project...");
      await execAsync(`"${CLI_PATH}" build`, { cwd: projectDir });
      console.log("✓ Project built");

      // Run: moose generate migration --clickhouse-url <url> --save
      const { stdout, stderr } = await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${clickhouse.url}" --save`,
        { cwd: projectDir },
      );

      console.log("Generate migration output:", stdout);
      if (stderr) console.log("Generate migration stderr:", stderr);

      // Verify migration files were created
      const planFile = path.join(projectDir, "migrations/plan.yaml");
      const remoteStateFile = path.join(
        projectDir,
        "migrations/remote_state.json",
      );
      const localStateFile = path.join(
        projectDir,
        "migrations/local_infra_map.json",
      );

      expect(fs.existsSync(planFile), "plan.yaml should exist").to.be.true;
      expect(fs.existsSync(remoteStateFile), "remote_state.json should exist")
        .to.be.true;
      expect(fs.existsSync(localStateFile), "local_infra_map.json should exist")
        .to.be.true;

      // Verify plan contains expected operations
      const planContent = await fs.promises.readFile(planFile, "utf-8");
      console.log("Generated plan:\n", planContent);

      expect(planContent).to.include("CreateTable");
      // Should create tables for Foo, Bar, FooDeadLetter, and BarAggregated
      expect(planContent).to.match(/Foo|Bar/);

      console.log("✓ Migration plan generated successfully");
    });

    it("should apply migration plan and create tables", async function () {
      this.timeout(30000);

      console.log("\n--- Testing: Apply Migration Plan ---");

      // Run: moose migrate --clickhouse-url <url>
      const { stdout, stderr } = await execAsync(
        `"${CLI_PATH}" migrate --clickhouse-url "${clickhouse.url}"`,
        { cwd: projectDir },
      );

      console.log("Migrate output:", stdout);
      if (stderr) console.log("Migrate stderr:", stderr);

      // Verify tables were created in ClickHouse
      const tables = await queryClickHouseInstance(clickhouse, "SHOW TABLES");
      console.log(
        "Tables after migration:",
        tables.map((t) => t.name),
      );

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).to.include("Foo");
      expect(tableNames).to.include("Bar");
      expect(tableNames).to.include("FooDeadLetter");
      expect(tableNames).to.include("BarAggregated");

      // Verify Foo table schema
      const fooSchema = await queryClickHouseInstance(
        clickhouse,
        "DESCRIBE TABLE Foo",
      );
      console.log("Foo schema:", fooSchema);

      const fooColumns = fooSchema.map((col: any) => col.name);
      expect(fooColumns).to.include("primaryKey");
      expect(fooColumns).to.include("timestamp");
      expect(fooColumns).to.include("optionalText");

      // Verify Bar table schema
      const barSchema = await queryClickHouseInstance(
        clickhouse,
        "DESCRIBE TABLE Bar",
      );
      console.log("Bar schema:", barSchema);

      const barColumns = barSchema.map((col: any) => col.name);
      expect(barColumns).to.include("primaryKey");
      expect(barColumns).to.include("utcTimestamp");
      expect(barColumns).to.include("hasText");
      expect(barColumns).to.include("textLength");

      // Verify _MOOSE_STATE table exists and has data
      const stateTables = await queryClickHouseInstance(
        clickhouse,
        "SHOW TABLES",
      );
      expect(stateTables.map((t) => t.name)).to.include("_MOOSE_STATE");

      const stateData = await queryClickHouseInstance(
        clickhouse,
        "SELECT * FROM _MOOSE_STATE WHERE key = 'infrastructure_map'",
      );
      expect(stateData).to.have.length(1);
      console.log("✓ State saved to _MOOSE_STATE");

      console.log("✓ Migration applied successfully");
    });
  });

  describe("Drift detection (Error Case)", () => {
    let clickhouse: ClickHouseTestInstance;
    let projectDir: string;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      console.log("\n=== Setting up Drift Detection Test ===");

      // 1. Spin up fresh ClickHouse container
      clickhouse = await spawnClickHouseForMigrationTest("drift");

      // 2. Setup TypeScript project
      projectDir = createTempTestDirectory("migrate-drift");
      await setupTypeScriptProject(
        projectDir,
        TEMPLATE_NAME,
        CLI_PATH,
        MOOSE_LIB_PATH,
        APP_NAME,
        "npm",
      );

      // 3. Update moose.config.toml
      console.log(
        "Updating moose.config.toml with test ClickHouse settings...",
      );
      const configPath = path.join(projectDir, "moose.config.toml");
      let config = await fs.promises.readFile(configPath, "utf-8");
      // Update ClickHouse config with test database settings
      config = config.replace(
        /db_name = "[^"]*"/,
        `db_name = "${clickhouse.dbName}"`,
      );
      config = config.replace(
        /host_port = \d+/,
        `host_port = ${clickhouse.port}`,
      );
      config = config.replace(/user = "[^"]*"/, `user = "${clickhouse.user}"`);
      config = config.replace(
        /password = "[^"]*"/,
        `password = "${clickhouse.password}"`,
      );
      await fs.promises.writeFile(configPath, config);

      // 4. Build the project first
      console.log("Building project...");
      await execAsync(`"${CLI_PATH}" build`, { cwd: projectDir });

      // 5. Apply initial migration (so Moose is managing tables)
      console.log("Generating and applying initial migration...");
      await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${clickhouse.url}" --save`,
        { cwd: projectDir },
      );
      await execAsync(
        `"${CLI_PATH}" migrate --clickhouse-url "${clickhouse.url}"`,
        { cwd: projectDir },
      );
      console.log("✓ Initial migration applied (Moose now managing tables)");

      // 6. Verify tables were created
      const tables = await queryClickHouseInstance(clickhouse, "SHOW TABLES");
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).to.include("Foo");
      expect(tableNames).to.include("Bar");
      console.log("✓ Tables created:", tableNames);

      // 7. Manually modify Foo table (add unexpected column)
      console.log("Manually adding column to Foo (first modification)...");
      await execClickHouseCommand(
        clickhouse,
        `ALTER TABLE Foo ADD COLUMN unexpected_column String`,
      );

      // 8. Generate a new migration plan that captures this state
      console.log("Generating migration plan (captures unexpected_column)...");
      await execAsync(
        `"${CLI_PATH}" generate migration --clickhouse-url "${clickhouse.url}" --save`,
        { cwd: projectDir },
      );

      // 9. Manually modify Foo table AGAIN (different change, making plan stale)
      console.log(
        "Manually adding another column to Foo (second modification)...",
      );
      await execClickHouseCommand(
        clickhouse,
        `ALTER TABLE Foo ADD COLUMN another_unexpected_column Int64`,
      );

      // Now: migration plan expects Foo with unexpected_column
      // But actual DB has Foo with unexpected_column AND another_unexpected_column
      // This is drift!

      console.log("✓ Drift scenario setup complete");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      console.log("\n=== Cleaning up Drift Detection Test ===");
      await stopClickHouseContainer(clickhouse.containerName);
      removeTestProject(projectDir);
    });

    it("should detect drift and fail migration", async function () {
      this.timeout(30000);

      console.log("\n--- Testing: Drift Detection ---");

      // Run: moose migrate --clickhouse-url <url>
      // Should fail because actual Foo has another_unexpected_column
      // but the plan's snapshot doesn't expect it
      let didFail = false;
      let errorOutput = "";

      try {
        await execAsync(
          `"${CLI_PATH}" migrate --clickhouse-url "${clickhouse.url}"`,
          { cwd: projectDir },
        );
      } catch (error: any) {
        didFail = true;
        errorOutput = error.stdout || error.stderr || error.message || "";
        console.log("Migration failed as expected");
        console.log("Error stdout:", error.stdout || "(empty)");
        console.log("Error stderr:", error.stderr || "(empty)");
        console.log("Error message:", error.message || "(empty)");
      }

      expect(didFail, "Migration should have failed due to drift").to.be.true;

      // Verify error message mentions drift/schema changes/database state
      const lowerOutput = errorOutput.toLowerCase();
      const hasDriftMessage =
        lowerOutput.includes("schema changes") ||
        lowerOutput.includes("drift") ||
        lowerOutput.includes("changed") ||
        lowerOutput.includes("database state") ||
        lowerOutput.includes("tables with");

      if (!hasDriftMessage) {
        console.log("Full error output for debugging:", errorOutput);
      }

      expect(hasDriftMessage, "Error should mention drift or schema changes").to
        .be.true;
      expect(errorOutput).to.include("Foo");

      // Verify database still has both unexpected columns (migration didn't run)
      const schema = await queryClickHouseInstance(
        clickhouse,
        "DESCRIBE TABLE Foo",
      );
      const columnNames = schema.map((col: any) => col.name);
      expect(columnNames).to.include("unexpected_column");
      expect(columnNames).to.include("another_unexpected_column");

      console.log("✓ Drift detected and migration failed as expected");
    });
  });
});
