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

        // Clean up Date aggregation tables
        const dateAggTables = [
          "DateAggregationTest",
          "DateAggregationWorkflow",
        ];
        for (const table of dateAggTables) {
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
    if (expectedSchema.engine || expectedSchema.orderBy) {
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
