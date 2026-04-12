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

import { TIMEOUTS, CLICKHOUSE_CONFIG, SERVER_CONFIG } from "./constants";
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

/**
 * Run a seed command with retries.  Replicas may briefly be readonly after
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
      return await execAsync(cmd, { cwd });
    } catch (err: any) {
      const msg = (err.stderr || err.message || "").toString();
      const isReadonly =
        msg.includes("readonly") ||
        msg.includes("TABLE_IS_READ_ONLY") ||
        msg.includes("READONLY");
      if (isReadonly && attempt < retries) {
        testLogger.debug(
          `Seed attempt ${attempt}/${retries} hit readonly replica, retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
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

describe("moose seed clickhouse with seedFilter", function () {
  let devProcess: ChildProcess | null = null;
  let testProjectDir: string;

  before(async function () {
    // Budget: init from remote (~30s) + npm install (~60s) + server start (up to 600s).
    // The server start budget is 600s to allow for ClickHouse binary download
    // (~1.5 GB) on CI cache miss plus TS compilation + table creation.
    this.timeout(900_000);
    testLogger.info("\n=== Starting Seed Filter Test ===");

    testProjectDir = createTempTestDirectory("seed-filter-test");
    testLogger.info("Test project dir:", testProjectDir);

    // 1. Init project from play.clickhouse.com (git_clickhouse database — only 3 tables)
    testLogger.info("Initializing project from play.clickhouse.com...");
    const initResult = await execAsync(
      `"${CLI_PATH}" init test-seed-filter typescript-empty --from-remote "${REMOTE_HTTPS_URL}" --location "${testProjectDir}"`,
    );
    testLogger.debug("Init output:", initResult.stdout);
    if (initResult.stderr) {
      testLogger.warn("Init stderr:", initResult.stderr);
    }

    // Verify generated files exist
    const configPath = path.join(testProjectDir, "moose.config.toml");
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `moose.config.toml not found after init. Dir contents: ${fs.readdirSync(testProjectDir).join(", ")}`,
      );
    }
    testLogger.info("moose.config.toml exists");

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
    testLogger.info(
      "Generated index.ts (first 1000 chars):",
      indexContent.slice(0, 1000),
    );

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

    // Verify moose-tspc is available after install
    const tspcPath = path.join(
      testProjectDir,
      "node_modules",
      ".bin",
      "moose-tspc",
    );
    if (!fs.existsSync(tspcPath)) {
      const binDir = path.join(testProjectDir, "node_modules", ".bin");
      const binContents =
        fs.existsSync(binDir) ?
          fs.readdirSync(binDir).join(", ")
        : "(dir missing)";
      throw new Error(
        `moose-tspc not found at ${tspcPath}. .bin contents: ${binContents}`,
      );
    }
    testLogger.info("moose-tspc binary verified");

    // 5. Start moose dev
    testLogger.info("Starting moose dev...");
    devProcess = spawn(CLI_PATH, ["dev", "--dockerless"], {
      stdio: "pipe",
      cwd: testProjectDir,
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
        MOOSE_REDPANDA_CONFIG__BROKER: "127.0.0.1:19092",
        MOOSE_ACCEPT_DESTRUCTIVE: "1",
        // Explicitly disable streaming and workflows via env vars.
        // db_to_dmv2 already writes these to moose.config.toml, but env var
        // overrides are more reliable and match how alpha-mode.test.ts works.
        MOOSE_FEATURES__STREAMING_ENGINE: "false",
        MOOSE_FEATURES__WORKFLOWS: "false",
        MOOSE_TELEMETRY__ENABLED: "false",
        RUST_LOG: "info",
      },
    });
    devProcess.on("error", (err) => {
      testLogger.error("moose dev spawn error:", err);
    });

    // Capture output so we can include it in failure messages for CI.
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

    // Use 600s (not the default 300s) because dockerless mode downloads
    // the ClickHouse binary (~1.5 GB) on first run, which can take 200s+
    // on CI even with the GitHub Actions cache step.
    try {
      await waitForServerStart(
        devProcess,
        600_000,
        SERVER_CONFIG.startupMessage,
        SERVER_CONFIG.url,
        { logger: testLogger },
      );
    } catch (e: any) {
      // Re-throw with captured output so CI test reports show the real error.
      const lastStdout = allStdout.slice(-30).join("\n");
      const lastStderr = allStderr.slice(-30).join("\n");
      throw new Error(
        `${e.message}\n\n` +
          `--- Last stdout (${allStdout.length} chunks) ---\n${lastStdout}\n\n` +
          `--- Last stderr (${allStderr.length} chunks) ---\n${lastStderr}`,
      );
    }

    testLogger.info("Infrastructure ready");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("\n=== Cleaning up Seed Filter Test ===");
    await cleanupTestSuite(devProcess, testProjectDir, "test-seed-filter", {
      logPrefix: "Seed Filter Test",
      includeDocker: false,
    });
  });

  it("should seed only seedFilter.limit rows with WHERE clause applied", async function () {
    this.timeout(TIMEOUTS.MIGRATION_MS);
    testLogger.info("\n--- Seed with seedFilter defaults ---");

    await truncateTable("commits");

    await seedWithRetry(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${REMOTE_CLICKHOUSE_URL}" --table commits`,
      testProjectDir,
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

    await seedWithRetry(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${REMOTE_CLICKHOUSE_URL}" --table commits --limit 5`,
      testProjectDir,
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

    await seedWithRetry(
      `"${CLI_PATH}" seed clickhouse --clickhouse-url "${REMOTE_CLICKHOUSE_URL}" --table commits --all`,
      testProjectDir,
    );

    const count = await localRowCount("commits");
    testLogger.info(`Seeded ${count} rows (expected > ${SEED_LIMIT})`);
    // WHERE author='Alexey Milovidov' AND files_added > 10 → ~41 rows
    expect(count).to.be.within(SEED_LIMIT + 1, 200);
  });
});
