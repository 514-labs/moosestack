import type { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { createAnthropic } from "@ai-sdk/anthropic";
import type { experimental_createMCPClient } from "@ai-sdk/mcp";
import type { createOpenAI } from "@ai-sdk/openai";
import type { convertToModelMessages, stepCountIs, streamText } from "ai";

type ModelFromFactory<TFactory> = TFactory extends (
  ...args: infer _FactoryArgs
) => infer TProviderFactory
  ? TProviderFactory extends (...args: infer _ModelArgs) => infer TModel
    ? TModel
    : never
  : never;

export type AnthropicModel = ModelFromFactory<typeof createAnthropic>;
export type BedrockModel = ModelFromFactory<typeof createAmazonBedrock>;
export type OpenAIModel = ModelFromFactory<typeof createOpenAI>;
export type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;
export type StreamTextOptions = Parameters<typeof streamText>[0];
export type AgentModel = StreamTextOptions["model"];
export type StreamTextTools = NonNullable<StreamTextOptions["tools"]>;
export type AgentTools = Record<string, unknown>;
export type AgentMessages = Awaited<ReturnType<typeof convertToModelMessages>>;
export type StepResult = Parameters<NonNullable<StreamTextOptions["onStepFinish"]>>[0];
export type FinishResult = Parameters<NonNullable<StreamTextOptions["onFinish"]>>[0];
export type ToolExecutionContext = unknown;
export type ExecutableTool = Record<string, unknown> & {
  execute: (args: unknown, context: unknown) => Promise<unknown> | unknown;
};
export type StreamStopCondition = ReturnType<typeof stepCountIs>;
export type ToolTiming = {
  duration: number;
  stepNumber: number;
  toolName: string;
};
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};
