/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * P0 Logging E2E Tests
 *
 * Tests the P0 logging infrastructure (ENG-1892, ENG-1893, ENG-1894, ENG-1895).
 *
 * The tests verify:
 * 1. Structured logging with P0 fields (context, resource_type, resource_name) works
 * 2. Runtime context logs (ingest API, consumption API, workflows)
 * 3. Deploy context logs (table operations)
 * 4. System context logs (health checks)
 * 5. All instrumented functions emit logs with correct span fields
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

// Import constants and utilities
import { TIMEOUTS, SERVER_CONFIG } from "./constants";

import {
  waitForServerStart,
  createTempTestDirectory,
  setupTypeScriptProject,
  cleanupTestSuite,
  performGlobalCleanup,
  cleanupClickhouseData,
  waitForInfrastructureReady,
  logger,
} from "./utils";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const TEST_SUITE = "p0-logging";
const APP_NAME = "moose-ts-empty-app";

/**
 * Valid P0 resource types according to ENG-1893, ENG-1894, ENG-1895
 * Source: apps/framework-cli/src/cli/logger.rs (resource_type module)
 */
const VALID_RESOURCE_TYPES = [
  "ingest_api",
  "consumption_api",
  "stream",
  "olap_table",
  "view",
  "materialized_view",
  "transform",
  "consumer",
  "workflow",
  "task",
] as const;

interface LogEntry {
  timestamp: string;
  level: string;
  fields: {
    message: string;
  };
  target?: string;
  span?: {
    context?: string;
    resource_type?: string;
    resource_name?: string;
    name: string;
  };
}

/**
 * Reads and parses the moose CLI log file
 */
function readLogFile(): LogEntry[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const logDir = path.join(homeDir, ".moose");

  // Use local date to match CLI's log file naming (not UTC)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const today = `${year}-${month}-${day}`;
  const logFile = path.join(logDir, `${today}-cli.log`);

  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file not found: ${logFile}`);
  }

  const logContent = fs.readFileSync(logFile, "utf-8");
  const lines = logContent.trim().split("\n");

  // Parse JSON log entries with error tracking
  const entries: LogEntry[] = [];
  let skippedLines = 0;
  let lastError: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
    } catch (e) {
      skippedLines++;
      lastError = line.substring(0, 100); // Keep first 100 chars for debugging
    }
  }

  if (skippedLines > 0) {
    logger
      .scope(TEST_SUITE)
      .debug(
        `Skipped ${skippedLines} non-JSON lines out of ${lines.length} total lines. Sample: ${lastError}`,
      );
  }

  return entries;
}

/**
 * Filters log entries by span fields
 */
function filterLogs(
  entries: LogEntry[],
  filters: {
    context?: string;
    resource_type?: string;
    resource_name?: string;
  },
): LogEntry[] {
  return entries.filter((entry) => {
    if (!entry.span) return false;

    if (filters.context && entry.span.context !== filters.context) return false;
    if (
      filters.resource_type &&
      entry.span.resource_type !== filters.resource_type
    )
      return false;
    if (
      filters.resource_name &&
      entry.span.resource_name !== filters.resource_name
    )
      return false;

    return true;
  });
}

/**
 * Polls for log entries matching the given filters until they appear or timeout
 */
async function waitForLogs(
  filters: {
    context?: string;
    resource_type?: string;
    resource_name?: string;
  },
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    minCount?: number;
  } = {},
): Promise<LogEntry[]> {
  const timeoutMs = options.timeoutMs || 30000; // 30s default
  const intervalMs = options.intervalMs || 500; // 500ms default
  const minCount = options.minCount || 1;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const logEntries = readLogFile();
      const matchingLogs = filterLogs(logEntries, filters);

      if (matchingLogs.length >= minCount) {
        return matchingLogs;
      }
    } catch (e) {
      // Log file might not exist yet, continue polling
      // Log unexpected errors for debugging
      if (
        e instanceof Error &&
        !e.message.includes("not found") &&
        !e.message.includes("ENOENT")
      ) {
        logger
          .scope(TEST_SUITE)
          .debug(`Unexpected error reading logs: ${e.message}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timeout waiting for logs matching filters: ${JSON.stringify(filters)}. Expected at least ${minCount} entries.`,
  );
}

describe("P0 Logging E2E Tests", function () {
  this.timeout(TIMEOUTS.TEST_SETUP_MS);

  let testDir: string;
  let projectDir: string;
  let mooseProcess: ChildProcess | null = null;
  const testLogger = logger.scope(TEST_SUITE);

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);
    testLogger.info("Starting P0 logging test suite");

    // Cleanup before running tests (ClickHouse will be started by moose dev)
    await performGlobalCleanup();

    // Create test directory
    testDir = createTempTestDirectory(TEST_SUITE);
    projectDir = path.join(testDir, APP_NAME);

    testLogger.info("Setting up TypeScript project", { projectDir });
    await setupTypeScriptProject(
      projectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAME,
      "npm",
      { logger: testLogger },
    );

    // Add a simple data model for ingest testing
    const ingestDir = path.join(projectDir, "app", "ingest");
    fs.mkdirSync(ingestDir, { recursive: true });
    const modelPath = path.join(ingestDir, "models.ts");
    const modelContent = `
import { Key } from "@514labs/moose-lib";

export interface TestEvent {
  eventId: Key<string>;
  userId: string;
  timestamp: string;
}
`;
    fs.writeFileSync(modelPath, modelContent);

    // Start moose dev with structured logging enabled
    testLogger.info("Starting moose dev with structured logging");
    mooseProcess = spawn(CLI_PATH, ["dev"], {
      cwd: projectDir,
      env: {
        ...process.env,
        MOOSE_LOGGER__STRUCTURED_LOGS: "true", // Enable structured logging
        RUST_LOG: "debug",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    mooseProcess.stdout?.on("data", (data) => {
      testLogger.debug(`moose stdout: ${data.toString()}`);
    });

    mooseProcess.stderr?.on("data", (data) => {
      testLogger.debug(`moose stderr: ${data.toString()}`);
    });

    mooseProcess.on("error", (err) => {
      testLogger.error(`Failed to spawn moose process: ${err.message}`, err);
    });

    // Wait for server to be ready
    await waitForServerStart(
      mooseProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
      { logger: testLogger },
    );
    await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
      logger: testLogger,
    });

    testLogger.info("Test setup complete");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("Cleaning up P0 logging test suite");
    await cleanupTestSuite(mooseProcess, testDir, APP_NAME, {
      logger: testLogger,
    });
  });

  it("should emit logs with P0 fields for ingest API (runtime context)", async function () {
    this.timeout(TIMEOUTS.P0_LOGGING_TEST_MS);

    // Send ingest request
    const ingestUrl = `${SERVER_CONFIG.url}/ingest/TestEvent`;
    const testEvent = {
      eventId: "test-123",
      userId: "user-456",
      timestamp: new Date().toISOString(),
    };

    testLogger.info("Sending ingest request", { ingestUrl, testEvent });
    const response = await axios.post(ingestUrl, [testEvent]);
    expect(response.status).to.equal(200);

    // Wait for logs to be written with polling
    const ingestLogs = await waitForLogs(
      {
        context: "runtime",
        resource_type: "ingest_api",
        resource_name: "TestEvent",
      },
      { timeoutMs: 10000, minCount: 1 },
    );

    testLogger.info(`Found ${ingestLogs.length} ingest API logs`);

    // Verify we have ingest logs with correct P0 fields
    expect(ingestLogs.length).to.be.greaterThan(
      0,
      "Should have at least one ingest API log entry",
    );

    // Verify span structure
    const sampleLog = ingestLogs[0];
    expect(sampleLog.span).to.exist;
    expect(sampleLog.span?.context).to.equal("runtime");
    expect(sampleLog.span?.resource_type).to.equal("ingest_api");
    expect(sampleLog.span?.resource_name).to.equal("TestEvent");
  });

  it("should emit logs with P0 fields for health check (system context)", async function () {
    this.timeout(TIMEOUTS.P0_LOGGING_TEST_MS);

    // Call health endpoint
    const healthUrl = `${SERVER_CONFIG.url}/health`;
    testLogger.info("Calling health endpoint", { healthUrl });

    const response = await axios.get(healthUrl);
    expect(response.status).to.equal(200);

    // Wait for system context logs with polling
    const healthLogs = await waitForLogs(
      {
        context: "system",
      },
      { timeoutMs: 10000, minCount: 1 },
    );

    testLogger.info(`Found ${healthLogs.length} system context logs`);

    // Verify we have health check logs with correct P0 fields
    expect(healthLogs.length).to.be.greaterThan(
      0,
      "Should have at least one system context log entry",
    );

    // Verify span structure - system context should NOT have resource_type/resource_name
    const healthLog = healthLogs.find(
      (log) => log.span?.name === "health_check",
    );
    expect(healthLog).to.exist;
    expect(healthLog?.span?.context).to.equal("system");
    expect(healthLog?.span?.resource_type).to.be.undefined;
    expect(healthLog?.span?.resource_name).to.be.undefined;
  });

  it("should emit logs with P0 fields for OLAP operations (boot context)", async function () {
    this.timeout(TIMEOUTS.P0_LOGGING_TEST_MS);

    // Trigger OLAP operations by modifying the data model
    const modelPath = path.join(projectDir, "app", "ingest", "models.ts");
    const updatedModelContent = `
import { Key } from "@514labs/moose-lib";

export interface TestEvent {
  eventId: Key<string>;
  userId: string;
  timestamp: string;
  newField: string; // Added field to trigger schema change
}
`;
    fs.writeFileSync(modelPath, updatedModelContent);

    // Wait for boot context logs with polling
    testLogger.info("Waiting for schema change to be applied");
    const deployLogs = await waitForLogs(
      {
        context: "boot",
      },
      { timeoutMs: 30000, minCount: 1 },
    );

    testLogger.info(`Found ${deployLogs.length} boot context logs`);

    // Verify we have boot logs (table operations)
    expect(deployLogs.length).to.be.greaterThan(
      0,
      "Should have at least one boot context log entry",
    );

    // Check for OLAP table operations (add_column, create_table, etc.)
    const olapLogs = deployLogs.filter(
      (log) => log.span?.resource_type === "olap_table",
    );
    testLogger.info(`Found ${olapLogs.length} OLAP operation logs`);

    // OLAP logs are required - fail if missing
    expect(olapLogs.length).to.be.greaterThan(
      0,
      "Should have at least one OLAP table operation log",
    );

    const sampleLog = olapLogs[0];
    expect(sampleLog.span?.context).to.equal("boot");
    expect(sampleLog.span?.resource_type).to.equal("olap_table");
    expect(sampleLog.span?.resource_name).to.exist;
  });

  it("should verify all P0 contexts are present in logs", async function () {
    this.timeout(TIMEOUTS.P0_LOGGING_TEST_MS);

    // Read all log entries
    const logEntries = readLogFile();
    const logsWithSpan = logEntries.filter((entry) => entry.span);

    testLogger.info(`Found ${logsWithSpan.length} logs with span information`);

    // Extract unique contexts
    const contexts = new Set(
      logsWithSpan.map((entry) => entry.span?.context).filter(Boolean),
    );
    testLogger.info("Found contexts:", Array.from(contexts));

    // Verify we have at least runtime and system contexts
    // (deploy may not be present if no schema changes occurred)
    expect(contexts.has("runtime")).to.be.true;
    expect(contexts.has("system")).to.be.true;
  });

  it("should verify resource_type values match P0 spec", async function () {
    this.timeout(TIMEOUTS.P0_LOGGING_TEST_MS);

    // Read all log entries
    const logEntries = readLogFile();
    const logsWithSpan = logEntries.filter(
      (entry) => entry.span?.resource_type,
    );

    testLogger.info(
      `Found ${logsWithSpan.length} logs with resource_type information`,
    );

    // Extract unique resource types
    const resourceTypes = new Set(
      logsWithSpan.map((entry) => entry.span?.resource_type).filter(Boolean),
    );
    testLogger.info("Found resource types:", Array.from(resourceTypes));

    // Verify all resource types are valid (using shared constant)
    for (const resourceType of resourceTypes) {
      expect(VALID_RESOURCE_TYPES).to.include(
        resourceType,
        `Invalid resource_type: ${resourceType}`,
      );
    }
  });
});
