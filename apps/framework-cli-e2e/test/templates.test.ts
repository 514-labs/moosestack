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
} from "./utils";
import { triggerWorkflow } from "./utils/workflow-utils";

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
}

const TEMPLATE_CONFIGS: TemplateTestConfig[] = [
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_DEFAULT,
    displayName: "TypeScript Default Template",
    projectDirSuffix: "ts-default",
    appName: APP_NAMES.TYPESCRIPT_DEFAULT,
    language: "typescript",
    isTestsVariant: false,
  },
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_TESTS,
    displayName: "TypeScript Tests Template",
    projectDirSuffix: "ts-tests",
    appName: APP_NAMES.TYPESCRIPT_TESTS,
    language: "typescript",
    isTestsVariant: true,
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_DEFAULT,
    displayName: "Python Default Template",
    projectDirSuffix: "py-default",
    appName: APP_NAMES.PYTHON_DEFAULT,
    language: "python",
    isTestsVariant: false,
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_TESTS,
    displayName: "Python Tests Template",
    projectDirSuffix: "py-tests",
    appName: APP_NAMES.PYTHON_TESTS,
    language: "python",
    isTestsVariant: true,
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
          const isoTs = new Date(TEST_DATA.TIMESTAMP * 1000).toISOString();
          const id = randomUUID();
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/GeoTypes`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id,
                    timestamp: isoTs,
                    point: [10, 20],
                    ring: [
                      [10, 20],
                      [11, 21],
                      [12, 22],
                    ],
                    lineString: [
                      [0, 0],
                      [1, 1],
                      [2, 3],
                    ],
                    multiLineString: [
                      [
                        [0, 0],
                        [1, 1],
                      ],
                      [
                        [2, 2],
                        [3, 3],
                      ],
                    ],
                    polygon: [
                      [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                        [0, 0],
                      ],
                    ],
                    multiPolygon: [
                      [
                        [
                          [0, 0],
                          [1, 0],
                          [1, 1],
                          [0, 1],
                          [0, 0],
                        ],
                      ],
                      [
                        [
                          [2, 2],
                          [3, 2],
                          [3, 3],
                          [2, 3],
                          [2, 2],
                        ],
                      ],
                    ],
                  }),
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
          const ts = TEST_DATA.TIMESTAMP;
          await withRetries(
            async () => {
              const response = await fetch(
                `${SERVER_CONFIG.url}/ingest/geotypes`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id,
                    timestamp: ts,
                    point: [10, 20],
                    ring: [
                      [10, 20],
                      [11, 21],
                      [12, 22],
                    ],
                    line_string: [
                      [0, 0],
                      [1, 1],
                      [2, 3],
                    ],
                    multi_line_string: [
                      [
                        [0, 0],
                        [1, 1],
                      ],
                      [
                        [2, 2],
                        [3, 3],
                      ],
                    ],
                    polygon: [
                      [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                        [0, 0],
                      ],
                    ],
                    multi_polygon: [
                      [
                        [
                          [0, 0],
                          [1, 0],
                          [1, 1],
                          [0, 1],
                          [0, 0],
                        ],
                      ],
                      [
                        [
                          [2, 2],
                          [3, 2],
                          [3, 3],
                          [2, 3],
                          [2, 2],
                        ],
                      ],
                    ],
                  }),
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
