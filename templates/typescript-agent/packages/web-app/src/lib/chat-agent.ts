import { type AgentProviderConfig, createAgentStream } from "agent-runtime";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import {
  getAiProvider,
  getAnthropicApiKey,
  getAnthropicModelId,
  getAwsRegion,
  getBedrockModelId,
  getMcpServerUrl,
  getOpenAiApiKey,
  getOpenAiModelId,
} from "@/env-vars";
import { createGuardrailAdapter } from "@/lib/guardrails";
import { createTraceCollector } from "@/lib/observability";
import { assertProviderReady } from "@/lib/provider-status";

interface AgentResponseOptions {
  messages: UIMessage[];
  bearerToken: string;
  tenantId: string;
}

function getProviderConfig(): AgentProviderConfig {
  const provider = getAiProvider();

  if (provider === "openai") {
    return {
      provider,
      apiKey: getOpenAiApiKey(),
      modelId: getOpenAiModelId(),
    };
  }

  if (provider === "bedrock") {
    return {
      provider,
      awsRegion: getAwsRegion(),
      modelId: getBedrockModelId(),
    };
  }

  return {
    provider,
    apiKey: getAnthropicApiKey(),
    modelId: getAnthropicModelId(),
  };
}

export async function getAgentResponse({
  messages,
  bearerToken,
  tenantId,
}: AgentResponseOptions): Promise<Response> {
  const provider = getAiProvider();
  assertProviderReady();
  const stream = await createAgentStream({
    messages,
    bearerToken,
    tenantId,
    mcpServerUrl: getMcpServerUrl(),
    providerConfig: getProviderConfig(),
    guardrailAdapter: createGuardrailAdapter(provider),
    traceCollector: createTraceCollector(),
  });

  return createUIMessageStreamResponse({ stream });
}
