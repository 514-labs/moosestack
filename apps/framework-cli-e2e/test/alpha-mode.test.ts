/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * E2E tests for `moose dev --alpha` (fully native infrastructure).
 *
 * Validates the full lifecycle: init -> start -> verify infra -> send data -> stop -> verify cleanup.
 * Alpha mode starts devredis, devkafka, ClickHouse, and Temporal as local processes — no Docker.
 */

import { spawn, ChildProcess, execSync } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

import {
  TIMEOUTS,
  SERVER_CONFIG,
  CLICKHOUSE_CONFIG,
  APP_NAMES,
  TEST_DATA,
} from "./constants";

import {
  waitForServerStart,
  waitForInfrastructureReady,
  stopDevProcess,
  cleanupTestSuite,
  performGlobalCleanup,
  createTempTestDirectory,
  setupTypeScriptProject,
  waitForDBWrite,
  verifyClickhouseData,
  logger,
} from "./utils";

/**
 * Alpha mode model definition written into the project after init.
 *
 * In alpha mode (no streaming engine), data is inserted directly into ClickHouse.
 * The model must have both `ingestApi: true` AND `table: true`.
 */
const ALPHA_MODEL_SOURCE = `
import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";

export interface UserActivity {
  eventId: Key<string>;
  timestamp: DateTime;
  userId: string;
  activity: string;
}

export const UserActivityPipeline = new IngestPipeline<UserActivity>("UserActivity", {
  table: true,
  stream: true,
  ingestApi: true,
});
`;

const testLogger = logger.scope("alpha-mode");

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

describe("moose dev --alpha (native infrastructure)", function () {
  this.timeout(TIMEOUTS.TEST_SETUP_MS);

  let projectDir: string;
  let devProcess: ChildProcess | null = null;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Global cleanup of leftover processes/resources
    await performGlobalCleanup("Alpha mode test: global pre-cleanup");

    // Initialize a TypeScript project
    projectDir = createTempTestDirectory("alpha-mode", { logger: testLogger });
    testLogger.info("Setting up TypeScript project for alpha mode test", {
      projectDir,
    });

    await setupTypeScriptProject(
      projectDir,
      "typescript",
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAMES.TYPESCRIPT_ALPHA,
      "npm",
      { logger: testLogger },
    );

    // Replace the default template models with an alpha-mode-compatible model.
    // The default Foo has table:false (no ClickHouse table) and Bar has ingestApi:false,
    // neither works for alpha mode's direct-to-ClickHouse ingestion path.
    testLogger.info(
      "Writing alpha-mode model (UserActivity with table+ingestApi)",
    );
    fs.writeFileSync(
      path.join(projectDir, "app", "ingest", "models.ts"),
      ALPHA_MODEL_SOURCE,
    );
    // Remove transform and files that reference the old Foo/Bar models
    const transformsPath = path.join(
      projectDir,
      "app",
      "ingest",
      "transforms.ts",
    );
    if (fs.existsSync(transformsPath)) fs.unlinkSync(transformsPath);
    const barApiPath = path.join(projectDir, "app", "apis", "bar.ts");
    if (fs.existsSync(barApiPath)) fs.unlinkSync(barApiPath);
    const barViewPath = path.join(
      projectDir,
      "app",
      "views",
      "barAggregated.ts",
    );
    if (fs.existsSync(barViewPath)) fs.unlinkSync(barViewPath);
    const workflowPath = path.join(
      projectDir,
      "app",
      "workflows",
      "generator.ts",
    );
    if (fs.existsSync(workflowPath)) fs.unlinkSync(workflowPath);
    // Rewrite index.ts to only export the alpha model (removes references to deleted files)
    fs.writeFileSync(
      path.join(projectDir, "app", "index.ts"),
      'export * from "./ingest/models";\n',
    );

    testLogger.info("Starting moose dev --alpha...");
    devProcess = spawn(CLI_PATH, ["dev", "--alpha"], {
      cwd: projectDir,
      env: {
        ...process.env,
        MOOSE_TELEMETRY__ENABLED: "false",
        MOOSE_REDPANDA_CONFIG__BROKER: "127.0.0.1:19092",
        MOOSE_FEATURES__STREAMING_ENGINE: "false",
        RUST_LOG: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    devProcess.stdout?.on("data", (data) => {
      testLogger.debug("stdout:", data.toString().trim());
    });
    devProcess.stderr?.on("data", (data) => {
      testLogger.debug("stderr:", data.toString().trim());
    });

    // Wait for the server to be ready
    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
      { logger: testLogger },
    );
    testLogger.info("Dev server started in alpha mode");

    // Wait for all infrastructure (ClickHouse, Temporal, Redis, Redpanda) to be healthy
    await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
      logger: testLogger,
    });
    testLogger.info("All infrastructure components are ready");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    await cleanupTestSuite(devProcess, projectDir, APP_NAMES.TYPESCRIPT_ALPHA, {
      includeDocker: false, // Alpha mode is fully Docker-free
      logPrefix: "alpha-mode",
      logger: testLogger,
    });
    devProcess = null;
  });

  it("should start with native infrastructure and respond to health check", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    // The /ready endpoint checks all infra components
    const response = await fetch(`${SERVER_CONFIG.url}/ready`);
    expect(response.status).to.equal(200);
    testLogger.info("/ready endpoint returned 200");
  });

  it("should ingest data through the API", async function () {
    this.timeout(120_000);

    const eventId = randomUUID();

    // Send data to the UserActivity ingest endpoint (alpha mode: direct to ClickHouse)
    const response = await fetch(`${SERVER_CONFIG.url}/ingest/UserActivity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        timestamp: new Date(TEST_DATA.TIMESTAMP * 1000).toISOString(),
        userId: "test-alpha-user",
        activity: "login",
      }),
    });

    expect(
      response.ok,
      `Ingest should succeed, got ${response.status}: ${await response.text()}`,
    ).to.be.true;
    testLogger.info("Data ingested successfully", { eventId });

    // Wait for the data to appear in ClickHouse
    await waitForDBWrite(devProcess!, "UserActivity", 1, 60_000);
    testLogger.info("Data verified in ClickHouse");

    // Verify the specific record
    await verifyClickhouseData("UserActivity", eventId, "eventId");
    testLogger.info("Record verified in ClickHouse", { eventId });
  });

  it("should clean up native processes on shutdown", async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);

    // Store the project dir for PID file checks
    const mooseDir = path.join(projectDir, ".moose", "native_infra");

    // Stop the dev process via SIGINT (graceful shutdown)
    testLogger.info("Stopping dev process...");
    await stopDevProcess(devProcess, { logger: testLogger });
    devProcess = null;

    // Give processes a moment to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify no native ClickHouse processes remain
    try {
      execSync('pgrep -f "clickhouse.*config-file.*native_infra"', {
        encoding: "utf-8",
      });
      // If pgrep succeeds, processes still exist — that's a failure
      expect.fail(
        "ClickHouse native process should have been terminated on shutdown",
      );
    } catch {
      // pgrep exits non-zero when no process matches — this is the success path
      testLogger.info("No lingering ClickHouse native processes found");
    }

    // Verify no native Temporal processes remain
    try {
      execSync('pgrep -f "temporal.*db-filename.*native_infra"', {
        encoding: "utf-8",
      });
      expect.fail(
        "Temporal native process should have been terminated on shutdown",
      );
    } catch {
      testLogger.info("No lingering Temporal native processes found");
    }

    // Verify no devkafka processes remain
    try {
      execSync('pgrep -f "devkafka"', { encoding: "utf-8" });
      expect.fail("devkafka process should have been terminated");
    } catch {
      testLogger.info("No lingering devkafka processes");
    }

    // Verify no devredis processes remain
    try {
      execSync('pgrep -f "devredis"', { encoding: "utf-8" });
      expect.fail("devredis process should have been terminated");
    } catch {
      testLogger.info("No lingering devredis processes");
    }

    // Verify PID files are removed
    const chPidFile = path.join(mooseDir, "clickhouse.pid");
    const temporalPidFile = path.join(mooseDir, "temporal.pid");
    const devkafkaPidFile = path.join(mooseDir, "devkafka.pid");
    const devredisPidFile = path.join(mooseDir, "devredis.pid");

    expect(
      fs.existsSync(chPidFile),
      `ClickHouse PID file should be removed: ${chPidFile}`,
    ).to.be.false;
    expect(
      fs.existsSync(temporalPidFile),
      `Temporal PID file should be removed: ${temporalPidFile}`,
    ).to.be.false;
    expect(
      fs.existsSync(devkafkaPidFile),
      `devkafka PID file should be removed: ${devkafkaPidFile}`,
    ).to.be.false;
    expect(
      fs.existsSync(devredisPidFile),
      `devredis PID file should be removed: ${devredisPidFile}`,
    ).to.be.false;

    testLogger.info("PID files cleaned up successfully");
  });
});
