import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { AgentProviderConfig } from "../runtime/types.js";
import type { AIProvider } from "../shared-types.js";
import type {
  AgentModel,
  AnthropicModel,
  BedrockModel,
  OpenAIModel,
} from "../utils/sdk-types.js";

type ModelSelection = {
  provider: AIProvider;
  modelId: string;
  model: AgentModel;
};

function toAgentModel(
  model: AnthropicModel | BedrockModel | OpenAIModel,
): AgentModel {
  return model as unknown as AgentModel;
}

export function selectModel(config: AgentProviderConfig): ModelSelection {
  if (config.provider === "openai") {
    const openai = createOpenAI({ apiKey: config.apiKey });
    const modelId = config.modelId ?? "gpt-4o-mini";
    return {
      provider: config.provider,
      modelId,
      model: toAgentModel(openai(modelId)),
    };
  }

  if (config.provider === "bedrock") {
    const bedrock = createAmazonBedrock({ region: config.awsRegion });
    return {
      provider: config.provider,
      modelId: config.modelId,
      model: toAgentModel(bedrock(config.modelId)),
    };
  }

  const anthropic = createAnthropic({ apiKey: config.apiKey });
  const modelId = config.modelId ?? "claude-haiku-4-5";
  return {
    provider: config.provider,
    modelId,
    model: toAgentModel(anthropic(modelId)),
  };
}
