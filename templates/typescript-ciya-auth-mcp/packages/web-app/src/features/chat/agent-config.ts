import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, UIMessage, stepCountIs } from "ai";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { getAISystemPrompt } from "./system-prompt";
import {
  getAnthropicApiKey,
  getMcpApiToken,
  getMcpServerUrl,
} from "@/env-vars";
import type { AgentOptions } from "./types";

export async function getAnthropicAgentStreamTextOptions(
  messages: UIMessage[],
  options?: AgentOptions,
): Promise<any> {
  const apiKey = getAnthropicApiKey();

  const anthropic = createAnthropic({
    apiKey: apiKey,
  });

  // Convert UIMessages to ModelMessages for AI SDK v5
  const modelMessages = convertToModelMessages(messages);

  // Create MCP client and get tools
  const mcpServerUrl = getMcpServerUrl();
  const mcpToken = options?.token ?? getMcpApiToken();

  const mcpClient = await experimental_createMCPClient({
    name: "moose-mcp-server",
    transport: {
      type: "http",
      url: `${mcpServerUrl}/tools`,
      ...(mcpToken && {
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      }),
    },
  });

  const tools = await mcpClient.tools();

  console.log("[Agent Config] Available tools:", Object.keys(tools));

  return {
    model: anthropic("claude-haiku-4-5"),
    system: getAISystemPrompt(options?.userContext),
    messages: modelMessages,
    tools: tools,
    toolChoice: "auto",
    // Enable multi-step reasoning
    stopWhen: stepCountIs(25),
  };
}
