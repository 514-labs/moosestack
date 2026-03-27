import { convertToModelMessages, stepCountIs } from "ai";
import { closeMcpClient, createMcpTools } from "../mcp/client.js";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../prompts/default-system.js";
import { selectModel } from "../providers/select-model.js";
import type { AgentRuntime, AgentRuntimeOptions } from "./types.js";

export async function createAgentRuntime(
  options: AgentRuntimeOptions,
): Promise<AgentRuntime> {
  const modelSelection = selectModel(options.providerConfig);
  const { mcpClient, tools, resolvedMcpServerUrl } = await createMcpTools({
    bearerToken: options.bearerToken,
    mcpServerUrl: options.mcpServerUrl,
  });

  return {
    provider: modelSelection.provider,
    modelId: modelSelection.modelId,
    model: modelSelection.model,
    guardrailAdapter: options.guardrailAdapter,
    system: options.systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(options.messages),
    tools,
    toolChoice: "auto",
    stopWhen: stepCountIs(options.maxSteps ?? 25),
    mcpServerUrl: resolvedMcpServerUrl,
    close: () => closeMcpClient(mcpClient),
  };
}
