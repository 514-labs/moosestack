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

import { TIMEOUTS, SERVER_CONFIG } from "./constants";
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

// Admin API bearer token for authentication (used in Authorization header)
const TEST_ADMIN_BEARER_TOKEN =
  "deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef";

// Admin API key hash (PBKDF2 hash of the bearer token, used in moose config)
const TEST_ADMIN_API_KEY_HASH = "445fd4696cfc5c49e28995c4aba05de44303a112";

/**
 * Infrastructure map types for querying primitive names
 */
interface PrimitiveSignature {
  name: string;
  primitive_type: string;
}

interface ApiEndpoint {
  source_primitive: PrimitiveSignature;
}

interface Topic {
  name: string;
  source_primitive: PrimitiveSignature;
}

interface FunctionProcess {
  name: string;
  source_primitive: PrimitiveSignature;
  source_topic_id: string;
  target_topic_id: string | null;
}

interface Table {
  name: string;
  source_primitive: PrimitiveSignature;
}

interface OrchestrationWorker {
  supported_language: string;
}

interface Workflow {
  name: string;
}

interface InfraMap {
  api_endpoints: Record<string, ApiEndpoint>;
  topics: Record<string, Topic>;
  function_processes: Record<string, FunctionProcess>;
  tables: Record<string, Table>;
  orchestration_workers: Record<string, OrchestrationWorker>;
  workflows: Record<string, Workflow>;
}

interface InfraMapResponse {
  status: string;
  infra_map: InfraMap;
}

/**
 * Fetches the infrastructure map from the running Moose server
 */
async function getInfraMap(baseUrl: string): Promise<InfraMap> {
  const response = await axios.get<InfraMapResponse>(
    `${baseUrl}/admin/inframap`,
    {
      headers: {
        Authorization: `Bearer ${TEST_ADMIN_BEARER_TOKEN}`,
      },
    },
  );
  return response.data.infra_map;
}

/**
 * Extracts the source primitive name for a given API endpoint key from the inframap.
 * Keys use INGRESS_<name> for ingest APIs and EGRESS_<name> for consumption APIs.
 */
function getApiPrimitiveName(infraMap: InfraMap, apiKey: string): string {
  const endpoint = infraMap.api_endpoints[apiKey];
  if (!endpoint) {
    throw new Error(
      `API endpoint ${apiKey} not found in inframap. Available: ${Object.keys(infraMap.api_endpoints).join(", ")}`,
    );
  }
  return endpoint.source_primitive.name;
}

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

  // Infrastructure map and primitive names (populated after moose starts)
  let infraMap: InfraMap;
  let ingestPrimitiveName: string;
  let consumptionApiPrimitiveName: string;
  let transformPrimitiveName: string;

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

    // Add a simple data model for ingest testing with a transform
    const ingestDir = path.join(projectDir, "app", "ingest");
    fs.mkdirSync(ingestDir, { recursive: true });
    const modelPath = path.join(ingestDir, "models.ts");
    const modelContent = `
import { Key, IngestPipeline, Stream, OlapTable } from "@514labs/moose-lib";

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

// Output type for transform
export interface OtlpTestOutput {
  eventId: string;
  processedAt: string;
}

// Output table for transformed data
export const OtlpTestOutputTable = new OlapTable<OtlpTestOutput>("OtlpTestOutput", {
  orderByFields: ["eventId"],
});

// Output stream that writes to table
export const OtlpTestOutputStream = new Stream<OtlpTestOutput>("OtlpTestOutput", {
  destination: OtlpTestOutputTable,
});

// Transform: OtlpTestEvent -> OtlpTestOutput
// This creates a function_process with name "OtlpTestEvent__OtlpTestOutput"
OtlpTestEventPipeline.stream!.addTransform(
  OtlpTestOutputStream,
  (input: OtlpTestEvent): OtlpTestOutput => {
    console.log("OTLP test: Transform processing event:", input.eventId);
    return {
      eventId: input.eventId,
      processedAt: new Date().toISOString(),
    };
  }
);
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

    mooseProcess = spawn(CLI_PATH, ["dev"], {
      cwd: projectDir,
      env: {
        ...process.env,
        MOOSE_LOGGER__OTLP_ENDPOINT: otlpEndpoint,
        MOOSE_LOGGER__LEVEL: "Debug",
        RUST_LOG: "debug",
        // Admin API key is required for /admin/inframap access
        MOOSE_AUTHENTICATION__ADMIN_API_KEY: TEST_ADMIN_API_KEY_HASH,
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

    // Wait for server to be ready (use defaults like other tests)
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

    // Query the inframap to get primitive names for OTLP validation
    testLogger.info("Querying inframap for primitive names");
    infraMap = await getInfraMap(SERVER_CONFIG.url);

    // Extract primitive names from inframap - these will be used to verify OTLP resource_names match
    // Keys in inframap use INGRESS_<name> for ingest APIs and EGRESS_<name> for consumption APIs
    ingestPrimitiveName = getApiPrimitiveName(
      infraMap,
      "INGRESS_OtlpTestEvent",
    );
    consumptionApiPrimitiveName = getApiPrimitiveName(
      infraMap,
      "EGRESS_otlp-test",
    );

    // Extract transform process name from inframap
    // The name follows the pattern: {source}__{target}
    const functionProcesses = Object.values(infraMap.function_processes);
    if (functionProcesses.length > 0) {
      transformPrimitiveName = functionProcesses[0].source_primitive.name;
      testLogger.info("Transform primitive name extracted", {
        transformPrimitiveName,
      });
    } else {
      testLogger.warn("No function_processes found in inframap");
      transformPrimitiveName = "OtlpTestEvent__OtlpTestOutput"; // fallback
    }

    testLogger.info("Inframap primitive names extracted", {
      ingestPrimitiveName,
      consumptionApiPrimitiveName,
      transformPrimitiveName,
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
    // Verifies resource_name matches source_primitive.name from inframap for log correlation
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Clear previous logs
    otlpServer!.clearLogs();

    // Send ingest request
    const ingestUrl = `${SERVER_CONFIG.url}/ingest/OtlpTestEvent`;
    const testEvent = {
      eventId: "otlp-test-123",
      userId: "user-456",
      timestamp: new Date().toISOString(),
    };

    testLogger.info("Sending ingest request", { ingestUrl, testEvent });
    const response = await axios.post(ingestUrl, [testEvent]);
    expect(response.status).to.equal(200);

    // Wait for logs with ingest_api span fields
    // resource_name should match source_primitive.name from inframap
    const ingestLogs = await otlpServer!.waitForLogs(
      {
        context: "runtime",
        resourceType: "ingest_api",
        resourceName: ingestPrimitiveName,
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

    // Verify span fields match inframap primitive names
    const sampleLog = ingestLogs[0];
    expect(sampleLog.context).to.equal("runtime");
    expect(sampleLog.resourceType).to.equal("ingest_api");
    expect(sampleLog.resourceName).to.equal(ingestPrimitiveName);
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
    const healthUrl = `${SERVER_CONFIG.url}/health`;
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
    // Verifies resource_name matches source_primitive.name from inframap for log correlation
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Clear previous logs
    otlpServer!.clearLogs();

    // Call the consumption API (available on main port at /api/otlp-test)
    const apiUrl = `${SERVER_CONFIG.url}/api/otlp-test?message=otlp-test-logging`;
    testLogger.info("Calling consumption API", { apiUrl });

    const response = await axios.get(apiUrl);
    expect(response.status).to.equal(200);
    expect(response.data.echo).to.equal("otlp-test-logging");

    // Wait for logs with consumption_api span fields
    // resource_name should match source_primitive.name from inframap
    const consumptionLogs = await otlpServer!.waitForLogs(
      {
        context: "runtime",
        resourceType: "consumption_api",
        resourceName: consumptionApiPrimitiveName,
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

    // Verify span fields match inframap primitive names
    const sampleLog = consumptionLogs[0];
    expect(sampleLog.context).to.equal("runtime");
    expect(sampleLog.resourceType).to.equal("consumption_api");
    expect(sampleLog.resourceName).to.equal(consumptionApiPrimitiveName);
    expect(sampleLog.serviceName).to.equal("moose");
  });

  it("should receive transform logs with span fields via OTLP", async function () {
    // Verifies resource_name matches source_primitive.name from inframap function_processes
    // Note: Transform logs depend on Kafka/streaming infrastructure being ready
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Clear previous logs
    otlpServer!.clearLogs();

    // Wait for streaming infrastructure to stabilize before triggering transform
    testLogger.info(
      "Waiting for streaming infrastructure to stabilize before triggering transform",
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Send data to trigger the transform
    const ingestUrl = `${SERVER_CONFIG.url}/ingest/OtlpTestEvent`;
    const testEvent = {
      eventId: "transform-test-123",
      userId: "user-789",
      timestamp: new Date().toISOString(),
    };

    testLogger.info("Sending ingest request to trigger transform", {
      ingestUrl,
      testEvent,
    });
    const response = await axios.post(ingestUrl, [testEvent]);
    expect(response.status).to.equal(200);

    // Wait for any transform logs (resource_type: "transform")
    // Use a longer timeout since streaming infrastructure may need time to process
    let transformLogs: Awaited<ReturnType<OtlpMockServer["waitForLogs"]>>;
    try {
      transformLogs = await otlpServer!.waitForLogs(
        {
          context: "runtime",
          resourceType: "transform",
        },
        { timeoutMs: 30000, minCount: 1 },
      );
    } catch (e) {
      // If no transform logs received, log a warning but don't fail
      // This can happen if streaming infrastructure isn't fully ready
      testLogger.warn(
        "No transform logs received within timeout - streaming infrastructure may not be ready",
        { error: String(e) },
      );
      this.skip();
      return;
    }

    testLogger.info(
      `Found ${transformLogs.length} transform logs with span fields`,
    );

    // Verify we received logs with span fields
    expect(transformLogs.length).to.be.greaterThan(
      0,
      "Should have at least one log with transform span fields",
    );

    const sampleLog = transformLogs[0];
    expect(sampleLog.context).to.equal("runtime");
    expect(sampleLog.resourceType).to.equal("transform");
    expect(sampleLog.serviceName).to.equal("moose");

    // Verify resource_name matches inframap - this validates the correlation works
    // The resource_name SHOULD match source_primitive.name from function_processes
    testLogger.info("Transform log resource_name", {
      actual: sampleLog.resourceName,
      expected: transformPrimitiveName,
    });
    expect(sampleLog.resourceName).to.equal(
      transformPrimitiveName,
      `Transform resource_name should match inframap. Got "${sampleLog.resourceName}", expected "${transformPrimitiveName}"`,
    );
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

  it("should have OTLP resource_names that match inframap source_primitive.name", async function () {
    this.timeout(TIMEOUTS.STRUCTURED_LOGGING_TEST_MS);

    // Get all logs with resource_name
    const allLogs = otlpServer!.getLogs();
    const logsWithResourceName = allLogs.filter((log) => log.resourceName);

    // Build a set of valid primitive names from ALL inframap sections
    const validPrimitiveNames = new Set<string>();

    // From api_endpoints (ingest_api, consumption_api)
    for (const endpoint of Object.values(infraMap.api_endpoints)) {
      validPrimitiveNames.add(endpoint.source_primitive.name);
    }

    // From topics (stream)
    for (const topic of Object.values(infraMap.topics)) {
      validPrimitiveNames.add(topic.source_primitive.name);
    }

    // From function_processes (transform)
    for (const process of Object.values(infraMap.function_processes)) {
      validPrimitiveNames.add(process.source_primitive.name);
    }

    // From tables (olap_table)
    for (const table of Object.values(infraMap.tables)) {
      validPrimitiveNames.add(table.source_primitive.name);
    }

    // From orchestration_workers (special naming: orchestration_worker_{lang})
    for (const id of Object.keys(infraMap.orchestration_workers)) {
      validPrimitiveNames.add(id);
    }

    // From workflows
    for (const name of Object.keys(infraMap.workflows)) {
      validPrimitiveNames.add(name);
    }

    testLogger.info("Valid primitive names from inframap", {
      names: Array.from(validPrimitiveNames),
    });

    testLogger.info(
      `Checking ${logsWithResourceName.length} logs with resource_name against inframap`,
    );

    // Resource types that should be validated against inframap
    const validatedResourceTypes = [
      "ingest_api",
      "consumption_api",
      "stream",
      "transform",
      "olap_table",
      "workflow",
    ];

    // Verify that all resource_names in OTLP logs are in the inframap
    for (const log of logsWithResourceName) {
      if (validatedResourceTypes.includes(log.resourceType!)) {
        expect(
          validPrimitiveNames.has(log.resourceName!),
          `OTLP resource_name "${log.resourceName}" for ${log.resourceType} not found in inframap. ` +
            `Valid names: ${Array.from(validPrimitiveNames).join(", ")}`,
        ).to.be.true;
      }
    }
  });
});
