import type { stepCountIs, UIMessage } from "ai";
import type { TraceCollector } from "../observability-contract.js";
import type { AIProvider, GuardrailAdapter } from "../shared-types.js";
import type {
  AgentMessages,
  AgentModel,
  AgentTools,
} from "../utils/sdk-types.js";

export type AgentProviderConfig =
  | {
      provider: "anthropic";
      apiKey: string;
      modelId?: string;
    }
  | {
      provider: "openai";
      apiKey: string;
      modelId?: string;
    }
  | {
      provider: "bedrock";
      awsRegion: string;
      modelId: string;
    };

export interface AgentRuntimeOptions {
  messages: UIMessage[];
  bearerToken: string;
  mcpServerUrl: string;
  providerConfig: AgentProviderConfig;
  guardrailAdapter: GuardrailAdapter;
  maxSteps?: number;
  systemPrompt?: string;
}

export interface AgentRuntime {
  provider: AIProvider;
  modelId: string;
  model: AgentModel;
  guardrailAdapter: GuardrailAdapter;
  system: string;
  messages: AgentMessages;
  tools: AgentTools;
  toolChoice: "auto";
  stopWhen: ReturnType<typeof stepCountIs>;
  mcpServerUrl: string;
  close(): Promise<void>;
}

export interface CreateAgentStreamOptions extends AgentRuntimeOptions {
  accessScopeId: string;
  traceCollector: TraceCollector;
}
