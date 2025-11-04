/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Cluster Support E2E Tests
 *
 * Tests the ON CLUSTER functionality for ClickHouse tables in MooseStack.
 *
 * The tests verify:
 * 1. Tables are created with ON CLUSTER clause when cluster is specified
 * 2. ClickHouse clusters are properly configured from moose.config.toml
 * 3. cluster_name appears correctly in the infrastructure map
 * 4. Mixed environments (some tables with cluster, some without) work correctly
 * 5. Both TypeScript and Python SDKs support cluster configuration
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createClient } from "@clickhouse/client";

// Import constants and utilities
import {
  TIMEOUTS,
  SERVER_CONFIG,
  TEMPLATE_NAMES,
  APP_NAMES,
  CLICKHOUSE_CONFIG,
} from "./constants";

import {
  stopDevProcess,
  waitForServerStart,
  cleanupDocker,
  removeTestProject,
  createTempTestDirectory,
  setupTypeScriptProject,
  setupPythonProject,
} from "./utils";

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

// Admin API key hash for authentication
const TEST_ADMIN_HASH =
  "deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef";

/**
 * Query ClickHouse to verify cluster configuration
 */
async function verifyClustersInClickHouse(
  expectedClusters: string[],
): Promise<void> {
  const client = createClient({
    url: CLICKHOUSE_CONFIG.url,
    username: CLICKHOUSE_CONFIG.username,
    password: CLICKHOUSE_CONFIG.password,
  });

  try {
    const result = await client.query({
      query: "SELECT DISTINCT cluster FROM system.clusters ORDER BY cluster",
      format: "JSONEachRow",
    });

    const clusters = await result.json<{ cluster: string }>();
    const clusterNames = clusters.map((row) => row.cluster);

    console.log("Clusters found in ClickHouse:", clusterNames);

    for (const expected of expectedClusters) {
      expect(
        clusterNames,
        `Cluster '${expected}' should be configured in ClickHouse`,
      ).to.include(expected);
    }
  } finally {
    await client.close();
  }
}

/**
 * Query inframap to verify cluster_name is set correctly
 */
async function verifyInfraMapClusters(
  expectedTables: { name: string; cluster: string | null }[],
): Promise<void> {
  const response = await fetch(`${SERVER_CONFIG.url}/admin/inframap`, {
    headers: {
      Authorization: `Bearer ${TEST_ADMIN_HASH}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `inframap endpoint returned ${response.status}: ${errorText}`,
    );
  }

  const response_data = await response.json();
  console.log("InfraMap response:", JSON.stringify(response_data, null, 2));

  // Handle both direct format and wrapped format
  const infraMap = response_data.infra_map || response_data;

  expect(infraMap.tables, "InfraMap should have tables field").to.exist;

  console.log("InfraMap tables:", Object.keys(infraMap.tables));

  for (const expectedTable of expectedTables) {
    const tableKey = `local_${expectedTable.name}`;
    const table = infraMap.tables[tableKey];

    expect(table, `Table ${expectedTable.name} should exist in inframap`).to
      .exist;

    // Normalize undefined to null for comparison (undefined means field not present)
    const actualCluster =
      table.cluster_name === undefined ? null : table.cluster_name;
    expect(
      actualCluster,
      `Table ${expectedTable.name} should have correct cluster_name`,
    ).to.equal(expectedTable.cluster);
  }
}

/**
 * Verify that the clickhouse_clusters.xml file was generated
 */
function verifyClusterXmlGenerated(projectDir: string): void {
  const clusterXmlPath = path.join(
    projectDir,
    ".moose/clickhouse_clusters.xml",
  );

  expect(
    fs.existsSync(clusterXmlPath),
    "clickhouse_clusters.xml should be generated in .moose directory",
  ).to.be.true;

  const xmlContent = fs.readFileSync(clusterXmlPath, "utf-8");
  console.log("Generated cluster XML:", xmlContent);

  // Verify XML contains expected cluster definitions
  expect(xmlContent).to.include("<remote_servers>");
  expect(xmlContent).to.include("<cluster_a>");
  expect(xmlContent).to.include("<cluster_b>");
  expect(xmlContent).to.include("<shard>");
  expect(xmlContent).to.include("<replica>");
}

/**
 * Verify table exists in ClickHouse
 *
 * Note: ON CLUSTER is a DDL execution directive and is NOT stored in the table schema.
 * SHOW CREATE TABLE will never display ON CLUSTER, even if it was used during creation.
 * To verify cluster support, we rely on:
 * 1. The inframap showing cluster_name (preserved in our state)
 * 2. The table being successfully created (which would fail if cluster was misconfigured)
 */
async function verifyTableExists(tableName: string): Promise<void> {
  const client = createClient({
    url: CLICKHOUSE_CONFIG.url,
    username: CLICKHOUSE_CONFIG.username,
    password: CLICKHOUSE_CONFIG.password,
    database: CLICKHOUSE_CONFIG.database,
  });

  try {
    const result = await client.query({
      query: `SELECT name, engine FROM system.tables WHERE database = '${CLICKHOUSE_CONFIG.database}' AND name = '${tableName}'`,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ name: string; engine: string }>();
    expect(
      rows.length,
      `Table ${tableName} should exist in ClickHouse`,
    ).to.equal(1);
    console.log(`Table ${tableName} exists with engine: ${rows[0].engine}`);
  } finally {
    await client.close();
  }
}

/**
 * Configuration for cluster template tests
 */
interface ClusterTestConfig {
  language: "typescript" | "python";
  templateName: string;
  appName: string;
  projectDirSuffix: string;
  displayName: string;
}

const CLUSTER_CONFIGS: ClusterTestConfig[] = [
  {
    language: "typescript",
    templateName: TEMPLATE_NAMES.TYPESCRIPT_CLUSTER,
    appName: APP_NAMES.TYPESCRIPT_CLUSTER,
    projectDirSuffix: "ts-cluster",
    displayName: "TypeScript Cluster Template",
  },
  {
    language: "python",
    templateName: TEMPLATE_NAMES.PYTHON_CLUSTER,
    appName: APP_NAMES.PYTHON_CLUSTER,
    projectDirSuffix: "py-cluster",
    displayName: "Python Cluster Template",
  },
];

/**
 * Creates a test suite for a specific cluster template configuration
 */
const createClusterTestSuite = (config: ClusterTestConfig) => {
  describe(config.displayName, function () {
    let devProcess: ChildProcess | null = null;
    let TEST_PROJECT_DIR: string;

    before(async function () {
      this.timeout(TIMEOUTS.TEST_SETUP_MS);

      // Verify CLI exists
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
          "npm",
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
            MOOSE_TELEMETRY_ENABLED: "false",
            PYTHONDONTWRITEBYTECODE: "1",
          }
        : { ...process.env, MOOSE_TELEMETRY_ENABLED: "false" };

      devProcess = spawn(CLI_PATH, ["dev"], {
        cwd: TEST_PROJECT_DIR,
        stdio: "pipe",
        env: devEnv,
      });

      let serverOutput = "";
      devProcess.stdout?.on("data", (data) => {
        serverOutput += data.toString();
        process.stdout.write(data);
      });

      devProcess.stderr?.on("data", (data) => {
        serverOutput += data.toString();
        process.stderr.write(data);
      });

      // Wait for server to start
      await waitForServerStart(
        devProcess,
        TIMEOUTS.SERVER_STARTUP_MS,
        SERVER_CONFIG.startupMessage,
        SERVER_CONFIG.url,
      );
      await setTimeoutAsync(3000); // Additional wait for infrastructure setup
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);

      if (devProcess) {
        await stopDevProcess(devProcess);
        devProcess = null;
      }

      await cleanupDocker(TEST_PROJECT_DIR, config.appName);

      // Clean up test directory
      if (TEST_PROJECT_DIR && fs.existsSync(TEST_PROJECT_DIR)) {
        removeTestProject(TEST_PROJECT_DIR);
      }
    });

    it("should create tables with ON CLUSTER clauses", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      // Verify TableA and TableB were created in ClickHouse
      const client = createClient({
        url: CLICKHOUSE_CONFIG.url,
        username: CLICKHOUSE_CONFIG.username,
        password: CLICKHOUSE_CONFIG.password,
        database: CLICKHOUSE_CONFIG.database,
      });

      try {
        const result = await client.query({
          query:
            "SELECT name FROM system.tables WHERE database = 'local' AND name IN ('TableA', 'TableB', 'TableC') ORDER BY name",
          format: "JSONEachRow",
        });

        const tables = await result.json<{ name: string }>();
        const tableNames = tables.map((t) => t.name);

        expect(tableNames).to.include("TableA");
        expect(tableNames).to.include("TableB");
        expect(tableNames).to.include("TableC");
      } finally {
        await client.close();
      }
    });

    it("should configure ClickHouse clusters from moose.config.toml", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);
      await verifyClustersInClickHouse(["cluster_a", "cluster_b"]);
    });

    it("should generate clickhouse_clusters.xml file", async function () {
      verifyClusterXmlGenerated(TEST_PROJECT_DIR);
    });

    it("should show correct cluster_name in inframap", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      await verifyInfraMapClusters([
        { name: "TableA", cluster: "cluster_a" },
        { name: "TableB", cluster: "cluster_b" },
        { name: "TableC", cluster: null },
      ]);
    });

    it("should create tables successfully with cluster configuration", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      // Verify tables were created successfully
      // (If cluster was misconfigured, table creation would have failed)
      await verifyTableExists("TableA");
      await verifyTableExists("TableB");
      await verifyTableExists("TableC");
    });
  });
};

// Test suite for Cluster Support
describe("Cluster Support E2E Tests", function () {
  // Generate test suites for each cluster configuration
  CLUSTER_CONFIGS.forEach(createClusterTestSuite);
});
