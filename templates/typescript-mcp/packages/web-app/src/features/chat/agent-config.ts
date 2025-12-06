import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, UIMessage, stepCountIs } from "ai";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { getAISystemPrompt } from "./system-prompt";
import { getAnthropicApiKey, getMcpServerUrl } from "@/env-vars";

export async function getAnthropicAgentStreamTextOptions(
  messages: UIMessage[],
): Promise<any> {
  const apiKey = getAnthropicApiKey();

  const anthropic = createAnthropic({
    apiKey: apiKey,
  });

  // Convert UIMessages to ModelMessages for AI SDK v5
  const modelMessages = convertToModelMessages(messages);

  // Create MCP client and get tools
  const mcpServerUrl = getMcpServerUrl();
  const mcpApiKey = process.env.MCP_API_TOKEN;

  const mcpClient = await experimental_createMCPClient({
    name: "moose-mcp-server",
    transport: {
      type: "http",
      url: `${mcpServerUrl}/tools`,
      ...(mcpApiKey && {
        headers: { Authorization: `Bearer ${mcpApiKey}` },
      }),
    },
  });

  const tools = await mcpClient.tools();

  console.log("[Agent Config] Available tools:", Object.keys(tools));

  return {
    model: anthropic("claude-haiku-4-5"),
    system: getAISystemPrompt(),
    messages: modelMessages,
    tools: tools,
    toolChoice: "auto",
    // Enable multi-step reasoning
    stopWhen: stepCountIs(25),
  };
}
