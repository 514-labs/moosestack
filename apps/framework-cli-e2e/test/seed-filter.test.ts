/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for the seedFilter feature on OlapTable.
 *
 * Uses the local native ClickHouse as both source and destination
 * to verify:
 *   1. seedFilter.limit restricts seeded rows
 *   2. seedFilter.where filters seeded rows
 *   3. --limit CLI flag overrides seedFilter.limit
 *   4. --all bypasses both seedFilter.limit and CLI --limit
 *
 * A separate "seed_source" database is created in the same ClickHouse
 * instance and populated with test data. The seed command uses
 * `remote()` (non-TLS) to copy data between databases.
 */

import { exec, spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import { createClient } from "@clickhouse/client";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { TIMEOUTS, CLICKHOUSE_CONFIG, SERVER_CONFIG } from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  cleanupTestSuite,
  setupTypeScriptProject,
  logger,
} from "./utils";

const execAsync = promisify(exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_TS_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

/** The "remote" ClickHouse URL the seed command connects to — same instance, different database. */
const SEED_SOURCE_DB = "seed_source";
const SEED_SOURCE_TABLE = "items";
const SEED_SOURCE_URL = `clickhouse://panda:pandapass@127.0.0.1:9000/${SEED_SOURCE_DB}`;

const SEED_WHERE = "value > 20";
const SEED_LIMIT = 10;
/** Total source rows that match the WHERE clause (value 21-49 = 29 per cycle * 2 cycles). */
const MATCHING_ROWS = 58;
const TOTAL_SOURCE_ROWS = 100;

const testLogger = logger.scope("seed-filter-test");

/**
 * OlapTable definition written into the project after init.
 * The table schema matches the source data exactly.
 */
const TABLE_MODEL_SOURCE = `
import { OlapTable } from "@514labs/moose-lib";

export interface Items {
  id: number;
  name: string;
  value: number;
}

export const itemsTable = new OlapTable<Items>("${SEED_SOURCE_TABLE}", {
  orderByFields: ["id"],
  seedFilter: { limit: ${SEED_LIMIT}, where: "${SEED_WHERE}" },
});
`;

/**
 * Run a seed command with retries. Replicas may briefly be readonly after
 * server start (embedded Keeper), so we retry on ClickHouse readonly errors.
 */
async function seedWithRetry(
  cmd: string,
  cwd: string,
  retries = 10,
  delayMs = 3000,
): Promise<{ stdout: string; stderr: string }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await execAsync(cmd, { cwd });

      const stdout = (result.stdout || "").toString();
      const stderr = (result.stderr || "").toString();
      testLogger.debug(
        `Seed attempt ${attempt} output:\n  stdout: ${stdout.slice(0, 1000)}\n  stderr: ${stderr.slice(0, 500)}`,
      );

      const hasSeedFailure =
        stdout.includes("failed to copy") || stdout.includes("\u2717");
      if (hasSeedFailure && attempt < retries) {
        testLogger.warn(
          `Seed attempt ${attempt}/${retries} exited 0 but output indicates failure, retrying in ${delayMs}ms:\n  ${stdout.slice(0, 500)}`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      if (hasSeedFailure) {
        throw new Error(
          `Seed command reported failure after ${attempt} attempt(s):\n${stdout}`,
        );
      }

      return result;
    } catch (err: any) {
      if (
        err.message &&
        err.message.startsWith("Seed command reported failure")
      ) {
        throw err;
      }

      const allOutput = [err.stdout || "", err.stderr || "", err.message || ""]
        .map((s: string) => s.toString())
        .join("\n");

      testLogger.warn(
        `Seed attempt ${attempt}/${retries} failed (exit code ${err.code ?? "?"}):\n` +
          `  stdout: ${(err.stdout || "").toString().slice(0, 500)}\n` +
          `  stderr: ${(err.stderr || "").toString().slice(0, 500)}\n` +
          `  message: ${(err.message || "").toString().slice(0, 500)}`,
      );

      const isRetryable =
        allOutput.includes("readonly") ||
        allOutput.includes("TABLE_IS_READ_ONLY") ||
        allOutput.includes("READONLY") ||
        allOutput.includes("failed to copy") ||
        allOutput.includes("Connection refused") ||
        allOutput.includes("NETWORK_ERROR");
      if (isRetryable && attempt < retries) {
        testLogger.debug(
          `Seed attempt ${attempt}/${retries} hit retryable error, retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new Error(
        `Seed command failed after ${attempt} attempt(s):\n${allOutput}`,
      );
    }
  }
  throw new Error("seedWithRetry: unreachable");
}

async function localRowCount(tableName: string): Promise<number> {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    const result = await client.query({
      query: `SELECT count() as cnt FROM ${tableName}`,
      format: "JSONEachRow",
    });
    const rows: any[] = await result.json();
    return parseInt(rows[0].cnt, 10);
  } finally {
    await client.close();
  }
}

async function localWhereViolationCount(
  tableName: string,
  predicate: string,
): Promise<number> {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    const result = await client.query({
      query: `SELECT count() as cnt FROM ${tableName} WHERE NOT (${predicate})`,
      format: "JSONEachRow",
    });
    const rows: any[] = await result.json();
    return parseInt(rows[0].cnt, 10);
  } finally {
    await client.close();
  }
}

async function truncateTable(tableName: string): Promise<void> {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${tableName}` });
  } finally {
    await client.close();
  }
}

/**
 * Create the seed_source database and populate it with test data.
 * Schema matches the OlapTable definition exactly (id Int64, name String, value Int64).
 */
async function createSourceData(): Promise<void> {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${SEED_SOURCE_DB}`,
    });
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${SEED_SOURCE_DB}.${SEED_SOURCE_TABLE} (
          id Int64,
          name String,
          value Int64
        ) ENGINE = MergeTree() ORDER BY id
      `,
    });
    await client.command({
      query: `TRUNCATE TABLE ${SEED_SOURCE_DB}.${SEED_SOURCE_TABLE}`,
    });
    await client.command({
      query: `
        INSERT INTO ${SEED_SOURCE_DB}.${SEED_SOURCE_TABLE}
        SELECT
          number AS id,
          concat('name_', toString(number)) AS name,
          number % 50 AS value
        FROM numbers(${TOTAL_SOURCE_ROWS})
      `,
    });

    // Verify source data
    const result = await client.query({
      query: `SELECT count() as cnt FROM ${SEED_SOURCE_DB}.${SEED_SOURCE_TABLE} WHERE ${SEED_WHERE}`,
      format: "JSONEachRow",
    });
    const rows: any[] = await result.json();
    const matchCount = parseInt(rows[0].cnt, 10);
    testLogger.info(
      `Source data created: ${TOTAL_SOURCE_ROWS} total rows, ${matchCount} matching WHERE clause`,
    );
    if (matchCount !== MATCHING_ROWS) {
      throw new Error(
        `Expected ${MATCHING_ROWS} matching rows but got ${matchCount}`,
      );
    }
  } finally {
    await client.close();
  }
}

describe("moose seed clickhouse with seedFilter", function () {
  let devProcess: ChildProcess | null = null;
  let testProjectDir: string;

  before(async function () {
    this.timeout(900_000);
    testLogger.info("\n=== Starting Seed Filter Test ===");

    testProjectDir = createTempTestDirectory("seed-filter-test");
    testLogger.info("Test project dir:", testProjectDir);

    // 1. Init a plain TypeScript project (no --from-remote)
    testLogger.info("Setting up TypeScript project...");
    await setupTypeScriptProject(
      testProjectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_TS_LIB_PATH,
      "test-seed-filter",
      "npm",
      { logger: testLogger },
    );

    // 2. Write our OlapTable definition
    testLogger.info("Writing OlapTable definition with seedFilter...");
    const indexPath = path.join(testProjectDir, "app", "index.ts");
    fs.writeFileSync(indexPath, TABLE_MODEL_SOURCE);
    testLogger.info("Wrote table model to", indexPath);

    // 3. Start moose dev --dockerless
    testLogger.info("Starting moose dev --dockerless...");
    devProcess = spawn(CLI_PATH, ["dev", "--dockerless"], {
      stdio: "pipe",
      cwd: testProjectDir,
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
        MOOSE_REDPANDA_CONFIG__BROKER: "127.0.0.1:19092",
        MOOSE_ACCEPT_DESTRUCTIVE: "1",
        MOOSE_FEATURES__STREAMING_ENGINE: "false",
        MOOSE_FEATURES__WORKFLOWS: "false",
        MOOSE_TELEMETRY__ENABLED: "false",
        RUST_LOG: "info",
      },
    });
    devProcess.on("error", (err) => {
      testLogger.error("moose dev spawn error:", err);
    });

    const allStdout: string[] = [];
    const allStderr: string[] = [];
    devProcess.stdout?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      allStdout.push(line);
      testLogger.debug("stdout:", line);
    });
    devProcess.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      allStderr.push(line);
      testLogger.debug("stderr:", line);
    });

    try {
      await waitForServerStart(
        devProcess,
        600_000,
        SERVER_CONFIG.startupMessage,
        SERVER_CONFIG.url,
        { logger: testLogger },
      );
    } catch (e: any) {
      const lastStdout = allStdout.slice(-30).join("\n");
      const lastStderr = allStderr.slice(-30).join("\n");
      throw new Error(
        `${e.message}\n\n` +
          `--- Last stdout (${allStdout.length} chunks) ---\n${lastStdout}\n\n` +
          `--- Last stderr (${allStderr.length} chunks) ---\n${lastStderr}`,
      );
    }

    // 4. Verify the items table was created
    testLogger.info("Verifying items table exists in ClickHouse...");
    const client = createClient(CLICKHOUSE_CONFIG);
    try {
      const result = await client.query({
        query: `SELECT name, engine FROM system.tables WHERE database = 'local' AND name = '${SEED_SOURCE_TABLE}'`,
        format: "JSONEachRow",
      });
      const tables: any[] = await result.json();
      if (tables.length === 0) {
        const allResult = await client.query({
          query: `SELECT database, name, engine FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`,
          format: "JSONEachRow",
        });
        const allTables: any[] = await allResult.json();
        throw new Error(
          `${SEED_SOURCE_TABLE} table not found in local database. Available tables: ${JSON.stringify(allTables)}`,
        );
      }
      testLogger.info(
        `${SEED_SOURCE_TABLE} table verified: engine=${tables[0].engine}`,
      );
    } finally {
      await client.close();
    }

    // 5. Create source database and populate with test data
    testLogger.info("Creating source data in seed_source database...");
    await createSourceData();

    testLogger.info("Infrastructure ready");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("\n=== Cleaning up Seed Filter Test ===");

    // Clean up source database
    try {
      const client = createClient(CLICKHOUSE_CONFIG);
      await client.command({
        query: `DROP DATABASE IF EXISTS ${SEED_SOURCE_DB}`,
      });
      await client.close();
    } catch {
      // Best effort cleanup
    }

    await cleanupTestSuite(devProcess, testProjectDir, "test-seed-filter", {
      logPrefix: "Seed Filter Test",
      includeDocker: false,
    });
  });

  it("should seed only seedFilter.limit rows with WHERE clause applied", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with seedFilter defaults ---");

    await truncateTable(SEED_SOURCE_TABLE);

    await seedWithRetry(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${SEED_SOURCE_URL}" --table ${SEED_SOURCE_TABLE}`,
      testProjectDir,
    );

    const count = await localRowCount(SEED_SOURCE_TABLE);
    testLogger.info(`Seeded ${count} rows (expected ${SEED_LIMIT})`);
    expect(count).to.equal(SEED_LIMIT);

    const violations = await localWhereViolationCount(
      SEED_SOURCE_TABLE,
      SEED_WHERE,
    );
    testLogger.info(`WHERE violations: ${violations} (expected 0)`);
    expect(violations).to.equal(0);
  });

  it("should respect --limit CLI flag over seedFilter.limit", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with --limit 5 ---");

    await truncateTable(SEED_SOURCE_TABLE);

    await seedWithRetry(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${SEED_SOURCE_URL}" --table ${SEED_SOURCE_TABLE} --limit 5`,
      testProjectDir,
    );

    const count = await localRowCount(SEED_SOURCE_TABLE);
    testLogger.info(`Seeded ${count} rows (expected 5)`);
    expect(count).to.equal(5);
    const violations = await localWhereViolationCount(
      SEED_SOURCE_TABLE,
      SEED_WHERE,
    );
    expect(violations).to.equal(0);
  });

  it("should bypass seedFilter.limit when --all is set", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with --all ---");

    await truncateTable(SEED_SOURCE_TABLE);

    await seedWithRetry(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${SEED_SOURCE_URL}" --table ${SEED_SOURCE_TABLE} --all`,
      testProjectDir,
    );

    const count = await localRowCount(SEED_SOURCE_TABLE);
    testLogger.info(
      `Seeded ${count} rows (expected ${MATCHING_ROWS}, all matching WHERE)`,
    );
    // --all bypasses limit but WHERE clause still applies
    expect(count).to.equal(MATCHING_ROWS);
  });
});
