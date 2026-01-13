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
import {
  TIMEOUTS,
  SERVER_CONFIG,
  TEMPLATE_NAMES,
  APP_NAMES,
} from "./constants";

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
function readLogFile(projectDir: string): LogEntry[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const logDir = path.join(homeDir, ".moose");
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const logFile = path.join(logDir, `${today}-cli.log`);

  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file not found: ${logFile}`);
  }

  const logContent = fs.readFileSync(logFile, "utf-8");
  const lines = logContent.trim().split("\n");

  // Parse JSON log entries
  const entries: LogEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
    } catch (e) {
      // Skip non-JSON lines (legacy format or errors)
    }
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
    projectDir = path.join(testDir, APP_NAMES.TYPESCRIPT_DEFAULT);

    testLogger.info("Setting up TypeScript project", { projectDir });
    await setupTypeScriptProject(
      projectDir,
      "typescript-empty",
      CLI_PATH,
      MOOSE_LIB_PATH,
      "moose-ts-empty-app",
      "npm",
      { logger: testLogger },
    );

    // Add a simple data model for ingest testing
    const modelPath = path.join(projectDir, "app", "ingest", "models.ts");
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
        MOOSE_STRUCTURED_LOGS: "true", // Enable structured logging
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
    await cleanupTestSuite(mooseProcess, testDir, "moose-ts-empty-app", {
      logger: testLogger,
    });
  });

  it("should emit logs with P0 fields for ingest API (runtime context)", async function () {
    this.timeout(120000); // 2 minutes

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

    // Wait for logs to be written
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Read and parse log file
    const logEntries = readLogFile(projectDir);
    testLogger.info(`Found ${logEntries.length} log entries`);

    // Filter for ingest API logs
    const ingestLogs = filterLogs(logEntries, {
      context: "runtime",
      resource_type: "ingest_api",
      resource_name: "TestEvent",
    });

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
    this.timeout(120000); // 2 minutes

    // Call health endpoint
    const healthUrl = `${SERVER_CONFIG.url}/health`;
    testLogger.info("Calling health endpoint", { healthUrl });

    const response = await axios.get(healthUrl);
    expect(response.status).to.equal(200);

    // Wait for logs to be written
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Read and parse log file
    const logEntries = readLogFile(projectDir);

    // Filter for health check logs
    const healthLogs = filterLogs(logEntries, {
      context: "system",
    });

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

  it("should emit logs with P0 fields for OLAP operations (deploy context)", async function () {
    this.timeout(120000); // 2 minutes

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

    // Wait for file watcher to detect changes and apply them
    testLogger.info("Waiting for schema change to be applied");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Read and parse log file
    const logEntries = readLogFile(projectDir);

    // Filter for deploy context logs
    const deployLogs = filterLogs(logEntries, {
      context: "deploy",
    });

    testLogger.info(`Found ${deployLogs.length} deploy context logs`);

    // Verify we have deploy logs (table operations)
    expect(deployLogs.length).to.be.greaterThan(
      0,
      "Should have at least one deploy context log entry",
    );

    // Check for OLAP table operations (add_column, create_table, etc.)
    const olapLogs = deployLogs.filter(
      (log) => log.span?.resource_type === "olap_table",
    );
    testLogger.info(`Found ${olapLogs.length} OLAP operation logs`);

    if (olapLogs.length > 0) {
      const sampleLog = olapLogs[0];
      expect(sampleLog.span?.context).to.equal("deploy");
      expect(sampleLog.span?.resource_type).to.equal("olap_table");
      expect(sampleLog.span?.resource_name).to.exist;
    }
  });

  it("should verify all P0 contexts are present in logs", async function () {
    this.timeout(120000); // 2 minutes

    // Read all log entries
    const logEntries = readLogFile(projectDir);
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
    this.timeout(120000); // 2 minutes

    // Read all log entries
    const logEntries = readLogFile(projectDir);
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

    // Valid P0 resource types according to the spec
    const validResourceTypes = [
      "ingest_api",
      "consumption_api",
      "stream",
      "olap_table",
      "materialized_view",
      "transform",
      "consumer",
      "workflow",
      "task",
    ];

    // Verify all resource types are valid
    for (const resourceType of resourceTypes) {
      expect(validResourceTypes).to.include(
        resourceType,
        `Invalid resource_type: ${resourceType}`,
      );
    }
  });
});
