/**
 * MCP (Model Context Protocol) Server Implementation
 *
 * This file demonstrates how to integrate an MCP server with MooseStack using:
 * - Express.js for HTTP handling
 * - @modelcontextprotocol/sdk for MCP protocol implementation
 * - StreamableHTTPServerTransport with JSON responses (stateless mode)
 * - WebApp class to mount the server at a custom path (/tools)
 * - getMooseUtils() to access ClickHouse client and query utilities
 *
 * The MCP server exposes tools that AI assistants can use to query your data.
 * This is separate from MooseStack's built-in MCP server at /mcp.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { WebApp, getMooseUtils, ApiUtil } from "@514labs/moose-lib";

// TODO:
// auth using getMooseUtils() jwt

function clickhouseReadonlyQuery(
  client: ApiUtil["client"],
  sql: string,
  limit = 100,
): ReturnType<ApiUtil["client"]["query"]["client"]["query"]> {
  return client.query.client.query({
    query: sql,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "2",
      limit: limit.toString(),
    },
  });
}

/**
 * Query ClickHouse to get column information for a specific table
 */
async function getTableColumns(
  client: any,
  dbName: string,
  tableName: string,
): Promise<ColumnInfo[]> {
  const query = `
    SELECT
      name,
      type,
      type LIKE '%Nullable%' as nullable,
      comment
    FROM system.columns
    WHERE database = '${dbName}' AND table = '${tableName}'
    ORDER BY position
  `;

  // High limit for catalog queries - metadata tables are typically small
  const result = await clickhouseReadonlyQuery(client, query, 10000);
  const data = (await result.json()) as any[];

  return data.map((row: any) => ({
    name: row.name,
    type: row.type,
    nullable: row.nullable === 1,
    comment: row.comment || undefined,
  }));
}

/**
 * Query ClickHouse to get list of tables and materialized views in the configured database
 */
async function getTablesAndMaterializedViews(
  client: any,
  dbName: string,
  componentType?: string,
  searchPattern?: string,
): Promise<{
  tables: Array<{ name: string; engine: string }>;
  materializedViews: Array<{ name: string; engine: string }>;
}> {
  const query = `
    SELECT
      name,
      engine,
      CASE
        WHEN engine = 'MaterializedView' THEN 'materialized_view'
        ELSE 'table'
      END as component_type
    FROM system.tables
    WHERE database = '${dbName}'
    ORDER BY name
  `;

  // High limit for catalog queries - metadata tables are typically small
  const result = await clickhouseReadonlyQuery(client, query, 10000);
  const data = (await result.json()) as any[];

  let filteredData = data;

  // Apply component type filter
  if (componentType) {
    filteredData = filteredData.filter((row: any) => {
      if (componentType === "tables") return row.component_type === "table";
      if (componentType === "materialized_views")
        return row.component_type === "materialized_view";
      return true;
    });
  }

  // Apply search pattern filter
  if (searchPattern) {
    try {
      const regex = new RegExp(searchPattern, "i");
      filteredData = filteredData.filter((row: any) => regex.test(row.name));
    } catch (error) {
      console.error(`[MCP] Invalid regex pattern: ${searchPattern}`, error);
      // If regex is invalid, fall back to simple substring match
      filteredData = filteredData.filter((row: any) =>
        row.name.toLowerCase().includes(searchPattern.toLowerCase()),
      );
    }
  }

  const tables = filteredData
    .filter((row: any) => row.component_type === "table")
    .map((row: any) => ({ name: row.name, engine: row.engine }));

  const materializedViews = filteredData
    .filter((row: any) => row.component_type === "materialized_view")
    .map((row: any) => ({ name: row.name, engine: row.engine }));

  return { tables, materializedViews };
}

/**
 * Format catalog as summary (just names and column counts)
 */
async function formatCatalogSummary(
  client: any,
  dbName: string,
  tables: Array<{ name: string; engine: string }>,
  materializedViews: Array<{ name: string; engine: string }>,
): Promise<string> {
  let output = "# Data Catalog (Summary)\n\n";

  // Format tables
  if (tables.length > 0) {
    output += `## Tables (${tables.length})\n`;
    for (const table of tables) {
      const columns = await getTableColumns(client, dbName, table.name);
      output += `- ${table.name} (${columns.length} columns)\n`;
    }
    output += "\n";
  }

  // Format materialized views
  if (materializedViews.length > 0) {
    output += `## Materialized Views (${materializedViews.length})\n`;
    for (const mv of materializedViews) {
      const columns = await getTableColumns(client, dbName, mv.name);
      output += `- ${mv.name} (${columns.length} columns)\n`;
    }
    output += "\n";
  }

  if (tables.length === 0 && materializedViews.length === 0) {
    output = "No data components found matching the specified filters.";
  }

  return output;
}

/**
 * Format catalog as detailed JSON with full schema information
 */
async function formatCatalogDetailed(
  client: any,
  dbName: string,
  tables: Array<{ name: string; engine: string }>,
  materializedViews: Array<{ name: string; engine: string }>,
): Promise<string> {
  const catalog: DataCatalogResponse = {};

  // Build tables section
  if (tables.length > 0) {
    catalog.tables = {};
    for (const table of tables) {
      const columns = await getTableColumns(client, dbName, table.name);
      catalog.tables[table.name] = {
        name: table.name,
        engine: table.engine,
        columns,
      };
    }
  }

  // Build materialized views section
  if (materializedViews.length > 0) {
    catalog.materialized_views = {};
    for (const mv of materializedViews) {
      const columns = await getTableColumns(client, dbName, mv.name);
      catalog.materialized_views[mv.name] = {
        name: mv.name,
        engine: mv.engine,
        columns,
      };
    }
  }

  return JSON.stringify(catalog, null, 2);
}

/**
 * Parameters for the get_data_catalog tool
 */
interface DataCatalogParams {
  component_type?: "tables" | "materialized_views";
  search?: string;
  format?: "summary" | "detailed";
}

/**
 * Column information from ClickHouse system.columns
 */
interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
}

/**
 * Table information from ClickHouse system.tables
 */
interface TableInfo {
  name: string;
  engine: string;
  total_rows?: number;
  total_bytes?: number;
  columns: ColumnInfo[];
}

/**
 * Catalog response structure
 */
interface DataCatalogResponse {
  tables?: Record<string, TableInfo>;
  materialized_views?: Record<string, TableInfo>;
}

// Create Express application
const app = express();
app.use(express.json());

/**
 * Server factory function that creates a fresh McpServer instance for each request.
 * This is required for stateless mode where each request is fully independent.
 * The mooseUtils parameter provides access to ClickHouse client and SQL helpers.
 */
const serverFactory = (mooseUtils: ApiUtil | null) => {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  /**
   * Register the query_clickhouse tool
   *
   * Allows AI assistants to execute SQL queries against ClickHouse.
   * Results are limited to max 1000 rows to prevent excessive data transfer.
   * Security is enforced at the database level using ClickHouse readonly mode.
   */
  server.registerTool(
    "query_clickhouse",
    /**
     * Type assertion needed here due to MCP SDK type limitations.
     * The SDK expects Record<string, ZodTypeAny> but our schema structure
     * doesn't match that exact type. Runtime validation still works correctly.
     */
    {
      title: "Query ClickHouse Database",
      description:
        "Execute a read-only query against the ClickHouse OLAP database and return results as JSON. Use SELECT, SHOW, DESCRIBE, or EXPLAIN queries only. Data modification queries (INSERT, UPDATE, DELETE, ALTER, CREATE, etc.) are prohibited.",
      inputSchema: {
        query: z.string().describe("SQL query to execute against ClickHouse"),
        limit: z
          .number()
          .min(1)
          .max(1000)
          .default(100)
          .optional()
          .describe(
            "Maximum number of rows to return (default: 100, max: 1000)",
          ),
      },
      outputSchema: {
        rows: z
          .array(z.record(z.any()))
          .describe("Query results as array of row objects"),
        rowCount: z.number().describe("Number of rows returned"),
      },
    } as any,
    async ({ query, limit = 100 }) => {
      try {
        // Check if MooseStack utilities are available
        if (!mooseUtils) {
          return {
            content: [
              {
                type: "text",
                text: "Error: MooseStack utilities not available",
              },
            ],
            isError: true,
          };
        }

        const { client } = mooseUtils;

        const result = await clickhouseReadonlyQuery(
          client,
          query.trim(),
          limit,
        );

        // Parse the JSON response from ClickHouse
        const data = await result.json();
        const rows = Array.isArray(data) ? data : [];

        const output = {
          rows,
          rowCount: rows.length,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output, null, 2),
            },
          ],
          structuredContent: output,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error executing query: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  /**
   * Register the get_data_catalog tool
   *
   * Allows AI to discover available tables, views, and materialized views
   * with their schema information.
   */
  server.registerTool(
    "get_data_catalog",
    {
      title: "Get Data Catalog",
      description:
        "Discover available tables and materialized views in the ClickHouse database with their schema information. Use this to learn what data exists before writing queries.",
      inputSchema: {
        component_type: z
          .enum(["tables", "materialized_views"])
          .optional()
          .describe(
            "Filter by component type: 'tables' for regular tables, 'materialized_views' for pre-aggregated views",
          ),
        search: z
          .string()
          .optional()
          .describe("Regex pattern to search for in component names"),
        format: z
          .enum(["summary", "detailed"])
          .default("summary")
          .optional()
          .describe(
            "Output format: 'summary' shows names and column counts, 'detailed' shows full schemas",
          ),
      },
      outputSchema: {
        catalog: z.string().describe("Formatted catalog information"),
      },
    } as any,
    async ({ component_type, search, format = "summary" }) => {
      try {
        // Check if MooseStack utilities are available
        if (!mooseUtils) {
          return {
            content: [
              {
                type: "text",
                text: "Error: MooseStack utilities not available",
              },
            ],
            isError: true,
          };
        }

        const { client } = mooseUtils;
        const dbName = process.env.CLICKHOUSE_DB || "local";

        // Get filtered list of tables and materialized views
        const { tables, materializedViews } =
          await getTablesAndMaterializedViews(
            client,
            dbName,
            component_type,
            search,
          );

        // Format output based on requested format
        let output: string;
        if (format === "detailed") {
          output = await formatCatalogDetailed(
            client,
            dbName,
            tables,
            materializedViews,
          );
        } else {
          output = await formatCatalogSummary(
            client,
            dbName,
            tables,
            materializedViews,
          );
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
          structuredContent: { catalog: output },
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving data catalog: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
};

/**
 * MCP Transport Configuration
 *
 * Uses StreamableHTTPServerTransport in STATELESS mode with JSON responses.
 * - No session ID generation or tracking (sessionIdGenerator: undefined)
 * - JSON responses instead of Server-Sent Events (enableJsonResponse: true)
 * - Fresh server instance created for every request
 * - POST requests with JSON-RPC messages
 */

// Single endpoint that handles all MCP requests
app.all("/", async (req, res) => {
  try {
    console.log(`[MCP] Handling ${req.method} request (stateless mode)`);

    // Get MooseStack utilities (ClickHouse client and SQL helpers)
    const mooseUtils = getMooseUtils(req);

    if (!mooseUtils) {
      throw new Error("MooseStack utilities not available");
    }

    // Create a fresh transport and server for EVERY request (stateless)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode - no session management
      enableJsonResponse: true, // Use JSON responses instead of SSE
    });

    transport.onerror = (error: Error) => {
      console.error(`[MCP Error]`, error);
    };

    // Create a fresh MCP server instance for this request
    //
    // Why per-request instantiation?
    // - MCP transports and servers are completely decoupled
    // - Tools need access to request-specific mooseUtils (ClickHouse client, JWT, etc.)
    // - The only way to pass mooseUtils to tool handlers is via closure in serverFactory()
    // - Creating the server per-request ensures each request has isolated utilities
    //
    // Performance note: Server instantiation + tool registration is lightweight.
    // The overhead is minimal compared to database queries.
    const server = serverFactory(mooseUtils);
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP Error] Failed to handle request:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Export the WebApp instance
 *
 * This registers the Express app with MooseStack's routing system.
 * The mountPath "/tools" means this MCP server will be accessible at:
 * http://localhost:4000/tools
 *
 * Note: We use "/tools" instead of "/mcp" because MooseStack's built-in
 * MCP server already uses the /mcp endpoint.
 */
export const mcpServer = new WebApp("mcpServer", app, {
  mountPath: "/tools",
  metadata: {
    description:
      "MCP server exposing ClickHouse query tools via Express and WebApp",
  },
});
