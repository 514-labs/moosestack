import { WebApp } from "@514labs/moose-lib";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  assertAuthenticatedAccessContext,
  requireAuthenticatedMoose,
  type AuthenticatedAccessContext,
} from "../auth/access-context";
import {
  tenantKnowledgeMetricsModel,
  tenantKnowledgeRecordsModel,
} from "../semantic/knowledge";
import { registerGetDataCatalogTool } from "./tools/get-data-catalog";
import { registerSemanticModelTools } from "./tools/register-semantic-model-tools";

const app = express();
app.use(express.json());
app.use(requireAuthenticatedMoose);

function createMcpServer(context: Pick<AuthenticatedAccessContext, "moose">) {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  // EXAMPLE_APP_ONLY: These registered semantic models are coupled to the
  // seeded TenantKnowledge demo model. Replace them when you swap out the
  // example data model, then search the repo for EXAMPLE_APP_ONLY to find the
  // downstream demo wiring.
  registerSemanticModelTools(
    server,
    [tenantKnowledgeMetricsModel, tenantKnowledgeRecordsModel],
    {
      queryClient: context.moose.client.query,
    },
  );
  registerGetDataCatalogTool(server);

  return server;
}

app.all("/", async (req, res) => {
  try {
    console.log(`[MCP] Handling ${req.method} request (stateless mode)`);

    const context = assertAuthenticatedAccessContext(req);

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
      "MCP server exposing access-scoped semantic query tools via Express and WebApp",
  },
});
