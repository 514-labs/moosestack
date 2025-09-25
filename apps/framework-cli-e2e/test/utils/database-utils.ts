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
