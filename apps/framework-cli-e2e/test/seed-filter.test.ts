/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for the seedFilter feature on OlapTable.
 *
 * Uses play.clickhouse.com (git_clickhouse database) as a real remote source
 * to verify:
 *   1. seedFilter.limit restricts seeded rows
 *   2. seedFilter.where filters seeded rows
 *   3. --limit CLI flag overrides seedFilter.limit
 *   4. --all bypasses both seedFilter.limit and CLI --limit
 */

import { exec, spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import { createClient } from "@clickhouse/client";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { TIMEOUTS, CLICKHOUSE_CONFIG } from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  cleanupTestSuite,
  logger,
} from "./utils";

const execAsync = promisify(exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_TS_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const REMOTE_CLICKHOUSE_URL =
  "clickhouse://explorer:@play.clickhouse.com:9440/git_clickhouse";
const REMOTE_HTTPS_URL =
  "https://explorer:@play.clickhouse.com:443/?database=git_clickhouse";

const SEED_WHERE = "author = 'Alexey Milovidov' AND files_added > 10";
const SEED_LIMIT = 10;

const testLogger = logger.scope("seed-filter-test");

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

describe("moose seed clickhouse with seedFilter", function () {
  let devProcess: ChildProcess | null = null;
  let testProjectDir: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);
    testLogger.info("\n=== Starting Seed Filter Test ===");

    testProjectDir = createTempTestDirectory("seed-filter-test");
    testLogger.info("Test project dir:", testProjectDir);

    // 1. Init project from play.clickhouse.com (git_clickhouse database — only 3 tables)
    testLogger.info("Initializing project from play.clickhouse.com...");
    const initResult = await execAsync(
      `"${CLI_PATH}" init test-seed-filter --from-remote "${REMOTE_HTTPS_URL}" --language typescript --location "${testProjectDir}"`,
    );
    testLogger.debug("Init output:", initResult.stdout);

    // 2. Point at local moose-lib
    const packageJsonPath = path.join(testProjectDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    packageJson.dependencies["@514labs/moose-lib"] =
      `file:${MOOSE_TS_LIB_PATH}`;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // 3. Add seedFilter to the commits table definition
    const indexPath = path.join(testProjectDir, "app", "index.ts");
    let indexContent = fs.readFileSync(indexPath, "utf-8");

    // The generated OlapTable for commits will look like:
    //   export const commitsTable = new OlapTable<Commits>("commits", { ... });
    // We need to inject seedFilter into the config object.
    const commitsTableRegex = /(new OlapTable<Commits>\("commits",\s*\{)/;
    if (commitsTableRegex.test(indexContent)) {
      indexContent = indexContent.replace(
        commitsTableRegex,
        `$1\n  seedFilter: { limit: ${SEED_LIMIT}, where: "${SEED_WHERE}" },`,
      );
    } else {
      // Fallback: try matching without generic parameter
      const altRegex = /(new OlapTable\s*<[^>]*>\s*\(\s*"commits"\s*,\s*\{)/;
      if (altRegex.test(indexContent)) {
        indexContent = indexContent.replace(
          altRegex,
          `$1\n  seedFilter: { limit: ${SEED_LIMIT}, where: "${SEED_WHERE}" },`,
        );
      } else {
        testLogger.error(
          "Could not find commits OlapTable in generated code. File content:",
          indexContent.slice(0, 2000),
        );
        throw new Error(
          "Failed to inject seedFilter into commits table definition",
        );
      }
    }

    fs.writeFileSync(indexPath, indexContent);
    testLogger.info("Injected seedFilter into commits table");

    // 4. Install dependencies
    testLogger.info("Installing dependencies...");
    await new Promise<void>((resolve, reject) => {
      const installCmd = spawn("npm", ["install"], {
        stdio: "inherit",
        cwd: testProjectDir,
      });
      installCmd.on("error", reject);
      installCmd.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install failed with code ${code}`));
      });
    });

    // 5. Start moose dev
    testLogger.info("Starting moose dev...");
    devProcess = spawn(CLI_PATH, ["dev"], {
      stdio: "pipe",
      cwd: testProjectDir,
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
      },
    });
    devProcess.on("error", (err) => {
      testLogger.error("moose dev spawn error:", err);
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      "development server started",
      "http://localhost:4000",
    );

    testLogger.info("Infrastructure ready");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("\n=== Cleaning up Seed Filter Test ===");
    await cleanupTestSuite(devProcess, testProjectDir, "test-seed-filter", {
      logPrefix: "Seed Filter Test",
    });
  });

  it("should seed only seedFilter.limit rows with WHERE clause applied", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with seedFilter defaults ---");

    await truncateTable("commits");

    await execAsync(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${REMOTE_CLICKHOUSE_URL}" --table commits`,
      { cwd: testProjectDir },
    );

    const count = await localRowCount("commits");
    testLogger.info(`Seeded ${count} rows (expected ${SEED_LIMIT})`);
    expect(count).to.equal(SEED_LIMIT);

    const violations = await localWhereViolationCount("commits", SEED_WHERE);
    testLogger.info(`WHERE violations: ${violations} (expected 0)`);
    expect(violations).to.equal(0);
  });

  it("should respect --limit CLI flag over seedFilter.limit", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with --limit 5 ---");

    await truncateTable("commits");

    await execAsync(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${REMOTE_CLICKHOUSE_URL}" --table commits --limit 5`,
      { cwd: testProjectDir },
    );

    const count = await localRowCount("commits");
    testLogger.info(`Seeded ${count} rows (expected 5)`);
    expect(count).to.equal(5);
    const violations = await localWhereViolationCount("commits", SEED_WHERE);
    expect(violations).to.equal(0);
  });

  it("should bypass seedFilter.limit when --all is set", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with --all ---");

    await truncateTable("commits");

    await execAsync(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${REMOTE_CLICKHOUSE_URL}" --table commits --all`,
      { cwd: testProjectDir },
    );

    const count = await localRowCount("commits");
    testLogger.info(`Seeded ${count} rows (expected > ${SEED_LIMIT})`);
    // WHERE author='Alexey Milovidov' AND files_added > 10 → ~41 rows
    expect(count).to.be.within(SEED_LIMIT + 1, 200);
  });
});
