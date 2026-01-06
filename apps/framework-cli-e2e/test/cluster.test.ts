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
 * 6. ReplicatedMergeTree with explicit keeper_path/replica_name (no cluster) works correctly
 * 7. ReplicatedMergeTree with auto-injected params (ClickHouse Cloud mode) works correctly
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
  waitForServerStart,
  createTempTestDirectory,
  setupTypeScriptProject,
  setupPythonProject,
  cleanupTestSuite,
  performGlobalCleanup,
  cleanupClickhouseData,
  waitForInfrastructureReady,
  logger,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

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

const testLogger = logger.scope("cluster-test");

/**
 * Configuration for expected table in inframap verification
 */
interface ExpectedTableConfig {
  name: string;
  cluster: string | null;
  database: string | null;
}

/**
 * Helper function to execute code with a ClickHouse client, ensuring proper cleanup
 */
async function withClickHouseClient<T>(
  fn: (client: ReturnType<typeof createClient>) => Promise<T>,
): Promise<T> {
  const client = createClient({
    url: CLICKHOUSE_CONFIG.url,
    username: CLICKHOUSE_CONFIG.username,
    password: CLICKHOUSE_CONFIG.password,
    database: CLICKHOUSE_CONFIG.database,
  });

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Query ClickHouse to verify cluster configuration
 */
async function verifyClustersInClickHouse(
  expectedClusters: string[],
): Promise<void> {
  await withClickHouseClient(async (client) => {
    const result = await client.query({
      query: "SELECT DISTINCT cluster FROM system.clusters ORDER BY cluster",
      format: "JSONEachRow",
    });

    const clusters = await result.json<{ cluster: string }>();
    const clusterNames = clusters.map((row) => row.cluster);

    testLogger.info("Clusters found in ClickHouse:", clusterNames);

    for (const expected of expectedClusters) {
      expect(
        clusterNames,
        `Cluster '${expected}' should be configured in ClickHouse`,
      ).to.include(expected);
    }
  });
}

/**
 * Query inframap to verify cluster_name is set correctly
 */
async function verifyInfraMapClusters(
  expectedTables: ExpectedTableConfig[],
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
  testLogger.info("InfraMap response:", JSON.stringify(response_data, null, 2));

  // Handle both direct format and wrapped format
  const infraMap = response_data.infra_map || response_data;

  expect(infraMap.tables, "InfraMap should have tables field").to.exist;

  testLogger.info("InfraMap tables:", Object.keys(infraMap.tables));

  for (const expectedTable of expectedTables) {
    const database = expectedTable.database ?? CLICKHOUSE_CONFIG.database;
    const tableKey = `${database}_${expectedTable.name}`;
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
  testLogger.info("Generated cluster XML:", xmlContent);

  // Verify XML contains expected cluster definitions
  expect(xmlContent).to.include("<remote_servers>");
  expect(xmlContent).to.include("<cluster_a>");
  expect(xmlContent).to.include("<cluster_b>");
  expect(xmlContent).to.include("<shard>");
  expect(xmlContent).to.include("<replica>");
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
        testLogger.error(
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
      testLogger.info("Starting dev server...");
      const devEnv =
        config.language === "python" ?
          {
            ...process.env,
            VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
            PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
            MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
          }
        : {
            ...process.env,
            MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
          };

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
      testLogger.info("Server started, cleaning up old data...");
      await cleanupClickhouseData();
      testLogger.info("Waiting for infrastructure to be ready...");
      await waitForInfrastructureReady();
      testLogger.info("All components ready, starting tests...");
    });

    after(async function () {
      this.timeout(TIMEOUTS.CLEANUP_MS);
      await cleanupTestSuite(devProcess, TEST_PROJECT_DIR, config.appName, {
        logPrefix: config.displayName,
      });
    });

    it("should create all tables in ClickHouse", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      // Verify all tables were created in ClickHouse
      await withClickHouseClient(async (client) => {
        // Check tables in default database
        const localResult = await client.query({
          query: `SELECT name FROM system.tables WHERE database = '${CLICKHOUSE_CONFIG.database}' AND name IN ('TableA', 'TableB', 'TableC', 'TableD', 'TableE') ORDER BY name`,
          format: "JSONEachRow",
        });

        const localTables = await localResult.json<{ name: string }>();
        const localTableNames = localTables.map((t) => t.name);

        expect(localTableNames).to.deep.equal([
          "TableA",
          "TableB",
          "TableC",
          "TableD",
          "TableE",
        ]);

        // Check tables in 'analytics' database
        const analyticsResult = await client.query({
          query:
            "SELECT name FROM system.tables WHERE database = 'analytics' AND name = 'TableF' ORDER BY name",
          format: "JSONEachRow",
        });

        const analyticsTables = await analyticsResult.json<{ name: string }>();
        const analyticsTableNames = analyticsTables.map((t) => t.name);

        expect(analyticsTableNames).to.deep.equal(["TableF"]);
      });
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
        { name: "TableA", cluster: "cluster_a", database: null },
        { name: "TableB", cluster: "cluster_b", database: null },
        { name: "TableC", cluster: null, database: null },
        { name: "TableD", cluster: null, database: null },
        { name: "TableE", cluster: null, database: null },
        { name: "TableF", cluster: "cluster_a", database: "analytics" },
      ]);
    });

    it("should create clustered tables on all nodes", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      await withClickHouseClient(async (client) => {
        // TableA should exist on all nodes in cluster_a
        const resultA = await client.query({
          query: `
            SELECT hostName() as host, name
            FROM clusterAllReplicas(cluster_a, system.tables)
            WHERE database = '${CLICKHOUSE_CONFIG.database}' AND name = 'TableA'
          `,
          format: "JSONEachRow",
        });

        const nodesA = await resultA.json<{ host: string; name: string }>();
        testLogger.info(
          `TableA on cluster_a nodes:`,
          JSON.stringify(nodesA, null, 2),
        );

        expect(
          nodesA.length,
          "TableA should exist on all nodes in cluster_a (at least 2)",
        ).to.be.at.least(2);

        // TableB should exist on all nodes in cluster_b
        const resultB = await client.query({
          query: `
            SELECT hostName() as host, name
            FROM clusterAllReplicas(cluster_b, system.tables)
            WHERE database = '${CLICKHOUSE_CONFIG.database}' AND name = 'TableB'
          `,
          format: "JSONEachRow",
        });

        const nodesB = await resultB.json<{ host: string; name: string }>();
        testLogger.info(
          `TableB on cluster_b nodes:`,
          JSON.stringify(nodesB, null, 2),
        );

        expect(
          nodesB.length,
          "TableB should exist on all nodes in cluster_b (at least 2)",
        ).to.be.at.least(2);
      });
    });

    it("should create databases on all cluster nodes", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      await withClickHouseClient(async (client) => {
        // Query cluster_a to verify default database exists on all nodes
        // Using clusterAllReplicas function to query all nodes in the cluster
        const localOnClusterA = await client.query({
          query: `
            SELECT hostName() as host, name
            FROM clusterAllReplicas(cluster_a, system.databases)
            WHERE name = '${CLICKHOUSE_CONFIG.database}'
          `,
          format: "JSONEachRow",
        });

        const localNodesA = await localOnClusterA.json<{
          host: string;
          name: string;
        }>();
        testLogger.info(
          `'${CLICKHOUSE_CONFIG.database}' database on cluster_a nodes:`,
          JSON.stringify(localNodesA, null, 2),
        );

        // Should have at least 2 nodes (our multi-node setup)
        expect(
          localNodesA.length,
          `'${CLICKHOUSE_CONFIG.database}' database should exist on all nodes in cluster_a`,
        ).to.be.at.least(2);

        // All should have the database
        localNodesA.forEach((node) => {
          expect(node.name).to.equal(CLICKHOUSE_CONFIG.database);
        });

        // Repeat for cluster_b
        const localOnClusterB = await client.query({
          query: `
            SELECT hostName() as host, name
            FROM clusterAllReplicas(cluster_b, system.databases)
            WHERE name = '${CLICKHOUSE_CONFIG.database}'
          `,
          format: "JSONEachRow",
        });

        const localNodesB = await localOnClusterB.json<{
          host: string;
          name: string;
        }>();
        testLogger.info(
          `'${CLICKHOUSE_CONFIG.database}' database on cluster_b nodes:`,
          JSON.stringify(localNodesB, null, 2),
        );

        expect(
          localNodesB.length,
          `'${CLICKHOUSE_CONFIG.database}' database should exist on all nodes in cluster_b`,
        ).to.be.at.least(2);

        localNodesB.forEach((node) => {
          expect(node.name).to.equal(CLICKHOUSE_CONFIG.database);
        });

        const analyticsOnClusterA = await client.query({
          query: `
            SELECT hostName() as host, name
            FROM clusterAllReplicas(cluster_a, system.databases)
            WHERE name = 'analytics'
          `,
          format: "JSONEachRow",
        });

        const analyticsNodes = await analyticsOnClusterA.json<{
          host: string;
          name: string;
        }>();
        testLogger.info(
          `'analytics' database on cluster_a nodes:`,
          JSON.stringify(analyticsNodes, null, 2),
        );

        expect(
          analyticsNodes.length,
          "'analytics' database should exist on all nodes in cluster_a (THIS IS THE BUG FIX TEST)",
        ).to.be.at.least(2);

        analyticsNodes.forEach((node) => {
          expect(node.name).to.equal("analytics");
        });
      });
    });

    it("should create TableD with explicit keeper args and no cluster", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      // Verify TableD was created with explicit keeper_path and replica_name
      await withClickHouseClient(async (client) => {
        const result = await client.query({
          query: `SHOW CREATE TABLE TableD`,
          format: "JSONEachRow",
        });

        const data = await result.json<{ statement: string }>();
        const createStatement = data[0].statement;

        // Verify it's ReplicatedMergeTree
        expect(createStatement).to.include("ReplicatedMergeTree");
        // Verify it has explicit keeper path
        expect(createStatement).to.include(
          "/clickhouse/tables/{database}/{table}",
        );
        // Verify it has explicit replica name
        expect(createStatement).to.include("{replica}");
        // Verify it does NOT have ON CLUSTER (since no cluster is specified)
        expect(createStatement).to.not.include("ON CLUSTER");
      });
    });

    it("should create TableE with auto-injected params (ClickHouse Cloud mode)", async function () {
      this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

      // Verify TableE was created with ReplicatedMergeTree and auto-injected params
      await withClickHouseClient(async (client) => {
        const result = await client.query({
          query: `SHOW CREATE TABLE TableE`,
          format: "JSONEachRow",
        });

        const data = await result.json<{ statement: string }>();
        const createStatement = data[0].statement;

        testLogger.info(`TableE CREATE statement: ${createStatement}`);

        // Verify it's ReplicatedMergeTree
        expect(createStatement).to.include("ReplicatedMergeTree");
        // Verify it has auto-injected params (Moose injects these in dev mode)
        expect(createStatement).to.match(/ReplicatedMergeTree\(/);
        // Verify it does NOT have ON CLUSTER (no cluster specified)
        expect(createStatement).to.not.include("ON CLUSTER");
      });
    });
  });
};

// Global setup to clean Docker state from previous runs (useful for local dev)
// Github hosted runners start with a clean slate.
before(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  await performGlobalCleanup(
    "Running global setup for cluster tests - cleaning Docker state from previous runs...",
  );
});

// Global cleanup to ensure no hanging processes
after(async function () {
  this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
  await performGlobalCleanup();
});

// Test suite for Cluster Support
describe("Cluster Support E2E Tests", function () {
  // Generate test suites for each cluster configuration
  CLUSTER_CONFIGS.forEach(createClusterTestSuite);
});
