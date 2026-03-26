import { type AgentProviderConfig, createAgentStream } from "agent-runtime";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import {
  getAiProvider,
  getAnthropicApiKey,
  getAwsRegion,
  getBedrockModelId,
  getMcpServerUrl,
  getOpenAiApiKey,
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
      modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
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
    modelId: "claude-haiku-4-5",
  };
}

export async function getAgentResponse({
  messages,
  bearerToken,
  tenantId,
}: AgentResponseOptions) {
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
