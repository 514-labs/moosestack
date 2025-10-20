/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Combined test file for all Moose templates.
 *
 * We keep all template tests in a single file to ensure they run sequentially.
 * This is necessary because:
 * 1. Each template test spins up the same infrastructure (Docker containers, ports, etc.)
 * 2. Running tests in parallel would cause port conflicts and resource contention
 * 3. The cleanup process for one test could interfere with another test's setup
 *
 * By keeping them in the same file, Mocha naturally runs them sequentially,
 * and we can ensure proper setup/teardown between template tests.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";

// Import constants and utilities
import {
  TIMEOUTS,
  SERVER_CONFIG,
  TEST_DATA,
  TEMPLATE_NAMES,
  APP_NAMES,
} from "./constants";

import {
  stopDevProcess,
  waitForServerStart,
  killRemainingProcesses,
  cleanupDocker,
  globalDockerCleanup,
  cleanupClickhouseData,
  waitForDBWrite,
  waitForMaterializedViewUpdate,
  verifyClickhouseData,
  withRetries,
  verifyConsumptionApi,
  verifyVersionedConsumptionApi,
  verifyConsumerLogs,
  removeTestProject,
  createTempTestDirectory,
  cleanupLeftoverTestDirectories,
  setupTypeScriptProject,
  setupPythonProject,
  getExpectedSchemas,
  validateSchemasWithDebugging,
  verifyVersionedTables,
  getAllTables,
  getTableDDL,
  // WebApp verification utilities
  verifyWebAppEndpoint,
  verifyWebAppHealth,
  verifyWebAppQuery,
  verifyWebAppPostEndpoint,
} from "./utils";
import { triggerWorkflow } from "./utils/workflow-utils";
import { geoPayloadPy, geoPayloadTs } from "./utils/geo-payload";
import { verifyTableIndexes, getTableDDL } from "./utils/database-utils";

const execAsync = promisify(require("child_process").exec);
const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => global.setTimeout(resolve, ms));

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);

const TEST_PACKAGE_MANAGER = (process.env.TEST_PACKAGE_MANAGER || "npm") as
  | "npm"
  | "pnpm"
  | "pip";

if (process.env.TEST_PACKAGE_MANAGER) {
  console.log(
    `\n🧪 Testing templates with package manager: ${TEST_PACKAGE_MANAGER}\n`,
  );
}

it("should return the dummy version in debug build", async () => {
  const { stdout } = await execAsync(`"${CLI_PATH}" --version`);
  const version = stdout.trim();
  const expectedVersion = TEST_DATA.EXPECTED_CLI_VERSION;

  console.log("Resulting version:", version);
  console.log("Expected version:", expectedVersion);

  expect(version).to.equal(expectedVersion);
});

// Template test configuration
interface TemplateTestConfig {
  templateName: string;
  displayName: string;
  projectDirSuffix: string;
  appName: string;
  language: "typescript" | "python";
  isTestsVariant: boolean;
  packageManager: "npm" | "pnpm" | "pip";
}

const TEMPLATE_CONFIGS: TemplateTestConfig[] = [
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
    displayName: `TypeScript Default Template (${TEST_PACKAGE_MANAGER})`,
    projectDirSuffix: `ts-default-${TEST_PACKAGE_MANAGER}`,
    appName: APP_NAMES.TYPESCRIPT_DEFAULT,
    language: "typescript",
    isTestsVariant: false,
    packageManager: TEST_PACKAGE_MANAGER,
  },
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_TESTS,
    displayName: `TypeScript Tests Template (${TEST_PACKAGE_MANAGER})`,
    projectDirSuffix: `ts-tests-${TEST_PACKAGE_MANAGER}`,
    appName: APP_NAMES.TYPESCRIPT_TESTS,
    language: "typescript",
    isTestsVariant: true,
    packageManager: TEST_PACKAGE_MANAGER,
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_DEFAULT,
    displayName: "Python Default Template",
    projectDirSuffix: "py-default",
    appName: APP_NAMES.PYTHON_DEFAULT,
    language: "python",
    isTestsVariant: false,
    packageManager: "pip",
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_TESTS,
    displayName: "Python Tests Template",
    projectDirSuffix: "py-tests",
    appName: APP_NAMES.PYTHON_TESTS,
    language: "python",
    isTestsVariant: true,
    packageManager: "pip",
  },
];

const createTemplateTestSuite = (config: TemplateTestConfig) => {
  const testName =
    config.isTestsVariant ?
      `${config.language} template tests`
    : `${config.language} template default`;

  describe(testName, () => {
    let devProcess: ChildProcess | null = null;
    let TEST_PROJECT_DIR: string;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);
      try {
        await fs.promises.access(CLI_PATH, fs.constants.F_OK);
      } catch (err) {
        console.error(
          `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
        );
        throw err;
      }

      // Create temporary directory for this test
      TEST_PROJECT_DIR = createTempTestDirectory(config.projectDirSuffix);

      // Setup project based on language
      if (config.language === "typescript") {
        await setupTypeScriptProject(
          TEST_PROJECT_DIR,
          config.templateName,
          CLI_PATH,
          MOOSE_LIB_PATH,
          config.appName,
          config.packageManager as "npm" | "pnpm",
        );
      } else {
        await setupPythonProject(
          TEST_PROJECT_DIR,
          config.templateName,
          CLI_PATH,
          MOOSE_PY_LIB_PATH,
          config.appName,
        );
      }

      // Start dev server
      console.log("Starting dev server...");
      const devEnv =
        config.language === "python" ?
          {
            ...process.env,
            VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
            PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
          }
        : process.env;

      devProcess = spawn(CLI_PATH, ["dev"], {
        stdio: "pipe",
        cwd: TEST_PROJECT_DIR,
        env: devEnv,
      });

      await waitForServerStart(
        devProcess,
        TIMEOUTS.SERVER_STARTUP_MS,
        SERVER_CONFIG.startupMessage,
        SERVER_CONFIG.url,
      );
      console.log("Server started, cleaning up old data...");
      await cleanupClickhouseData();
      console.log("Waiting before running tests...");
      await setTimeoutAsync(TIMEOUTS.PRE_TEST_WAIT_MS);
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      try {
        console.log(`Starting cleanup for ${config.displayName} test...`);
        await stopDevProcess(devProcess);
        await cleanupDocker(TEST_PROJECT_DIR, config.appName);
        removeTestProject(TEST_PROJECT_DIR);
        console.log(`Cleanup completed for ${config.displayName} test`);
      } catch (error) {
        console.error("Error during cleanup:", error);
        // Force cleanup even if some steps fail
        try {
          if (devProcess && !devProcess.killed) {
            devProcess.kill("SIGKILL");
          }
        } catch (killError) {
          console.error("Error killing process:", killError);
        }
        removeTestProject(TEST_PROJECT_DIR);
      }
    });

    // Schema validation test - runs for all templates
    it("should create tables with correct schema structure", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      console.log(`Validating schema for ${config.displayName}...`);

      // Get expected schemas for this template
      const expectedSchemas = getExpectedSchemas(
        config.language,
        config.isTestsVariant,
      );

      // Validate all table schemas with debugging
      const validationResult =
        await validateSchemasWithDebugging(expectedSchemas);

      // Assert that all schemas are valid
      if (!validationResult.valid) {
        const failedTables = validationResult.results
          .filter((r) => !r.valid)
          .map((r) => r.tableName)
          .join(", ");
        throw new Error(`Schema validation failed for tables: ${failedTables}`);
      }

      console.log(`✅ Schema validation passed for ${config.displayName}`);
    });

    it("should include TTL in DDL when configured", async function () {
      if (config.isTestsVariant) {
        const ddl = await getTableDDL("TTLTable");
        if (!ddl.includes("TTL timestamp + toIntervalDay(90)")) {
          throw new Error(
            `Schema validation failed for tables TTLTable: ${ddl}`,
          );
        }
        if (!ddl.includes("`email` String TTL timestamp + toIntervalDay(30)")) {
          throw new Error(
            `Schema validation failed for tables TTLTable: ${ddl}`,
          );
        }
      }
    });

    // Add versioned tables test for tests templates
    if (config.isTestsVariant) {
      it("should create versioned OlapTables correctly", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Verify that both versions of UserEvents tables are created
        await verifyVersionedTables("UserEvents", ["1.0", "2.0"]);
      });

      it("should create indexes defined in templates", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // TypeScript and Python tests both define an IndexTest / IndexTest table
        // Verify that all seven test indexes are present in the DDL
        await verifyTableIndexes("IndexTest", [
          "idx1",
          "idx2",
          "idx3",
          "idx4",
          "idx5",
          "idx6",
          "idx7",
        ]);
      });

      it("should plan/apply index modifications on existing tables", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Modify a template file in place to change an index definition
        const modelPath = path.join(
          TEST_PROJECT_DIR,
          "app",
          "ingest",
          config.language === "typescript" ? "models.ts" : "models.py",
        );
        let contents = await fs.promises.readFile(modelPath, "utf8");

        contents = contents
          .replace("granularity: 3", "granularity: 4")
          .replace("granularity=3", "granularity=4");
        await fs.promises.writeFile(modelPath, contents, "utf8");

        // Verify DDL reflects updated index
        await withRetries(
          async () => {
            const ddl = await getTableDDL("IndexTest");
            if (!ddl.includes("INDEX idx1") || !ddl.includes("GRANULARITY 4")) {
              throw new Error(`idx1 not updated to GRANULARITY 4. DDL: ${ddl}`);
            }
          },
          { attempts: 10, delayMs: 1000 },
        );
      });
    }

    // Create test case based on language
    if (config.language === "typescript") {
      it("should successfully ingest data and verify through consumption API (DateTime support)", async function () {
        const eventId = randomUUID();

        // Send multiple records to trigger batch write
        const recordsToSend = TEST_DATA.BATCH_RECORD_COUNT;
        for (let i = 0; i < recordsToSend; i++) {
          await withRetries(
            async () => {
              const response = await fetch(`${SERVER_CONFIG.url}/ingest/Foo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  primaryKey: i === 0 ? eventId : randomUUID(),
                  timestamp: TEST_DATA.TIMESTAMP,
                  optionalText: `Hello world ${i}`,
                }),
              });
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
        }

        await triggerWorkflow("generator");
        await waitForDBWrite(devProcess!, "Bar", recordsToSend);
        await verifyClickhouseData("Bar", eventId, "primaryKey");
        await waitForMaterializedViewUpdate("BarAggregated", 1);
        await verifyConsumptionApi(
          "bar?orderBy=totalRows&startDay=19&endDay=19&limit=1",
          [
            {
              // output_format_json_quote_64bit_integers is true by default in ClickHouse
              dayOfMonth: "19",
              totalRows: "1",
            },
          ],
        );

        // Test versioned API (V1)
        await verifyVersionedConsumptionApi(
          "bar/1?orderBy=totalRows&startDay=19&endDay=19&limit=1",
          [
            {
              dayOfMonth: "19",
              totalRows: "1",
              metadata: {
                version: "1.0",
                queryParams: {
                  orderBy: "totalRows",
                  limit: 1,
                  startDay: 19,
                  endDay: 19,
                },
              },
            },
          ],
        );

        // Verify consumer logs
        await verifyConsumerLogs(TEST_PROJECT_DIR, [
          "Received Foo event:",
          `Primary Key: ${eventId}`,
          "Optional Text: Hello world",
        ]);

        if (config.isTestsVariant) {
          await verifyConsumerLogs(TEST_PROJECT_DIR, [
            "from_http",
            "from_send",
          ]);
        }
      });
      if (config.isTestsVariant) {
        it("should ingest geometry types into a single GeoTypes table (TS)", async function () {
          const id = randomUUID();
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/GeoTypes`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(geoPayloadTs(id)),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
          await waitForDBWrite(devProcess!, "GeoTypes", 1);
          await verifyClickhouseData("GeoTypes", id, "id");
        });

        it("should serve WebApp at custom mountPath with Express framework", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Test Express WebApp health endpoint
          await verifyWebAppHealth("/express", "bar-express-api");

          // Test Express WebApp query endpoint (GET)
          await verifyWebAppQuery("/express/query", { limit: "5" });

          // Test Express WebApp data endpoint (POST)
          await verifyWebAppPostEndpoint(
            "/express/data",
            {
              orderBy: "totalRows",
              limit: 5,
              startDay: 1,
              endDay: 31,
            },
            200,
            (json) => {
              if (!json.success) {
                throw new Error("Expected success to be true");
              }
              if (!Array.isArray(json.data)) {
                throw new Error("Expected data to be an array");
              }
              if (json.params.orderBy !== "totalRows") {
                throw new Error("Expected orderBy to be totalRows");
              }
            },
          );
        });

        it("should handle multiple WebApp endpoints independently", async function () {
          this.timeout(TIMEOUTS.TEST_SETUP_MS);

          // Verify Express WebApp is accessible
          await verifyWebAppEndpoint("/express/health", 200);

          // Verify regular Api endpoint still works alongside WebApp
          const apiResponse = await fetch(
            `${SERVER_CONFIG.url}/api/bar?orderBy=totalRows&startDay=1&endDay=31&limit=5`,
          );
          expect(apiResponse.ok).to.be.true;
          const apiData = await apiResponse.json();
          expect(apiData).to.be.an("array");
        });
      }
    } else {
      it("should successfully ingest data and verify through consumption API", async function () {
        const eventId = randomUUID();
        await withRetries(
          async () => {
            const response = await fetch(`${SERVER_CONFIG.url}/ingest/foo`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                primary_key: eventId,
                baz: "QUUX",
                timestamp: TEST_DATA.TIMESTAMP,
                optional_text: "Hello from Python",
              }),
            });
            if (!response.ok) {
              const text = await response.text();
              throw new Error(`${response.status}: ${text}`);
            }
          },
          { attempts: 5, delayMs: 500 },
        );
        await triggerWorkflow("generator");
        await waitForDBWrite(devProcess!, "Bar", 1);
        await verifyClickhouseData("Bar", eventId, "primary_key");
        await waitForMaterializedViewUpdate("bar_aggregated", 1);
        await verifyConsumptionApi(
          "bar?order_by=total_rows&start_day=19&end_day=19&limit=1",
          [
            {
              day_of_month: 19,
              total_rows: 1,
              rows_with_text: 1,
              max_text_length: 17,
              total_text_length: 17,
            },
          ],
        );

        // Test versioned API (V1)
        await verifyVersionedConsumptionApi(
          "bar/1?order_by=total_rows&start_day=19&end_day=19&limit=1",
          [
            {
              day_of_month: 19,
              total_rows: 1,
              rows_with_text: 1,
              max_text_length: 17,
              total_text_length: 17,
              metadata: {
                version: "1.0",
                query_params: {
                  order_by: "total_rows",
                  limit: 1,
                  start_day: 19,
                  end_day: 19,
                },
              },
            },
          ],
        );

        // Verify consumer logs
        await verifyConsumerLogs(TEST_PROJECT_DIR, [
          "Received Foo event:",
          `Primary Key: ${eventId}`,
          "Optional Text: Hello from Python",
        ]);

        if (config.isTestsVariant) {
          await verifyConsumerLogs(TEST_PROJECT_DIR, [
            "from_http",
            "from_send",
          ]);
        }
      });
      if (config.isTestsVariant) {
        it("should ingest geometry types into a single GeoTypes table (PY)", async function () {
          const id = randomUUID();
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/geotypes`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(geoPayloadPy(id)),
                },
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`${response.status}: ${text}`);
              }
            },
            { attempts: 5, delayMs: 500 },
          );
          await waitForDBWrite(devProcess!, "GeoTypes", 1);
          await verifyClickhouseData("GeoTypes", id, "id");
        });
      }
    }
  });
};

describe("Moose Templates", () => {
  // Generate test suites for all template configurations
  TEMPLATE_CONFIGS.forEach(createTemplateTestSuite);
});

// Global cleanup to ensure no hanging processes
after(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  console.log("Running global cleanup...");

  try {
    // Kill any remaining moose-cli processes
    await killRemainingProcesses();

    // Clean up any remaining Docker resources
    await globalDockerCleanup();

    // Clean up any leftover test directories
    cleanupLeftoverTestDirectories();

    console.log("Global cleanup completed");
  } catch (error) {
    console.warn("Error during global cleanup:", error);
  }
});
