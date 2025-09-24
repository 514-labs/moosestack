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

import { exec, spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient } from "@clickhouse/client";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
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
    startupTimeout: 180_000,
    startupMessage:
      "Your local development server is running at: http://localhost:4000/ingest",
  },
  timestamp: 1739952000, // 2025-02-21 00:00:00 UTC
};

// Test utilities
const utils = {
  withRetries: async <T>(
    operation: () => Promise<T>,
    options?: { attempts?: number; delayMs?: number; backoffFactor?: number },
  ): Promise<T> => {
    const attempts = options?.attempts ?? 10;
    const backoffFactor = options?.backoffFactor ?? 1.5;
    let delayMs = options?.delayMs ?? 1000;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
        await setTimeoutAsync(delayMs);
        delayMs = Math.ceil(delayMs * backoffFactor);
      }
    }
    throw lastError as Error;
  },
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
      let timeoutId: ReturnType<typeof global.setTimeout>;
      let pingInterval: ReturnType<typeof global.setInterval> | null = null;

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
          if (pingInterval) clearInterval(pingInterval);
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

      // Fallback readiness probe: HTTP ping
      pingInterval = setInterval(async () => {
        if (serverStarted) {
          if (pingInterval) clearInterval(pingInterval);
          return;
        }
        try {
          const res = await fetch(`${TEST_CONFIG.server.url}/ingest`);
          if (res.ok || [400, 404, 405].includes(res.status)) {
            serverStarted = true;
            if (pingInterval) clearInterval(pingInterval);
            clearTimeout(timeoutId);
            resolve();
          }
        } catch (_) {
          // ignore until service is up
        }
      }, 1000);

      timeoutId = setTimeout(() => {
        if (serverStarted) return;
        console.error("Dev server did not start or complete in time");
        devProcess.kill("SIGINT");
        if (pingInterval) clearInterval(pingInterval);
        reject(new Error("Dev server timeout"));
      }, timeout);
    });
  },

  waitForDBWrite: async (
    _devProcess: ChildProcess,
    tableName: string,
    expectedRecords: number,
    timeout: number = 60_000,
  ): Promise<void> => {
    const attempts = Math.ceil(timeout / 1000); // Convert timeout to attempts (1 second per attempt)
    await utils.withRetries(
      async () => {
        const client = createClient(TEST_CONFIG.clickhouse);
        try {
          const result = await client.query({
            query: `SELECT COUNT(*) as count FROM ${tableName}`,
            format: "JSONEachRow",
          });
          const rows: any[] = await result.json();
          const count = parseInt(rows[0].count);
          console.log(`Records in ${tableName}:`, count);
          if (count >= expectedRecords) {
            return; // Success - exit retry loop
          }
          throw new Error(
            `Expected ${expectedRecords} records, but found ${count}`,
          );
        } finally {
          await client.close();
        }
      },
      { attempts, delayMs: 1000, backoffFactor: 1 }, // Linear backoff
    );
  },

  stopDevProcess: async (devProcess: ChildProcess | null): Promise<void> => {
    if (devProcess && !devProcess.killed) {
      console.log("Stopping dev process...");
      devProcess.kill("SIGINT");

      // Wait for graceful shutdown with timeout
      const gracefulShutdownPromise = new Promise<void>((resolve) => {
        devProcess!.on("exit", () => {
          console.log("Dev process has exited gracefully");
          resolve();
        });
      });

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.log("Dev process did not exit gracefully, forcing kill...");
          if (!devProcess!.killed) {
            devProcess!.kill("SIGKILL");
          }
          resolve();
        }, 10000); // 10 second timeout
      });

      // Race between graceful shutdown and timeout
      await Promise.race([gracefulShutdownPromise, timeoutPromise]);

      // Give a brief moment for cleanup after forced kill
      if (!devProcess.killed) {
        await setTimeoutAsync(1000);
      }
    }
  },
  cleanupDocker: async (projectDir: string, appName: string): Promise<void> => {
    console.log(`Cleaning up Docker resources for ${appName}...`);
    try {
      // Stop containers and remove volumes with timeout
      await Promise.race([
        execAsync(
          `docker compose -f .moose/docker-compose.yml -p ${appName} down -v`,
          { cwd: projectDir },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Docker compose down timeout")),
            30000,
          ),
        ),
      ]);

      // Additional cleanup for any orphaned volumes with timeout
      const volumeListPromise = execAsync(
        `docker volume ls --filter name=${appName}_ --format '{{.Name}}'`,
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Docker volume list timeout")),
          10000,
        ),
      );

      const { stdout: volumeList } = await Promise.race([
        volumeListPromise,
        timeoutPromise,
      ]);

      if (volumeList.trim()) {
        const volumes = volumeList.split("\n").filter(Boolean);
        for (const volume of volumes) {
          console.log(`Removing volume: ${volume}`);
          try {
            await Promise.race([
              execAsync(`docker volume rm -f ${volume}`),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("Volume removal timeout")),
                  5000,
                ),
              ),
            ]);
          } catch (volumeError) {
            console.warn(`Failed to remove volume ${volume}:`, volumeError);
          }
        }
      }

      console.log("Docker cleanup completed successfully");
    } catch (error) {
      console.error("Error during Docker cleanup:", error);
      // Don't throw - we want cleanup to continue even if Docker cleanup fails
    }
  },

  cleanupClickhouseData: async (): Promise<void> => {
    console.log("Cleaning up ClickHouse data...");
    await utils.withRetries(
      async () => {
        const client = createClient(TEST_CONFIG.clickhouse);
        try {
          const result = await client.query({
            query: "SHOW TABLES",
            format: "JSONEachRow",
          });
          const tables: any[] = await result.json();
          console.log(
            "Existing tables:",
            tables.map((t) => t.name),
          );

          await client.command({ query: "TRUNCATE TABLE IF EXISTS Bar" });
          console.log("Truncated Bar table");

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
        } finally {
          await client.close();
        }
      },
      { attempts: 10, delayMs: 1000 },
    );
    console.log("ClickHouse data cleanup completed successfully");
  },

  waitForMaterializedViewUpdate: async (
    tableName: string,
    expectedRows: number,
    timeout: number = 60_000,
  ): Promise<void> => {
    console.log(`Waiting for materialized view ${tableName} to update...`);
    const attempts = Math.ceil(timeout / 1000); // Convert timeout to attempts (1 second per attempt)
    await utils.withRetries(
      async () => {
        const client = createClient(TEST_CONFIG.clickhouse);
        try {
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
            return; // Success - exit retry loop
          }

          throw new Error(
            `Expected ${expectedRows} rows in ${tableName}, but found ${count}`,
          );
        } finally {
          await client.close();
        }
      },
      { attempts, delayMs: 1000, backoffFactor: 1 }, // Linear backoff
    );
  },

  verifyClickhouseData: async (
    tableName: string,
    eventId: string,
    primaryKeyField: string,
  ): Promise<void> => {
    await utils.withRetries(
      async () => {
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
        } finally {
          await client.close();
        }
      },
      { attempts: 20, delayMs: 1000 },
    );
  },

  verifyConsumptionApi: async (
    endpoint: string,
    expectedResponse: any,
  ): Promise<void> => {
    await utils.withRetries(
      async () => {
        const response = await fetch(
          `${TEST_CONFIG.server.url}/api/${endpoint}`,
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`${response.status}: ${text}`);
        }
        console.log("Test request sent successfully");
        const json = (await response.json()) as any[];

        expect(json).to.be.an("array");
        expect(json.length).to.be.at.least(1);

        json.forEach((item: any) => {
          Object.keys(expectedResponse[0]).forEach((key) => {
            expect(item).to.have.property(key);
            expect(item[key]).to.not.be.null;
          });

          if (item.hasOwnProperty("rows_with_text")) {
            expect(item.rows_with_text).to.be.at.least(1);
          }

          if (item.hasOwnProperty("total_rows")) {
            expect(item.total_rows).to.be.at.least(1);
          }
        });
      },
      { attempts: 10, delayMs: 1000 },
    );
  },

  verifyVersionedConsumptionApi: async (
    endpoint: string,
    expectedResponse: any,
  ): Promise<void> => {
    await utils.withRetries(
      async () => {
        const response = await fetch(
          `${TEST_CONFIG.server.url}/api/${endpoint}`,
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`${response.status}: ${text}`);
        }
        console.log("Versioned API test request sent successfully");
        const json = (await response.json()) as any[];

        expect(json).to.be.an("array");
        expect(json.length).to.be.at.least(1);

        json.forEach((item: any, index: number) => {
          const expected = expectedResponse[index] || expectedResponse[0];

          Object.keys(expected).forEach((key) => {
            const expectedValue = expected[key];
            expect(item).to.have.property(key);

            if (
              typeof expectedValue === "object" &&
              expectedValue !== null &&
              !Array.isArray(expectedValue)
            ) {
              expect(item[key]).to.be.an("object");

              Object.keys(expectedValue).forEach((nestedKey) => {
                const nestedExpected = expectedValue[nestedKey];
                if (
                  typeof nestedExpected === "object" &&
                  nestedExpected !== null
                ) {
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

          if (item.hasOwnProperty("rows_with_text")) {
            expect(item.rows_with_text).to.be.at.least(1);
          }
          if (item.hasOwnProperty("total_rows")) {
            expect(item.total_rows).to.be.at.least(1);
          }
        });
      },
      { attempts: 10, delayMs: 1000 },
    );
  },

  verifyConsumerLogs: async (
    projectDir: string,
    expectedOutput: string[],
  ): Promise<void> => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const mooseDir = path.join(homeDir, ".moose");
    const today = new Date();
    const logFileName = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-cli.log`;
    let logPath = path.join(mooseDir, logFileName);

    await utils.withRetries(
      async () => {
        if (!fs.existsSync(logPath)) {
          // Fallback: pick the most recent cli.log in ~/.moose
          const files = fs
            .readdirSync(mooseDir)
            .filter((f) => f.endsWith("-cli.log"))
            .map((f) => ({
              name: f,
              time: fs.statSync(path.join(mooseDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.time - a.time);
          if (files.length > 0) {
            logPath = path.join(mooseDir, files[0].name);
          }
        }

        console.log("Checking consumer logs in:", logPath);
        const logContent = fs.readFileSync(logPath, "utf-8");
        for (const expected of expectedOutput) {
          expect(logContent).to.include(
            expected,
            `Log should contain "${expected}"`,
          );
        }
      },
      { attempts: 10, delayMs: 1000 },
    );
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
  describe("typescript template default", () => {
    let devProcess: ChildProcess | null = null;
    const TEST_PROJECT_DIR = path.join(
      __dirname,
      "../temp-test-project-ts-default",
    );

    before(async function () {
      this.timeout(240_000);
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

      // Initialize project with default typescript template
      console.log("Initializing TypeScript project with default template...");
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
      this.timeout(90_000); // Increased timeout for cleanup
      try {
        console.log("Starting cleanup for TypeScript default template test...");
        await utils.stopDevProcess(devProcess);
        await utils.cleanupDocker(TEST_PROJECT_DIR, "moose-ts-app");
        utils.removeTestProject(TEST_PROJECT_DIR);
        console.log("Cleanup completed for TypeScript default template test");
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
        utils.removeTestProject(TEST_PROJECT_DIR);
      }
    });

    it("should successfully ingest data and verify through consumption API (DateTime support)", async function () {
      const eventId = randomUUID();

      // Send multiple records to trigger batch write (batch size is likely 1000+)
      const recordsToSend = 50; // Send enough to trigger a batch
      for (let i = 0; i < recordsToSend; i++) {
        await utils.withRetries(
          async () => {
            const response = await fetch(
              `${TEST_CONFIG.server.url}/ingest/Foo`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  primaryKey: i === 0 ? eventId : randomUUID(),
                  timestamp: TEST_CONFIG.timestamp,
                  optionalText: `Hello world ${i}`,
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

  describe("typescript template tests", () => {
    let devProcess: ChildProcess | null = null;
    const TEST_PROJECT_DIR = path.join(
      __dirname,
      "../temp-test-project-ts-tests",
    );

    before(async function () {
      this.timeout(240_000);
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

      // Initialize project with typescript-tests template
      console.log("Initializing TypeScript project with tests template...");
      await execAsync(
        `"${CLI_PATH}" init moose-ts-app typescript-tests --location "${TEST_PROJECT_DIR}"`,
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
      this.timeout(90_000); // Increased timeout for cleanup
      try {
        console.log("Starting cleanup for TypeScript tests template test...");
        await utils.stopDevProcess(devProcess);
        await utils.cleanupDocker(TEST_PROJECT_DIR, "moose-ts-app");
        utils.removeTestProject(TEST_PROJECT_DIR);
        console.log("Cleanup completed for TypeScript tests template test");
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
        utils.removeTestProject(TEST_PROJECT_DIR);
      }
    });

    it("should successfully ingest data and verify through consumption API (DateTime support)", async function () {
      const eventId = randomUUID();

      // Send multiple records to trigger batch write (batch size is likely 1000+)
      const recordsToSend = 50; // Send enough to trigger a batch
      for (let i = 0; i < recordsToSend; i++) {
        await utils.withRetries(
          async () => {
            const response = await fetch(
              `${TEST_CONFIG.server.url}/ingest/Foo`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  primaryKey: i === 0 ? eventId : randomUUID(),
                  timestamp: TEST_CONFIG.timestamp,
                  optionalText: `Hello world ${i}`,
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

  describe("python template default", () => {
    let devProcess: ChildProcess | null = null;
    const TEST_PROJECT_DIR = path.join(
      __dirname,
      "../temp-test-project-py-default",
    );

    before(async function () {
      this.timeout(240_000);
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

      // Initialize project with default python template
      console.log("Initializing Python project with default template...");
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
      this.timeout(90_000); // Increased timeout for cleanup
      try {
        console.log("Starting cleanup for Python default template test...");
        await utils.stopDevProcess(devProcess);
        await utils.cleanupDocker(TEST_PROJECT_DIR, "moose-py-app");
        utils.removeTestProject(TEST_PROJECT_DIR);
        console.log("Cleanup completed for Python default template test");
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
        utils.removeTestProject(TEST_PROJECT_DIR);
      }
    });

    it("should successfully ingest data and verify through consumption API", async function () {
      const eventId = randomUUID();
      await utils.withRetries(
        async () => {
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
            const text = await response.text();
            throw new Error(`${response.status}: ${text}`);
          }
        },
        { attempts: 5, delayMs: 500 },
      );

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

  describe("python template tests", () => {
    let devProcess: ChildProcess | null = null;
    const TEST_PROJECT_DIR = path.join(
      __dirname,
      "../temp-test-project-py-tests",
    );

    before(async function () {
      this.timeout(240_000);
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

      // Initialize project with python-tests template
      console.log("Initializing Python project with tests template...");
      await execAsync(
        `"${CLI_PATH}" init moose-py-app python-tests --location "${TEST_PROJECT_DIR}"`,
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
      this.timeout(90_000); // Increased timeout for cleanup
      try {
        console.log("Starting cleanup for Python tests template test...");
        await utils.stopDevProcess(devProcess);
        await utils.cleanupDocker(TEST_PROJECT_DIR, "moose-py-app");
        utils.removeTestProject(TEST_PROJECT_DIR);
        console.log("Cleanup completed for Python tests template test");
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
        utils.removeTestProject(TEST_PROJECT_DIR);
      }
    });

    it("should successfully ingest data and verify through consumption API", async function () {
      const eventId = randomUUID();
      await utils.withRetries(
        async () => {
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
            const text = await response.text();
            throw new Error(`${response.status}: ${text}`);
          }
        },
        { attempts: 5, delayMs: 500 },
      );

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

// Global cleanup to ensure no hanging processes
after(async function () {
  this.timeout(30_000);
  console.log("Running global cleanup...");

  try {
    // Kill any remaining moose-cli processes
    await execAsync("pkill -f moose-cli || true");
    console.log("Killed any remaining moose-cli processes");

    // Clean up any remaining Docker resources
    await execAsync("docker system prune -f --volumes || true");
    console.log("Cleaned up Docker resources");

    // Clean up any test directories that might still exist
    const testDirs = [
      "../temp-test-project-ts-default",
      "../temp-test-project-ts-tests",
      "../temp-test-project-py-default",
      "../temp-test-project-py-tests",
    ];

    for (const dir of testDirs) {
      const fullPath = path.join(__dirname, dir);
      if (fs.existsSync(fullPath)) {
        console.log(`Removing leftover test directory: ${fullPath}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

    console.log("Global cleanup completed");
  } catch (error) {
    console.warn("Error during global cleanup:", error);
  }
});
