import { WebApp } from "@514labs/moose-lib";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  assertTenantMooseContext,
  requireTenantMoose,
  type TenantMooseContext,
} from "../http/context/tenant-context";
import { registerGetDataCatalogTool } from "./tools/get-data-catalog";
import { registerQueryClickhouseTool } from "./tools/query-clickhouse";

const app = express();
app.use(express.json());
app.use(requireTenantMoose);

function createMcpServer(
  context: Pick<TenantMooseContext, "moose" | "rowPolicyOptions">,
) {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  registerQueryClickhouseTool(server, context);
  registerGetDataCatalogTool(server);

  return server;
}

app.all("/", async (req, res) => {
  try {
    console.log(`[MCP] Handling ${req.method} request (stateless mode)`);

    const context = assertTenantMooseContext(req);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    transport.onerror = (error: Error) => {
      console.error("[MCP Error]", error);
    };

    const server = createMcpServer(context);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP Error] Failed to handle request:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export const mcpServer = new WebApp("mcpServer", app, {
  mountPath: "/tools",
  metadata: {
    description:
      "MCP server exposing ClickHouse query tools via Express and WebApp",
  },
});
