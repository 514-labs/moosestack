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

import { exec, spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient } from "@clickhouse/client";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
const setTimeoutAsync = promisify(setTimeout);
const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);

// Common test configuration
const TEST_CONFIG = {
  clickhouse: {
    url: "http://localhost:18123",
    username: "panda",
    password: "pandapass",
    database: "local",
  },
  server: {
    url: "http://localhost:4000",
    startupTimeout: 90_000,
    startupMessage:
      "Your local development server is running at: http://localhost:4000/ingest",
  },
  timestamp: 1739952000, // 2025-02-21 00:00:00 UTC
};

// Test utilities
const utils = {
  removeTestProject: (dir: string) => {
    console.log(`deleting ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  waitForServerStart: async (
    devProcess: ChildProcess,
    timeout: number,
  ): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      let serverStarted = false;
      let timeoutId: NodeJS.Timeout;

      devProcess.stdout?.on("data", async (data) => {
        const output = data.toString();
        if (!output.match(/^\n[⢹⢺⢼⣸⣇⡧⡗⡏] Starting local infrastructure$/)) {
          console.log("Dev server output:", output);
        }

        if (
          !serverStarted &&
          output.includes(TEST_CONFIG.server.startupMessage)
        ) {
          serverStarted = true;
          resolve();
        }
      });

      devProcess.stderr?.on("data", (data) => {
        console.error("Dev server stderr:", data.toString());
      });

      devProcess.on("exit", (code) => {
        console.log(`Dev process exited with code ${code}`);
        if (!serverStarted) {
          reject(new Error(`Dev process exited with code ${code}`));
        }
      });

      timeoutId = setTimeout(() => {
        if (serverStarted) return;
        console.error("Dev server did not start or complete in time");
        devProcess.kill("SIGINT");
        reject(new Error("Dev server timeout"));
      }, timeout);
    });
  },

  waitForDBWrite: async (
    devProcess: ChildProcess,
    tableName: string,
    expectedRecords: number,
    timeout: number = 30000,
  ): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      let writeConfirmed = false;
      let timeoutId: NodeJS.Timeout;
      let outputBuffer = "";
      let recordsWritten = 0;

      // Updated regex to match the new right-aligned format with 15-character action field
      const expectedMessageRegex = new RegExp(
        `\\s*\\[DB\\]\\s+(\\d+)\\s*row\\(s\\)\\s*successfully\\s*written\\s*to\\s*DB\\s*table\\s*\\(${tableName}\\)`,
        "i", // Remove 'g' flag to get proper capture groups
      );

      devProcess.stdout?.on("data", async (data) => {
        const output = data.toString();
        console.log("Dev server output:", output);

        if (!writeConfirmed) {
          // Accumulate output in buffer to handle split messages
          outputBuffer += output;

          // Keep only the last 2000 characters to prevent memory issues
          if (outputBuffer.length > 2000) {
            outputBuffer = outputBuffer.slice(-2000);
          }

          // Strip ANSI color codes before matching - try multiple patterns
          const cleanBuffer = outputBuffer
            .replace(/\x1b\[[0-9;]*m/g, "") // Standard ANSI
            .replace(/\[[\d;]*m/g, "") // Just the bracket notation
            .replace(/\[[0-9;]*m/g, ""); // Alternative pattern

          // Reset regex lastIndex for global flag
          expectedMessageRegex.lastIndex = 0;
          const match = cleanBuffer.match(expectedMessageRegex);
          if (match) {
            const actualRecords = parseInt(match[1], 10);
            recordsWritten += actualRecords;
            if (recordsWritten >= expectedRecords) {
              writeConfirmed = true;
              clearTimeout(timeoutId);
              resolve();
            }
          }
        }
      });

      devProcess.stderr?.on("data", (data) => {
        console.error("Dev server stderr:", data.toString());
      });

      timeoutId = setTimeout(() => {
        if (writeConfirmed) return;
        console.error("DB write confirmation not received in time");
        console.error("Final buffer contents (last 500 chars):");
        console.error(outputBuffer.slice(-500));
        reject(new Error("DB write timeout"));
      }, timeout);
    });
  },

  stopDevProcess: async (devProcess: ChildProcess | null): Promise<void> => {
    if (devProcess && !devProcess.killed) {
      console.log("Stopping dev process...");
      devProcess.kill("SIGINT");

      await new Promise<void>((resolve) => {
        devProcess!.on("exit", () => {
          console.log("Dev process has exited");
          resolve();
        });
      });
    }
  },
  cleanupDocker: async (projectDir: string, appName: string): Promise<void> => {
    console.log(`Cleaning up Docker resources for ${appName}...`);
    try {
      // Stop containers and remove volumes
      await execAsync(
        `docker compose -f .moose/docker-compose.yml -p ${appName} down -v`,
        { cwd: projectDir },
      );

      // Additional cleanup for any orphaned volumes
      const { stdout: volumeList } = await execAsync(
        `docker volume ls --filter name=${appName}_ --format '{{.Name}}'`,
      );

      if (volumeList.trim()) {
        const volumes = volumeList.split("\n").filter(Boolean);
        for (const volume of volumes) {
          console.log(`Removing volume: ${volume}`);
          await execAsync(`docker volume rm -f ${volume}`);
        }
      }

      console.log("Docker cleanup completed successfully");
    } catch (error) {
      console.error("Error during Docker cleanup:", error);
    }
  },

  cleanupClickhouseData: async (): Promise<void> => {
    console.log("Cleaning up ClickHouse data...");
    const client = createClient(TEST_CONFIG.clickhouse);
    try {
      // First check what tables exist
      const result = await client.query({
        query: "SHOW TABLES",
        format: "JSONEachRow",
      });
      const tables: any[] = await result.json();
      console.log(
        "Existing tables:",
        tables.map((t) => t.name),
      );

      // Clear the base table data first
      await client.command({
        query: "TRUNCATE TABLE IF EXISTS Bar",
      });
      console.log("Truncated Bar table");

      // Clear materialized view tables
      const mvTables = ["BarAggregated", "bar_aggregated"];
      for (const table of mvTables) {
        try {
          await client.command({
            query: `TRUNCATE TABLE IF EXISTS ${table}`,
          });
          console.log(`Truncated ${table} table`);
        } catch (error) {
          console.log(`Failed to truncate ${table}:`, error);
        }
      }

      console.log("ClickHouse data cleanup completed successfully");
    } catch (error) {
      console.error("Error during ClickHouse cleanup:", error);
    } finally {
      await client.close();
    }
  },

  waitForMaterializedViewUpdate: async (
    tableName: string,
    expectedRows: number,
    timeout: number = 30000,
  ): Promise<void> => {
    console.log(`Waiting for materialized view ${tableName} to update...`);
    const client = createClient(TEST_CONFIG.clickhouse);
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < timeout) {
        const result = await client.query({
          query: `SELECT COUNT(*) as count FROM ${tableName}`,
          format: "JSONEachRow",
        });
        const rows: any[] = await result.json();
        const count = parseInt(rows[0].count);

        if (count >= expectedRows) {
          console.log(
            `Materialized view ${tableName} updated with ${count} rows`,
          );
          return;
        }

        await setTimeoutAsync(1000); // Wait 1 second before checking again
      }

      throw new Error(
        `Materialized view ${tableName} did not update within ${timeout}ms`,
      );
    } finally {
      await client.close();
    }
  },

  verifyClickhouseData: async (
    tableName: string,
    eventId: string,
    primaryKeyField: string,
  ): Promise<void> => {
    const client = createClient(TEST_CONFIG.clickhouse);
    try {
      const result = await client.query({
        query: `SELECT * FROM ${tableName} WHERE ${primaryKeyField} = '${eventId}'`,
        format: "JSONEachRow",
      });
      const rows: any[] = await result.json();
      console.log(`${tableName} data:`, rows);

      expect(rows).to.have.length.greaterThan(
        0,
        `Expected at least one row in ${tableName} with ${primaryKeyField} = ${eventId}`,
      );
      expect(rows[0][primaryKeyField]).to.equal(
        eventId,
        `${primaryKeyField} in ${tableName} should match the generated UUID`,
      );
    } catch (error) {
      console.error("Error querying ClickHouse:", error);
      throw error;
    } finally {
      await client.close();
    }
  },

  verifyConsumptionApi: async (
    endpoint: string,
    expectedResponse: any,
  ): Promise<void> => {
    const response = await fetch(`${TEST_CONFIG.server.url}/api/${endpoint}`);
    if (response.ok) {
      console.log("Test request sent successfully");
      const json = (await response.json()) as any[];

      // Check structure and value validation rather than exact matches
      expect(json).to.be.an("array");
      expect(json.length).to.be.at.least(1);

      json.forEach((item: any) => {
        // Verify structure - all expected keys exist
        Object.keys(expectedResponse[0]).forEach((key) => {
          expect(item).to.have.property(key);
          expect(item[key]).to.not.be.null;
        });

        // Verify rows_with_text and total_rows are greater than 1
        if (item.hasOwnProperty("rows_with_text")) {
          expect(item.rows_with_text).to.be.at.least(
            1,
            "rows_with_text should be at least 1",
          );
        }

        if (item.hasOwnProperty("total_rows")) {
          expect(item.total_rows).to.be.at.least(
            1,
            "total_rows should be at least 1",
          );
        }
      });
    } else {
      console.error("Response code:", response.status);
      const text = await response.text();
      console.error(`Test request failed: ${text}`);
      throw new Error(`${response.status}: ${text}`);
    }
  },

  verifyVersionedConsumptionApi: async (
    endpoint: string,
    expectedResponse: any,
  ): Promise<void> => {
    const response = await fetch(`${TEST_CONFIG.server.url}/api/${endpoint}`);
    if (response.ok) {
      console.log("Versioned API test request sent successfully");
      const json = (await response.json()) as any[];

      // Check structure and value validation rather than exact matches
      expect(json).to.be.an("array");
      expect(json.length).to.be.at.least(1);

      json.forEach((item: any, index: number) => {
        const expected = expectedResponse[index] || expectedResponse[0];

        // Verify structure - all expected keys exist
        Object.keys(expected).forEach((key) => {
          const expectedValue = expected[key];

          expect(item).to.have.property(key);

          if (
            typeof expectedValue === "object" &&
            expectedValue !== null &&
            !Array.isArray(expectedValue)
          ) {
            // Handle nested objects generically
            expect(item[key]).to.be.an("object");

            Object.keys(expectedValue).forEach((nestedKey) => {
              const nestedExpected = expectedValue[nestedKey];

              if (
                typeof nestedExpected === "object" &&
                nestedExpected !== null
              ) {
                // Handle nested objects like queryParams - check for either camelCase or snake_case variants
                const camelCaseKey = nestedKey;
                const snakeCaseKey = nestedKey
                  .replace(/([A-Z])/g, "_$1")
                  .toLowerCase();

                const hasCamelCase = item[key].hasOwnProperty(camelCaseKey);
                const hasSnakeCase = item[key].hasOwnProperty(snakeCaseKey);
                expect(hasCamelCase || hasSnakeCase).to.be.true;

                const nestedField =
                  item[key][camelCaseKey] || item[key][snakeCaseKey];
                expect(nestedField).to.be.an("object");
              } else {
                // Handle simple properties
                expect(item[key]).to.have.property(nestedKey);
                if (typeof nestedExpected === "string") {
                  expect(item[key][nestedKey]).to.equal(nestedExpected);
                }
              }
            });
          } else {
            expect(item[key]).to.not.be.null;
          }
        });

        // Verify rows_with_text and total_rows are greater than 1
        if (item.hasOwnProperty("rows_with_text")) {
          expect(item.rows_with_text).to.be.at.least(
            1,
            "rows_with_text should be at least 1",
          );
        }

        if (item.hasOwnProperty("total_rows")) {
          expect(item.total_rows).to.be.at.least(
            1,
            "total_rows should be at least 1",
          );
        }
      });
    } else {
      console.error("Response code:", response.status);
      const text = await response.text();
      console.error(`Versioned API test request failed: ${text}`);
      throw new Error(`${response.status}: ${text}`);
    }
  },

  verifyConsumerLogs: async (
    projectDir: string,
    expectedOutput: string[],
  ): Promise<void> => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const mooseDir = path.join(homeDir, ".moose");
    const today = new Date();
    const logFileName = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-cli.log`;
    const logPath = path.join(mooseDir, logFileName);

    console.log("Checking consumer logs in:", logPath);

    // Wait for logs to be written
    await setTimeoutAsync(2000);

    const logContent = fs.readFileSync(logPath, "utf-8");
    for (const expected of expectedOutput) {
      expect(logContent).to.include(
        expected,
        `Log should contain "${expected}"`,
      );
    }
  },
};

it("should return the dummy version in debug build", async () => {
  const { stdout } = await execAsync(`"${CLI_PATH}" --version`);
  const version = stdout.trim();
  const expectedVersion = "moose-cli 0.0.1";

  console.log("Resulting version:", version);
  console.log("Expected version:", expectedVersion);

  expect(version).to.equal(expectedVersion);
});

describe("Moose Templates", () => {
  describe("typescript template", () => {
    let devProcess: ChildProcess | null = null;
    const TEST_PROJECT_DIR = path.join(__dirname, "../temp-test-project-ts");

    before(async function () {
      this.timeout(120_000);
      try {
        await fs.promises.access(CLI_PATH, fs.constants.F_OK);
      } catch (err) {
        console.error(
          `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
        );
        throw err;
      }

      if (fs.existsSync(TEST_PROJECT_DIR)) {
        utils.removeTestProject(TEST_PROJECT_DIR);
      }

      // Initialize project
      console.log("Initializing TypeScript project...");
      await execAsync(
        `"${CLI_PATH}" init moose-ts-app typescript --location "${TEST_PROJECT_DIR}"`,
      );

      // Update package.json to use local moose-lib
      console.log("Updating package.json to use local moose-lib...");
      const packageJsonPath = path.join(TEST_PROJECT_DIR, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      packageJson.dependencies["@514labs/moose-lib"] = `file:${MOOSE_LIB_PATH}`;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

      // Install dependencies
      console.log("Installing dependencies...");
      await new Promise<void>((resolve, reject) => {
        const npmInstall = spawn("npm", ["install"], {
          stdio: "inherit",
          cwd: TEST_PROJECT_DIR,
        });
        npmInstall.on("close", (code) => {
          console.log(`npm install exited with code ${code}`);
          code === 0 ? resolve() : (
            reject(new Error(`npm install failed with code ${code}`))
          );
        });
      });

      // Start dev server
      console.log("Starting dev server...");
      devProcess = spawn(CLI_PATH, ["dev"], {
        stdio: "pipe",
        cwd: TEST_PROJECT_DIR,
      });

      await utils.waitForServerStart(
        devProcess,
        TEST_CONFIG.server.startupTimeout,
      );
      console.log("Server started, cleaning up old data...");
      await utils.cleanupClickhouseData();
      console.log("Waiting before running tests...");
      await setTimeoutAsync(10000);
    });

    after(async function () {
      this.timeout(30_000);
      await utils.stopDevProcess(devProcess);
      await utils.cleanupDocker(TEST_PROJECT_DIR, "moose-ts-app");
      utils.removeTestProject(TEST_PROJECT_DIR);
    });

    it("should successfully ingest data and verify through consumption API", async function () {
      const eventId = randomUUID();

      // Send multiple records to trigger batch write (batch size is likely 1000+)
      const recordsToSend = 50; // Send enough to trigger a batch
      const responses = [];

      for (let i = 0; i < recordsToSend; i++) {
        const response = await fetch(`${TEST_CONFIG.server.url}/ingest/Foo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            primaryKey: i === 0 ? eventId : randomUUID(), // Use eventId for first record for verification
            timestamp: TEST_CONFIG.timestamp,
            optionalText: `Hello world ${i}`,
          }),
        });

        if (!response.ok) {
          console.error("Response code:", response.status);
          const text = await response.text();
          console.error(`Test request failed: ${text}`);
          throw new Error(`${response.status}: ${text}`);
        }
        responses.push(response);
      }

      await utils.waitForDBWrite(devProcess!, "Bar", recordsToSend);
      await utils.verifyClickhouseData("Bar", eventId, "primaryKey");
      await utils.waitForMaterializedViewUpdate("BarAggregated", 1);
      await utils.verifyConsumptionApi(
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
      await utils.verifyVersionedConsumptionApi(
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
      await utils.verifyConsumerLogs(TEST_PROJECT_DIR, [
        "Received Foo event:",
        `Primary Key: ${eventId}`,
        "Optional Text: Hello world",
      ]);
    });
  });

  describe("python template", () => {
    let devProcess: ChildProcess | null = null;
    const TEST_PROJECT_DIR = path.join(__dirname, "../temp-test-project-py");

    before(async function () {
      this.timeout(180_000);
      try {
        await fs.promises.access(CLI_PATH, fs.constants.F_OK);
      } catch (err) {
        console.error(
          `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
        );
        throw err;
      }

      if (fs.existsSync(TEST_PROJECT_DIR)) {
        utils.removeTestProject(TEST_PROJECT_DIR);
      }

      // Initialize project
      console.log("Initializing Python project...");
      await execAsync(
        `"${CLI_PATH}" init moose-py-app python --location "${TEST_PROJECT_DIR}"`,
      );

      // Set up Python environment and install dependencies
      console.log(
        "Setting up Python virtual environment and installing dependencies...",
      );
      await new Promise<void>((resolve, reject) => {
        const setupCmd = process.platform === "win32" ? "python" : "python3";
        const venvCmd = spawn(setupCmd, ["-m", "venv", ".venv"], {
          stdio: "inherit",
          cwd: TEST_PROJECT_DIR,
        });
        venvCmd.on("close", async (code) => {
          if (code !== 0) {
            reject(new Error(`venv creation failed with code ${code}`));
            return;
          }

          // First install project dependencies from requirements.txt
          const pipReqCmd = spawn(
            process.platform === "win32" ?
              ".venv\\Scripts\\pip"
            : ".venv/bin/pip",
            ["install", "-r", "requirements.txt"],
            {
              stdio: "inherit",
              cwd: TEST_PROJECT_DIR,
            },
          );

          pipReqCmd.on("close", (reqPipCode) => {
            if (reqPipCode !== 0) {
              reject(
                new Error(
                  `requirements.txt pip install failed with code ${reqPipCode}`,
                ),
              );
              return;
            }

            // Then install the local moose lib
            const pipMooseCmd = spawn(
              process.platform === "win32" ?
                ".venv\\Scripts\\pip"
              : ".venv/bin/pip",
              ["install", "-e", MOOSE_PY_LIB_PATH],
              {
                stdio: "inherit",
                cwd: TEST_PROJECT_DIR,
              },
            );

            pipMooseCmd.on("close", (moosePipCode) => {
              if (moosePipCode !== 0) {
                reject(
                  new Error(
                    `moose lib pip install failed with code ${moosePipCode}`,
                  ),
                );
                return;
              }
              resolve();
            });
          });
        });
      });

      // Start dev server
      console.log("Starting dev server...");
      devProcess = spawn(CLI_PATH, ["dev"], {
        stdio: "pipe",
        cwd: TEST_PROJECT_DIR,
        env: {
          ...process.env,
          VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
          PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
        },
      });

      await utils.waitForServerStart(
        devProcess,
        TEST_CONFIG.server.startupTimeout,
      );
      console.log("Server started, cleaning up old data...");
      await utils.cleanupClickhouseData();
      console.log("Waiting before running tests...");
      await setTimeoutAsync(10000);
    });

    after(async function () {
      this.timeout(30_000);
      await utils.stopDevProcess(devProcess);
      await utils.cleanupDocker(TEST_PROJECT_DIR, "moose-py-app");
      utils.removeTestProject(TEST_PROJECT_DIR);
    });

    it("should successfully ingest data and verify through consumption API", async function () {
      const eventId = randomUUID();
      const response = await fetch(`${TEST_CONFIG.server.url}/ingest/foo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_key: eventId,
          baz: "QUUX",
          timestamp: TEST_CONFIG.timestamp,
          optional_text: "Hello from Python",
        }),
      });

      if (!response.ok) {
        console.error("Response code:", response.status);
        const text = await response.text();
        console.error(`Test request failed: ${text}`);
        throw new Error(`${response.status}: ${text}`);
      }

      await utils.waitForDBWrite(devProcess!, "Bar", 1);
      await utils.verifyClickhouseData("Bar", eventId, "primary_key");
      await utils.waitForMaterializedViewUpdate("bar_aggregated", 1);
      await utils.verifyConsumptionApi(
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
      await utils.verifyVersionedConsumptionApi(
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
      await utils.verifyConsumerLogs(TEST_PROJECT_DIR, [
        "Received Foo event:",
        `Primary Key: ${eventId}`,
        "Optional Text: Hello from Python",
      ]);
    });
  });
});
