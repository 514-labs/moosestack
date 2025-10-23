import { createClient } from "@clickhouse/client";
import { ChildProcess } from "child_process";
import { CLICKHOUSE_CONFIG, RETRY_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";

/**
 * Cleans up ClickHouse data by truncating test tables
 */
export const cleanupClickhouseData = async (): Promise<void> => {
  console.log("Cleaning up ClickHouse data...");
  await withRetries(
    async () => {
      const client = createClient(CLICKHOUSE_CONFIG);
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
    {
      attempts: RETRY_CONFIG.DEFAULT_ATTEMPTS,
      delayMs: RETRY_CONFIG.DEFAULT_DELAY_MS,
    },
  );
  console.log("ClickHouse data cleanup completed successfully");
};

/**
 * Waits for database write operations to complete
 */
export const waitForDBWrite = async (
  _devProcess: ChildProcess,
  tableName: string,
  expectedRecords: number,
  timeout: number = 60_000,
): Promise<void> => {
  const attempts = Math.ceil(timeout / 1000); // Convert timeout to attempts (1 second per attempt)
  await withRetries(
    async () => {
      const client = createClient(CLICKHOUSE_CONFIG);
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
    { attempts, delayMs: RETRY_CONFIG.DB_WRITE_DELAY_MS, backoffFactor: 1 }, // Linear backoff
  );
};

/**
 * Waits for materialized view to update with expected data
 */
export const waitForMaterializedViewUpdate = async (
  tableName: string,
  expectedRows: number,
  timeout: number = 60_000,
): Promise<void> => {
  console.log(`Waiting for materialized view ${tableName} to update...`);
  const attempts = Math.ceil(timeout / 1000); // Convert timeout to attempts (1 second per attempt)
  await withRetries(
    async () => {
      const client = createClient(CLICKHOUSE_CONFIG);
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
    { attempts, delayMs: RETRY_CONFIG.DB_WRITE_DELAY_MS, backoffFactor: 1 }, // Linear backoff
  );
};

/**
 * Verifies data exists in ClickHouse with specific criteria
 */
export const verifyClickhouseData = async (
  tableName: string,
  eventId: string,
  primaryKeyField: string,
): Promise<void> => {
  await withRetries(
    async () => {
      const client = createClient(CLICKHOUSE_CONFIG);
      try {
        const result = await client.query({
          query: `SELECT * FROM ${tableName} WHERE ${primaryKeyField} = '${eventId}'`,
          format: "JSONEachRow",
        });
        const rows: any[] = await result.json();
        console.log(`${tableName} data:`, rows);

        if (rows.length === 0) {
          throw new Error(
            `Expected at least one row in ${tableName} with ${primaryKeyField} = ${eventId}`,
          );
        }

        if (rows[0][primaryKeyField] !== eventId) {
          throw new Error(
            `${primaryKeyField} in ${tableName} should match the generated UUID`,
          );
        }
      } finally {
        await client.close();
      }
    },
    {
      attempts: 20,
      delayMs: RETRY_CONFIG.DEFAULT_DELAY_MS,
    },
  );
};

/**
 * Verifies that a specific number of records exist in ClickHouse matching the WHERE clause
 */
export const verifyRecordCount = async (
  tableName: string,
  whereClause: string,
  expectedCount: number,
): Promise<void> => {
  await withRetries(
    async () => {
      const client = createClient(CLICKHOUSE_CONFIG);
      try {
        const result = await client.query({
          query: `SELECT COUNT(*) as count FROM ${tableName} WHERE ${whereClause}`,
          format: "JSONEachRow",
        });
        const rows: any[] = await result.json();
        const actualCount = parseInt(rows[0].count, 10);

        if (actualCount !== expectedCount) {
          throw new Error(
            `Expected ${expectedCount} records in ${tableName}, but found ${actualCount}`,
          );
        }
      } finally {
        await client.close();
      }
    },
    {
      attempts: 10,
      delayMs: 1000,
    },
  );
};

// ============ SCHEMA INTROSPECTION UTILITIES ============

/**
 * Represents a ClickHouse column definition
 */
export interface ClickHouseColumn {
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
  comment: string;
  codec_expression: string;
  ttl_expression: string;
}

/**
 * Represents expected column schema for validation
 */
export interface ExpectedColumn {
  name: string;
  type: string | RegExp; // Allow regex for complex type matching
  nullable?: boolean;
  comment?: string;
}

/**
 * Represents expected table schema for validation
 */
export interface ExpectedTableSchema {
  tableName: string;
  columns: ExpectedColumn[];
  engine?: string;
  orderBy?: string[];
  orderByExpression?: string;
  sampleByExpression?: string;
}

/**
 * Gets the schema for a specific table from ClickHouse
 */
export const getTableSchema = async (
  tableName: string,
): Promise<ClickHouseColumn[]> => {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    const result = await client.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: "JSONEachRow",
    });
    const columns: ClickHouseColumn[] = await result.json();
    return columns;
  } finally {
    await client.close();
  }
};

/**
 * Gets table creation DDL to inspect engine and settings
 */
export const getTableDDL = async (tableName: string): Promise<string> => {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    const result = await client.query({
      query: `SHOW CREATE TABLE ${tableName}`,
      format: "JSONEachRow",
    });
    const rows: any[] = await result.json();
    return rows[0]?.statement || "";
  } finally {
    await client.close();
  }
};

/**
 * Verifies that the given table has indexes with the specified names present in its DDL
 */
export const verifyTableIndexes = async (
  tableName: string,
  expectedIndexNames: string[],
): Promise<void> => {
  await withRetries(
    async () => {
      const ddl = await getTableDDL(tableName);
      const missing = expectedIndexNames.filter(
        (name) => !ddl.includes(`INDEX ${name}`),
      );
      if (missing.length > 0) {
        throw new Error(
          `Missing indexes on ${tableName}: ${missing.join(", ")}. DDL: ${ddl}`,
        );
      }
    },
    {
      attempts: RETRY_CONFIG.DEFAULT_ATTEMPTS,
      delayMs: RETRY_CONFIG.DEFAULT_DELAY_MS,
    },
  );
};

/**
 * Lists all tables in the current database
 */
export const getAllTables = async (): Promise<string[]> => {
  const client = createClient(CLICKHOUSE_CONFIG);
  try {
    const result = await client.query({
      query: "SHOW TABLES",
      format: "JSONEachRow",
    });
    const tables: any[] = await result.json();
    return tables.map((t) => t.name);
  } finally {
    await client.close();
  }
};

/**
 * Validates that a table schema matches expected structure
 */
export const validateTableSchema = async (
  expectedSchema: ExpectedTableSchema,
): Promise<{ valid: boolean; errors: string[] }> => {
  const errors: string[] = [];

  try {
    // Check if table exists
    const allTables = await getAllTables();
    if (!allTables.includes(expectedSchema.tableName)) {
      errors.push(`Table '${expectedSchema.tableName}' does not exist`);
      return { valid: false, errors };
    }

    // Get actual schema
    const actualColumns = await getTableSchema(expectedSchema.tableName);
    const actualColumnMap = new Map(
      actualColumns.map((col) => [col.name, col]),
    );

    // Check each expected column
    for (const expectedCol of expectedSchema.columns) {
      const actualCol = actualColumnMap.get(expectedCol.name);

      if (!actualCol) {
        errors.push(
          `Column '${expectedCol.name}' is missing from table '${expectedSchema.tableName}'`,
        );
        continue;
      }

      // Type validation
      const expectedType = expectedCol.type;
      const actualType = actualCol.type;

      let typeMatches = false;
      if (typeof expectedType === "string") {
        // Exact string match
        typeMatches = actualType === expectedType;
      } else if (expectedType instanceof RegExp) {
        // Regex match for complex types
        typeMatches = expectedType.test(actualType);
      }

      if (!typeMatches) {
        errors.push(
          `Column '${expectedCol.name}' type mismatch: expected '${expectedType}', got '${actualType}'`,
        );
      }

      // Nullable validation
      if (expectedCol.nullable !== undefined) {
        const isNullable = actualType.includes("Nullable");
        if (expectedCol.nullable !== isNullable) {
          errors.push(
            `Column '${expectedCol.name}' nullable mismatch: expected ${expectedCol.nullable}, got ${isNullable}`,
          );
        }
      }

      // Comment validation (if specified)
      if (
        expectedCol.comment !== undefined &&
        actualCol.comment !== expectedCol.comment
      ) {
        errors.push(
          `Column '${expectedCol.name}' comment mismatch: expected '${expectedCol.comment}', got '${actualCol.comment}'`,
        );
      }
    }

    // Check for unexpected columns (optional - could be made configurable)
    const expectedColumnNames = new Set(
      expectedSchema.columns.map((col) => col.name),
    );
    for (const actualCol of actualColumns) {
      if (!expectedColumnNames.has(actualCol.name)) {
        console.warn(
          `Unexpected column '${actualCol.name}' found in table '${expectedSchema.tableName}'`,
        );
      }
    }

    // Validate table engine and settings if specified
    if (
      expectedSchema.engine ||
      expectedSchema.orderBy ||
      expectedSchema.sampleByExpression
    ) {
      const ddl = await getTableDDL(expectedSchema.tableName);

      if (
        expectedSchema.engine &&
        !ddl.includes(`ENGINE = ${expectedSchema.engine}`)
      ) {
        errors.push(
          `Table '${expectedSchema.tableName}' engine mismatch: expected '${expectedSchema.engine}'`,
        );
      }

      if (expectedSchema.orderBy) {
        const expectedOrderBy = expectedSchema.orderBy.join(", ");
        if (!ddl.includes(`ORDER BY (${expectedOrderBy})`)) {
          errors.push(
            `Table '${expectedSchema.tableName}' ORDER BY mismatch: expected '(${expectedOrderBy})'`,
          );
        }
      }

      if (expectedSchema.orderByExpression) {
        if (!ddl.includes(`ORDER BY ${expectedSchema.orderByExpression}`)) {
          errors.push(
            `Table '${expectedSchema.tableName}' ORDER BY mismatch: expected '${expectedSchema.orderByExpression}'`,
          );
        }
      }

      if (expectedSchema.sampleByExpression) {
        if (!ddl.includes(`SAMPLE BY ${expectedSchema.sampleByExpression}`)) {
          errors.push(
            `Table '${expectedSchema.tableName}' SAMPLE BY mismatch: expected '${expectedSchema.sampleByExpression}'`,
          );
        }
      }
    }
  } catch (error) {
    errors.push(
      `Error validating schema for table '${expectedSchema.tableName}': ${error}`,
    );
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validates multiple table schemas at once
 */
export const validateMultipleTableSchemas = async (
  expectedSchemas: ExpectedTableSchema[],
): Promise<{
  valid: boolean;
  results: Array<{ tableName: string; valid: boolean; errors: string[] }>;
}> => {
  const results = [];
  let allValid = true;

  for (const schema of expectedSchemas) {
    const result = await validateTableSchema(schema);
    results.push({
      tableName: schema.tableName,
      valid: result.valid,
      errors: result.errors,
    });

    if (!result.valid) {
      allValid = false;
    }
  }

  return { valid: allValid, results };
};

/**
 * Pretty prints schema validation results
 */
export const printSchemaValidationResults = (
  results: Array<{ tableName: string; valid: boolean; errors: string[] }>,
): void => {
  console.log("\n=== Schema Validation Results ===");

  for (const result of results) {
    if (result.valid) {
      console.log(`✅ ${result.tableName}: Schema validation passed`);
    } else {
      console.log(`❌ ${result.tableName}: Schema validation failed`);
      result.errors.forEach((error) => {
        console.log(`   - ${error}`);
      });
    }
  }

  console.log("================================\n");
};

/**
 * Prints actual table schemas for debugging purposes
 */
export const printActualTableSchemas = async (
  tableNames: string[],
): Promise<void> => {
  console.log("\n=== Actual Table Schemas (for debugging) ===");

  for (const tableName of tableNames) {
    try {
      const schema = await getTableSchema(tableName);
      console.log(`\n📋 Table: ${tableName}`);
      console.log("Columns:");
      schema.forEach((col) => {
        console.log(`  - ${col.name}: ${col.type}`);
      });
    } catch (error) {
      console.log(`❌ Error getting schema for ${tableName}: ${error}`);
    }
  }

  console.log("\n===============================================\n");
};

/**
 * Comprehensive schema validation with detailed debugging
 */
export const validateSchemasWithDebugging = async (
  expectedSchemas: ExpectedTableSchema[],
): Promise<{
  valid: boolean;
  results: Array<{ tableName: string; valid: boolean; errors: string[] }>;
}> => {
  // First, print all actual schemas for debugging
  const tableNames = expectedSchemas.map((s) => s.tableName);
  await printActualTableSchemas(tableNames);

  // Then run validation
  const validationResult = await validateMultipleTableSchemas(expectedSchemas);
  printSchemaValidationResults(validationResult.results);

  return validationResult;
};

/**
 * Verifies that versioned tables exist in ClickHouse
 */
export const verifyVersionedTables = async (
  baseTableName: string,
  expectedVersions: string[],
): Promise<void> => {
  console.log(`Verifying versioned tables for ${baseTableName}...`);
  await withRetries(
    async () => {
      const client = createClient(CLICKHOUSE_CONFIG);
      try {
        const result = await client.query({
          query: "SHOW TABLES",
          format: "JSONEachRow",
        });
        const tables: any[] = await result.json();
        const tableNames = tables.map((t) => t.name);
        console.log("All tables:", tableNames);

        // Check for each expected versioned table
        for (const version of expectedVersions) {
          const versionSuffix = version.replace(/\./g, "_");
          const expectedTableName = `${baseTableName}_${versionSuffix}`;

          if (!tableNames.includes(expectedTableName)) {
            throw new Error(
              `Expected versioned table ${expectedTableName} not found. Available tables: ${tableNames.join(", ")}`,
            );
          }
          console.log(`✓ Found versioned table: ${expectedTableName}`);
        }

        // Verify table structures are different by checking column counts
        const tableStructures: Record<string, number> = {};
        for (const version of expectedVersions) {
          const versionSuffix = version.replace(/\./g, "_");
          const tableName = `${baseTableName}_${versionSuffix}`;

          const descResult = await client.query({
            query: `DESCRIBE TABLE ${tableName}`,
            format: "JSONEachRow",
          });
          const columns: any[] = await descResult.json();
          tableStructures[tableName] = columns.length;
          console.log(`Table ${tableName} has ${columns.length} columns`);
        }

        // Verify that different versions have different structures (for our test case)
        const columnCounts = Object.values(tableStructures);
        if (columnCounts.length > 1) {
          // Check if at least some versions have different column counts
          const uniqueCounts = new Set(columnCounts);
          if (uniqueCounts.size === 1) {
            console.log(
              "Warning: All versioned tables have the same column count",
            );
          } else {
            console.log(
              "✓ Versioned tables have different structures as expected",
            );
          }
        }
      } finally {
        await client.close();
      }
    },
    {
      attempts: RETRY_CONFIG.DEFAULT_ATTEMPTS,
      delayMs: RETRY_CONFIG.DEFAULT_DELAY_MS,
    },
  );
};

// ============ CLICKHOUSE CONTAINER MANAGEMENT ============

const execAsync = require("util").promisify(require("child_process").exec);

export interface ClickHouseTestInstance {
  url: string;
  containerName: string;
  dbName: string;
  user: string;
  password: string;
  port: number;
  networkName: string;
}

/**
 * Spawns a standalone ClickHouse container with the same settings as moose dev
 * Uses the same image and configuration as the docker-compose template
 */
export const spawnClickHouseForMigrationTest = async (
  testName: string,
): Promise<ClickHouseTestInstance> => {
  const containerName = `moose-test-clickhouse-${testName}-${Date.now()}`;
  const dbName = `test_${testName}`;
  const user = "panda";
  const password = "pandapass";
  // Use a random port to avoid conflicts with other tests/moose dev instances
  const port = 18123 + Math.floor(Math.random() * 1000);

  console.log(
    `Spawning ClickHouse container: ${containerName} on port ${port}...`,
  );

  try {
    // Create a Docker network for this test (like docker-compose does)
    const networkName = `moose-test-network-${testName}`;
    await execAsync(`docker network create ${networkName}`);

    // Start ClickHouse Keeper first (needed for KeeperMap state storage)
    const keeperContainerName = `${containerName}-keeper`;
    const keeperPort = port + 10000; // Use a different port for Keeper

    // Start Keeper with proper config (must listen on 0.0.0.0 for network access)
    await execAsync(
      `docker run -d \
        --name ${keeperContainerName} \
        --network ${networkName} \
        --network-alias clickhouse-keeper \
        -p ${keeperPort}:9181 \
        --health-cmd "echo 'ruok' | nc localhost 9181 | grep -q 'imok'" \
        --health-interval 5s \
        --health-timeout 5s \
        --health-retries 20 \
        --health-start-period 60s \
        docker.io/clickhouse/clickhouse-keeper:25.6 \
        sh -c "mkdir -p /etc/clickhouse-keeper && cat > /etc/clickhouse-keeper/keeper_config.xml << 'EOF'
<clickhouse>
  <listen_host>0.0.0.0</listen_host>
  <keeper_server>
    <tcp_port>9181</tcp_port>
    <server_id>1</server_id>
    <log_storage_path>/var/lib/clickhouse-keeper/coordination/log</log_storage_path>
    <snapshot_storage_path>/var/lib/clickhouse-keeper/coordination/snapshots</snapshot_storage_path>
    <coordination_settings>
      <operation_timeout_ms>10000</operation_timeout_ms>
      <session_timeout_ms>30000</session_timeout_ms>
    </coordination_settings>
    <raft_configuration>
      <server>
        <id>1</id>
        <hostname>clickhouse-keeper</hostname>
        <port>9234</port>
      </server>
    </raft_configuration>
    <four_letter_word_white_list>*</four_letter_word_white_list>
  </keeper_server>
</clickhouse>
EOF
exec /entrypoint.sh"`,
    );

    // Wait for Keeper to be healthy (not just running)
    console.log("Waiting for Keeper to be healthy (may take longer in CI)...");
    let keeperHealthy = false;
    let lastStatus = "unknown";
    for (let i = 0; i < 120; i++) {
      try {
        const { stdout } = await execAsync(
          `docker inspect --format='{{.State.Health.Status}}' ${keeperContainerName}`,
        );
        const status = stdout.trim();

        // Log status changes for debugging
        if (status !== lastStatus) {
          console.log(`  Keeper health status: ${status} (${i}s elapsed)`);
          lastStatus = status;
        }

        if (status === "healthy") {
          console.log("✓ Keeper healthcheck passed");
          keeperHealthy = true;
          break;
        }
      } catch (e) {
        // Health status not available yet or container not found
        if (i % 10 === 0 && i > 0) {
          console.log(
            `  Still waiting for Keeper container... (${i}s elapsed)`,
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!keeperHealthy) {
      // Show Keeper logs for debugging
      console.error("Keeper healthcheck failed. Last status:", lastStatus);
      try {
        const { stdout: logs } = await execAsync(
          `docker logs ${keeperContainerName} 2>&1 | tail -50`,
        );
        console.error("Keeper logs (last 50 lines):", logs);
      } catch (e) {
        console.error("Could not fetch Keeper logs:", e);
      }
      throw new Error(
        `Keeper did not become healthy within 120 seconds (last status: ${lastStatus})`,
      );
    }

    // Extra wait to ensure Keeper is really stable
    // ClickHouse will try to connect during startup, so we need Keeper to be rock solid
    console.log("Giving Keeper extra time to stabilize...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Start ClickHouse with Keeper connection and keeper_map_path_prefix
    await execAsync(
      `docker run -d \
        --name ${containerName} \
        --network ${networkName} \
        -p ${port}:8123 \
        -e CLICKHOUSE_DB=${dbName} \
        -e CLICKHOUSE_USER=${user} \
        -e CLICKHOUSE_PASSWORD=${password} \
        -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
        --ulimit nofile=20000:40000 \
        docker.io/clickhouse/clickhouse-server:25.6 \
        /bin/bash -c "echo '<clickhouse><zookeeper><node><host>clickhouse-keeper</host><port>9181</port></node></zookeeper><keeper_map_path_prefix>/keeper_map_tables</keeper_map_path_prefix></clickhouse>' > /etc/clickhouse-server/config.d/keeper.xml && /entrypoint.sh"`,
    );

    // Wait for ClickHouse to be ready
    await waitForClickHouseContainerReady(port, dbName, user, password);

    console.log(`✓ ClickHouse ready at http://localhost:${port}/${dbName}`);

    return {
      url: `http://${user}:${password}@localhost:${port}/${dbName}`,
      containerName,
      dbName,
      user,
      password,
      port,
      networkName,
    };
  } catch (error) {
    console.error(
      `Failed to spawn ClickHouse container ${containerName}:`,
      error,
    );
    // Attempt cleanup if containers were created but health check failed
    try {
      await execAsync(`docker rm -f ${containerName}`);
      await execAsync(`docker rm -f ${containerName}-keeper`);
      const networkName = `moose-test-network-${testName}`;
      await execAsync(`docker network rm ${networkName}`);
    } catch (cleanupError) {
      console.warn("Failed to cleanup failed containers:", cleanupError);
    }
    throw error;
  }
};

/**
 * Waits for ClickHouse container to be ready to accept connections
 */
const waitForClickHouseContainerReady = async (
  port: number,
  dbName: string,
  user: string,
  password: string,
  maxAttempts: number = 30,
): Promise<void> => {
  console.log("Waiting for ClickHouse to be ready...");

  await withRetries(
    async () => {
      const client = createClient({
        url: `http://localhost:${port}`,
        database: dbName,
        username: user,
        password: password,
      });

      try {
        await client.query({ query: "SELECT 1" });
        console.log("✓ ClickHouse health check passed");
      } finally {
        await client.close();
      }
    },
    {
      attempts: maxAttempts,
      delayMs: RETRY_CONFIG.DEFAULT_DELAY_MS,
      backoffFactor: 1, // Linear backoff for startup
    },
  );
};

/**
 * Stops and removes ClickHouse container, Keeper container, and network
 */
export const stopClickHouseContainer = async (
  containerName: string,
  networkName?: string,
): Promise<void> => {
  console.log(`Stopping ClickHouse containers: ${containerName}...`);
  try {
    // Stop both ClickHouse and Keeper containers
    await execAsync(`docker stop ${containerName}`);
    await execAsync(`docker rm ${containerName}`);
    await execAsync(`docker stop ${containerName}-keeper`);
    await execAsync(`docker rm ${containerName}-keeper`);

    // Remove the network if provided
    if (networkName) {
      await execAsync(`docker network rm ${networkName}`);
    }

    console.log("✓ ClickHouse containers and network removed");
  } catch (error) {
    console.warn(`Failed to stop containers ${containerName}:`, error);
    // Don't throw - we want cleanup to continue even if Docker cleanup fails
  }
};

/**
 * Queries ClickHouse directly for verification (supports custom instance)
 */
export const queryClickHouseInstance = async (
  instance: ClickHouseTestInstance,
  query: string,
): Promise<any[]> => {
  const client = createClient({
    url: `http://localhost:${instance.port}`,
    database: instance.dbName,
    username: instance.user,
    password: instance.password,
  });

  try {
    const result = await client.query({ query, format: "JSONEachRow" });
    return await result.json();
  } finally {
    await client.close();
  }
};

/**
 * Executes a ClickHouse command (non-query) on custom instance
 */
export const execClickHouseCommand = async (
  instance: ClickHouseTestInstance,
  query: string,
): Promise<void> => {
  const client = createClient({
    url: `http://localhost:${instance.port}`,
    database: instance.dbName,
    username: instance.user,
    password: instance.password,
  });

  try {
    await client.command({ query });
  } finally {
    await client.close();
  }
};
