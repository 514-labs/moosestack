/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * OTLP Log Export E2E Tests
 *
 * Tests the OTLP gRPC log export functionality with span fields.
 *
 * These tests verify:
 * 1. Logs are exported to an OTLP collector via gRPC
 * 2. Span fields (context, resource_type, resource_name) are included as log attributes
 * 3. Log records contain correct severity, body, and timestamps
 * 4. Resource attributes (service.name, service.version) are present
 * 5. resource_name matches source_primitive.name from infrastructure map (enables log correlation)
 *
 * NOTE: Span field attributes are captured by the experimental_span_attributes feature
 * for logs emitted within instrumented spans. Fields added after span creation
 * won't be captured.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

import { TIMEOUTS } from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  setupTypeScriptProject,
  cleanupTestSuite,
  performGlobalCleanup,
  waitForInfrastructureReady,
  logger,
} from "./utils";
import { OtlpMockServer, createOtlpMockServer } from "./utils/otlp-mock-server";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const TEST_SUITE = "otlp-export";
const APP_NAME = "moose-ts-otlp-app";

/**
 * Valid resource types for structured logging
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
  "workflow",
  "task",
] as const;

describe("OTLP Log Export E2E Tests", function () {
  this.timeout(TIMEOUTS.TEST_SETUP_MS);

  let testDir: string;
  let projectDir: string;
  let mooseProcess: ChildProcess | null = null;
  let otlpServer: OtlpMockServer | null = null;
  const testLogger = logger.scope(TEST_SUITE);

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);
    testLogger.info("Starting OTLP export test suite");

    // Cleanup before running tests
    await performGlobalCleanup();

    // Start the mock OTLP server first
    testLogger.info("Starting mock OTLP server");
    otlpServer = await createOtlpMockServer();
    const otlpEndpoint = otlpServer.getEndpoint();
    testLogger.info(`Mock OTLP server started at ${otlpEndpoint}`);

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
import { Key, IngestPipeline } from "@514labs/moose-lib";

export interface OtlpTestEvent {
  eventId: Key<string>;
  userId: string;
  timestamp: string;
}

export const OtlpTestEventPipeline = new IngestPipeline<OtlpTestEvent>("OtlpTestEvent", {
  table: true,
  stream: true,
  ingestApi: true,
});
`;
    fs.writeFileSync(modelPath, modelContent);

    // Add a consumption API with console.log for testing log capture
    const apisDir = path.join(projectDir, "app", "apis");
    fs.mkdirSync(apisDir, { recursive: true });
    const apiPath = path.join(apisDir, "otlp-test.ts");
    const apiContent = `
import { Api } from "@514labs/moose-lib";

interface QueryParams {
  message?: string;
}

interface ResponseData {
  echo: string;
  timestamp: string;
}

export const OtlpTestApi = new Api<QueryParams, ResponseData>(
  "otlp-test",
  async ({ message = "hello" }, _context) => {
    console.log("OTLP test: Processing API request with message:", message);
    console.log("OTLP test: This log should be exported via OTLP");

    return {
      echo: message,
      timestamp: new Date().toISOString(),
    };
  },
);
`;
    fs.writeFileSync(apiPath, apiContent);

    // Update app/index.ts to export the models and APIs
    const indexPath = path.join(projectDir, "app", "index.ts");
    const indexContent = `
// Export data models
export * from "./ingest/models";

// Export APIs
export * from "./apis/otlp-test";
`;
    fs.writeFileSync(indexPath, indexContent);

    // Start moose dev with OTLP endpoint configured
    testLogger.info("Starting moose dev with OTLP export enabled", {
      otlpEndpoint,
    });

    // Use high port numbers to avoid conflicts with other tests
    const moosePort = 5000;
    const consolePort = 5100;

    mooseProcess = spawn(CLI_PATH, ["dev"], {
      cwd: projectDir,
      env: {
        ...process.env,
        MOOSE_LOGGER__OTLP_ENDPOINT: otlpEndpoint,
        MOOSE_LOGGER__LEVEL: "Debug",
        RUST_LOG: "debug",
        MOOSE_HTTP_SERVER_CONFIG__HOST: "localhost",
        MOOSE_HTTP_SERVER_CONFIG__PORT: String(moosePort),
        MOOSE_CONSOLE__HOST_PORT: String(consolePort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    mooseProcess.stdout?.on("data", (data) => {
      // Log stdout at info level to see what moose is outputting
      testLogger.info(`moose stdout: ${data.toString().trim()}`);
    });

    mooseProcess.stderr?.on("data", (data) => {
      testLogger.warn(`moose stderr: ${data.toString().trim()}`);
    });

    mooseProcess.on("error", (err) => {
      testLogger.error(`Failed to spawn moose process: ${err.message}`, err);
    });

    // Wait for server to be ready
    const serverBaseUrl = `http://localhost:${moosePort}`;
    // Generate startup message dynamically using the actual port (not the default 4000)
    const startupMessage = `Your local development server is running at: http://localhost:${moosePort}/ingest`;
    await waitForServerStart(
      mooseProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      startupMessage,
      serverBaseUrl,
      { logger: testLogger },
    );
    await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
      logger: testLogger,
      baseUrl: serverBaseUrl,
    });

    // Give the OTLP exporter time to flush initial boot logs
    testLogger.info("Waiting for initial OTLP export flush");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    testLogger.info("Test setup complete");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("Cleaning up OTLP export test suite");

    // Stop moose first to ensure logs are flushed
    await cleanupTestSuite(mooseProcess, testDir, APP_NAME, {
      logger: testLogger,
    });

    // Stop the OTLP server
    if (otlpServer) {
      await otlpServer.stop();
      otlpServer = null;
    }
  });

  it("should receive logs via OTLP during boot", async function () {
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Boot logs should already be present from startup
    const allLogs = otlpServer!.getLogs();

    testLogger.info(`Found ${allLogs.length} total logs via OTLP after boot`);

    // We should have received some logs during startup
    expect(allLogs.length).to.be.greaterThan(
      0,
      "Should have received at least one log via OTLP during boot",
    );

    // Verify logs have the expected structure
    const sampleLog = allLogs[0];
    expect(sampleLog.serviceName).to.equal("moose");
    expect(sampleLog.serviceVersion).to.exist;
    expect(sampleLog.body).to.exist;
    expect(sampleLog.level).to.exist;
  });

  it("should receive ingest API logs with span fields via OTLP", async function () {
    // Verifies resource_name matches source_primitive.name ("OtlpTestEvent") for log correlation
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Clear previous logs
    otlpServer!.clearLogs();

    // Send ingest request
    const ingestUrl = "http://localhost:5000/ingest/OtlpTestEvent";
    const testEvent = {
      eventId: "otlp-test-123",
      userId: "user-456",
      timestamp: new Date().toISOString(),
    };

    testLogger.info("Sending ingest request", { ingestUrl, testEvent });
    const response = await axios.post(ingestUrl, [testEvent]);
    expect(response.status).to.equal(200);

    // Wait for logs with ingest_api span fields
    const ingestLogs = await otlpServer!.waitForLogs(
      {
        context: "runtime",
        resourceType: "ingest_api",
        resourceName: "OtlpTestEvent",
      },
      { timeoutMs: 15000, minCount: 1 },
    );

    testLogger.info(
      `Found ${ingestLogs.length} ingest API logs with span fields`,
    );

    // Verify we received logs with span fields
    expect(ingestLogs.length).to.be.greaterThan(
      0,
      "Should have at least one log with ingest_api span fields",
    );

    // Verify span fields
    const sampleLog = ingestLogs[0];
    expect(sampleLog.context).to.equal("runtime");
    expect(sampleLog.resourceType).to.equal("ingest_api");
    expect(sampleLog.resourceName).to.equal("OtlpTestEvent");
    expect(sampleLog.serviceName).to.equal("moose");
  });

  it("should receive logs via OTLP after health check", async function () {
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Clear previous logs
    otlpServer!.clearLogs();

    // Wait for services to settle
    await new Promise((resolve) =>
      setTimeout(resolve, TIMEOUTS.SERVICE_SETTLE_MS),
    );

    // Call health endpoint
    const healthUrl = "http://localhost:5000/health";
    testLogger.info("Calling health endpoint", { healthUrl });

    const response = await axios.get(healthUrl);
    expect(response.status).to.equal(200);

    // Wait for any logs after the health check
    const logsAfterHealth = await otlpServer!.waitForLogs(
      {}, // No filter - just wait for any logs
      { timeoutMs: 10000, minCount: 1 },
    );

    testLogger.info(
      `Found ${logsAfterHealth.length} logs via OTLP after health check`,
    );

    // Verify we received logs
    expect(logsAfterHealth.length).to.be.greaterThan(
      0,
      "Should have at least one log via OTLP after health check",
    );

    // Verify log structure
    const sampleLog = logsAfterHealth[0];
    expect(sampleLog.serviceName).to.equal("moose");
    expect(sampleLog.body).to.exist;
  });

  it("should receive consumption API logs with span fields via OTLP", async function () {
    // Verifies resource_name matches source_primitive.name ("otlp-test") for log correlation
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Clear previous logs
    otlpServer!.clearLogs();

    // Call the consumption API (available on main port at /api/otlp-test)
    const apiUrl =
      "http://localhost:5000/api/otlp-test?message=otlp-test-logging";
    testLogger.info("Calling consumption API", { apiUrl });

    const response = await axios.get(apiUrl);
    expect(response.status).to.equal(200);
    expect(response.data.echo).to.equal("otlp-test-logging");

    // Wait for logs with consumption_api span fields
    const consumptionLogs = await otlpServer!.waitForLogs(
      {
        context: "runtime",
        resourceType: "consumption_api",
        resourceName: "otlp-test",
      },
      { timeoutMs: 10000, minCount: 1 },
    );

    testLogger.info(
      `Found ${consumptionLogs.length} consumption API logs with span fields`,
    );

    // Verify we received logs with span fields
    expect(consumptionLogs.length).to.be.greaterThan(
      0,
      "Should have at least one log with consumption_api span fields",
    );

    // Verify span fields
    const sampleLog = consumptionLogs[0];
    expect(sampleLog.context).to.equal("runtime");
    expect(sampleLog.resourceType).to.equal("consumption_api");
    expect(sampleLog.resourceName).to.equal("otlp-test");
    expect(sampleLog.serviceName).to.equal("moose");
  });

  it("should verify all resource_type values are valid in OTLP logs", async function () {
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Get all logs with resource_type
    const allLogs = otlpServer!.getLogs();
    const logsWithResourceType = allLogs.filter((log) => log.resourceType);

    testLogger.info(
      `Found ${logsWithResourceType.length} logs with resource_type via OTLP`,
    );

    // Extract unique resource types
    const resourceTypes = new Set(
      logsWithResourceType.map((log) => log.resourceType).filter(Boolean),
    );
    testLogger.info("Found resource types:", Array.from(resourceTypes));

    // Verify all resource types are valid
    for (const resourceType of resourceTypes) {
      expect(VALID_RESOURCE_TYPES).to.include(
        resourceType,
        `Invalid resource_type in OTLP logs: ${resourceType}`,
      );
    }
  });

  it("should include service metadata in OTLP log records", async function () {
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    const allLogs = otlpServer!.getLogs();

    expect(allLogs.length).to.be.greaterThan(
      0,
      "Should have received at least one log via OTLP",
    );

    // Check that all logs have service metadata
    for (const log of allLogs.slice(0, 5)) {
      // Check first 5 logs
      expect(log.serviceName).to.equal(
        "moose",
        "Log should have service.name = moose",
      );
      expect(log.serviceVersion).to.exist;
    }
  });

  it("should have correct log severity levels", async function () {
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    const allLogs = otlpServer!.getLogs();

    // Get logs at different levels
    const debugLogs = allLogs.filter(
      (log) => log.level.toUpperCase() === "DEBUG",
    );
    const infoLogs = allLogs.filter(
      (log) => log.level.toUpperCase() === "INFO",
    );
    const warnLogs = allLogs.filter(
      (log) => log.level.toUpperCase() === "WARN",
    );
    const errorLogs = allLogs.filter(
      (log) => log.level.toUpperCase() === "ERROR",
    );

    testLogger.info("Log levels distribution:", {
      debug: debugLogs.length,
      info: infoLogs.length,
      warn: warnLogs.length,
      error: errorLogs.length,
      total: allLogs.length,
    });

    // We should have at least some info or debug logs from normal operation
    expect(debugLogs.length + infoLogs.length).to.be.greaterThan(
      0,
      "Should have at least some DEBUG or INFO logs",
    );
  });
});
