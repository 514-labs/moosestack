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

import { type MooseUtils, WebApp } from "@514labs/moose-lib";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod/v3";
import { executeReadonlyStatement } from "../query/clickhouse";
import {
  getTenantMooseContext,
  requireTenantMoose,
  respondUnauthorized,
} from "./request-context";
import {
  formatExposedCatalogDetailed,
  formatExposedCatalogSummary,
  getExposedDataCatalog,
  validateExposedReadonlyQuery,
} from "./tool-access";

// Bedrock tool schemas are stricter than Anthropic/OpenAI. Keep these as
// string inputs with manual validation instead of z.enum() so the MCP tool
// schemas stay portable across providers.
const CATALOG_COMPONENT_TYPES = ["tables", "materialized_views"] as const;
const CATALOG_FORMATS = ["summary", "detailed"] as const;

type CatalogComponentType = (typeof CATALOG_COMPONENT_TYPES)[number];
type CatalogFormat = (typeof CATALOG_FORMATS)[number];

function parseCatalogComponentType(
  value: string | undefined,
): CatalogComponentType | undefined {
  if (!value) {
    return undefined;
  }

  if (CATALOG_COMPONENT_TYPES.includes(value as CatalogComponentType)) {
    return value as CatalogComponentType;
  }

  throw new Error(
    `Invalid component_type: ${value}. Allowed values: ${CATALOG_COMPONENT_TYPES.join(", ")}.`,
  );
}

function parseCatalogFormat(value: string | undefined): CatalogFormat {
  if (!value) {
    return "summary";
  }

  if (CATALOG_FORMATS.includes(value as CatalogFormat)) {
    return value as CatalogFormat;
  }

  throw new Error(
    `Invalid format: ${value}. Allowed values: ${CATALOG_FORMATS.join(", ")}.`,
  );
}

// Create Express application
const app = express();
app.use(express.json());

app.use(requireTenantMoose);

/**
 * Server factory function that creates a fresh McpServer instance for each request.
 * This is required for stateless mode where each request is fully independent.
 * The mooseUtils parameter provides access to ClickHouse client and SQL helpers.
 */
const serverFactory = (mooseUtils: MooseUtils) => {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  /**
   * Register the query_clickhouse tool
   *
   * Allows AI assistants to execute read-only SQL against an explicit allowlist
   * of data components. Results are limited to max 1000 rows to prevent
   * excessive data transfer, and system metadata remains hidden by default.
   */
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
          .optional()
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
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
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
   * Allows AI to discover the explicitly exposed tables and materialized views
   * with their schema information.
   */
  server.registerTool(
    "get_data_catalog",
    {
      title: "Get Data Catalog",
      description:
        "Discover the explicitly exposed tables and materialized views available to the agent, together with their schema information. Use this before writing queries instead of inspecting system metadata.",
      inputSchema: {
        component_type: z
          .string()
          .optional()
          .describe(
            "Optional component type filter. Allowed values: tables or materialized_views.",
          ),
        search: z
          .string()
          .optional()
          .describe("Regex pattern to search for in component names"),
        format: z
          .string()
          .optional()
          .describe(
            "Optional output format. Allowed values: summary or detailed.",
          ),
      },
    },
    async ({ component_type, search, format = "summary" }) => {
      try {
        const resolvedComponentType = parseCatalogComponentType(component_type);
        const resolvedFormat = parseCatalogFormat(format);
        const { tables, materializedViews } = getExposedDataCatalog(
          resolvedComponentType,
          search,
        );

        // Format output based on requested format
        let output: string;
        if (resolvedFormat === "detailed") {
          output = formatExposedCatalogDetailed(tables, materializedViews);
        } else {
          output = formatExposedCatalogSummary(tables, materializedViews);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: output,
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
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
    const context = getTenantMooseContext(req);
    if (!context) {
      return respondUnauthorized(res);
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
    // - Tools need access to request-specific mooseUtils (ClickHouse client, etc.)
    // - The only way to pass mooseUtils to tool handlers is via closure in serverFactory()
    // - Creating the server per-request ensures each request has isolated utilities
    //
    // Performance note: Server instantiation + tool registration is lightweight.
    // The overhead is minimal compared to database queries.
    const server = serverFactory(context.moose);
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
