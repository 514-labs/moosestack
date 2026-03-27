import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { McpServerUnavailableError } from "../errors.js";
import type { AgentTools, MCPClient } from "../utils/sdk-types.js";
import { resolveMcpServerUrl } from "./urls.js";

function shouldWrapMcpConnectionError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);

  if (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return false;
  }

  return true;
}

export async function closeMcpClient(client: {
  close?: () => Promise<void>;
}): Promise<void> {
  if (typeof client.close !== "function") {
    return;
  }

  await client.close().catch(() => undefined);
}

export async function createMcpTools(options: {
  bearerToken: string;
  mcpServerUrl: string;
}): Promise<{
  mcpClient: MCPClient;
  tools: AgentTools;
  resolvedMcpServerUrl: string;
}> {
  const resolvedMcpServerUrl = resolveMcpServerUrl(options.mcpServerUrl);

  let mcpClient: MCPClient;
  try {
    mcpClient = await experimental_createMCPClient({
      name: "moose-mcp-server",
      transport: {
        type: "http",
        url: resolvedMcpServerUrl,
        headers: { Authorization: `Bearer ${options.bearerToken}` },
      },
    });
  } catch (error) {
    if (shouldWrapMcpConnectionError(error)) {
      throw new McpServerUnavailableError(resolvedMcpServerUrl, error);
    }

    throw error;
  }

  try {
    const tools = await mcpClient.tools();

    return {
      mcpClient,
      tools,
      resolvedMcpServerUrl,
    };
  } catch (error) {
    await closeMcpClient(mcpClient);

    if (shouldWrapMcpConnectionError(error)) {
      throw new McpServerUnavailableError(resolvedMcpServerUrl, error);
    }

    throw error;
  }
}
