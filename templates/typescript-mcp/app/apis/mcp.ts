/**
 * MCP (Model Context Protocol) Server Implementation
 *
 * This file demonstrates how to integrate an MCP server with MooseStack using:
 * - Express.js for HTTP handling
 * - express-mcp-handler for MCP protocol implementation
 * - WebApp class to mount the server at a custom path (/tools)
 * - getMooseUtils() to access ClickHouse client and query utilities
 *
 * The MCP server exposes tools that AI assistants can use to query your data.
 * This is separate from MooseStack's built-in MCP server at /mcp.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sseHandlers } from "express-mcp-handler";
import { z } from "zod";
import { WebApp, getMooseUtils } from "@514labs/moose-lib";

// Create Express application
const app = express();
app.use(express.json());

/**
 * Server factory function that creates a fresh McpServer instance for each connection.
 * This is required by the SSE handlers for proper connection isolation.
 */
const serverFactory = () => {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  /**
   * Register the query_clickhouse tool
   *
   * This tool allows AI assistants to execute read-only SQL queries
   * against your ClickHouse database through the MCP protocol.
   */
  server.registerTool(
    "query_clickhouse",
    {
      title: "Query ClickHouse Database",
      description:
        "Execute a SQL query against the ClickHouse OLAP database and return results as JSON",
      inputSchema: {
        query: z
          .string()
          .describe("SQL query to execute (SELECT statements only)"),
      },
      outputSchema: {
        rows: z
          .array(z.record(z.any()))
          .describe("Query results as array of row objects"),
        rowCount: z.number().describe("Number of rows returned"),
      },
    },
    async ({ query }) => {
      // Access MooseStack utilities from the request context
      // Note: getMooseUtils() provides access to ClickHouse client and query utilities
      // For production use, you'd want to add proper error handling and query validation

      try {
        // This is a simplified implementation for demonstration
        // In production, you'd want to add proper error handling and query validation
        const output = {
          rows: [{ result: "Query execution would happen here" }],
          rowCount: 1,
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

  return server;
};

/**
 * Create SSE handlers for MCP protocol
 *
 * This uses Server-Sent Events (SSE) for bidirectional communication:
 * - GET /: Establishes the SSE stream and returns a session ID
 * - POST /: Sends MCP messages using the session ID from the query parameter
 */
const handlers = sseHandlers(serverFactory, {
  onError: (error: Error, sessionId?: string) => {
    console.error(`[MCP Error][${sessionId || "unknown"}]`, error);
  },
  onClose: (sessionId: string) => {
    console.log(`[MCP] Session closed: ${sessionId}`);
  },
});

// Mount the SSE endpoints
app.get("/", handlers.getHandler);
app.post("/", handlers.postHandler);

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
