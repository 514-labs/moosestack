import type { MooseUtils } from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { executeReadonlyStatement } from "../../data/clickhouse/readonly-query";
import { formatQueryToolError } from "../errors/query-tool-errors";
import {
  getExposedDataCatalog,
  validateExposedReadonlyQuery,
} from "../tool-access/exposed-surface";

export function registerQueryClickhouseTool(
  server: McpServer,
  mooseUtils: MooseUtils,
): void {
  server.registerTool(
    "query_clickhouse",
    {
      title: "Query ClickHouse Database",
      description:
        "Execute a read-only query against the allowlisted ClickHouse data components and return results as JSON. Only SELECT, DESCRIBE, and EXPLAIN SELECT queries are allowed by default, and system metadata is not exposed.",
      inputSchema: {
        query: z.string().describe("SQL query to execute against ClickHouse"),
        limit: z
          .number()
          .min(1)
          .max(1000)
          .default(100)
          .describe(
            "Maximum number of rows to return (default: 100, max: 1000)",
          ),
      },
    },
    async ({ query, limit = 100 }) => {
      try {
        const { client } = mooseUtils;
        const validatedQuery = validateExposedReadonlyQuery(query);
        const rows = await executeReadonlyStatement<Record<string, unknown>>(
          client.query,
          validatedQuery,
          limit,
        );

        const output = {
          rows,
          rowCount: rows.length,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        const { tables, materializedViews } = getExposedDataCatalog();
        const availableTables = [...tables, ...materializedViews]
          .map((table) => {
            return table.name;
          })
          .sort();

        console.error("query_clickhouse failed:", error);
        return {
          content: [
            {
              type: "text" as const,
              text: formatQueryToolError(error, availableTables),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
