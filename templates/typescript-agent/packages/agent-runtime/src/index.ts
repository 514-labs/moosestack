import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStream,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";

type AnthropicModel = ReturnType<ReturnType<typeof createAnthropic>>;
type BedrockModel = ReturnType<ReturnType<typeof createAmazonBedrock>>;
type OpenAIModel = ReturnType<ReturnType<typeof createOpenAI>>;
type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;
type StreamTextOptions = Parameters<typeof streamText>[0];
type AgentModel = StreamTextOptions["model"];
type StreamTextTools = NonNullable<StreamTextOptions["tools"]>;
type AgentTools = Record<string, unknown>;
type AgentMessages = Awaited<ReturnType<typeof convertToModelMessages>>;
type StepResult = Parameters<NonNullable<StreamTextOptions["onStepFinish"]>>[0];
type FinishResult = Parameters<NonNullable<StreamTextOptions["onFinish"]>>[0];
type ToolExecutionContext = unknown;

type ExecutableTool = Record<string, unknown> & {
  execute: (args: unknown, context: unknown) => Promise<unknown> | unknown;
};

export const DEFAULT_AGENT_SYSTEM_PROMPT = `You are the analytics copilot inside a multi-tenant MooseStack application.

Rules:
1. Use the MCP tools to inspect schema before guessing table names.
2. Assume the user only wants data visible to their authenticated tenant.
3. Prefer concise answers with concrete findings, then follow with short next steps.
4. If a tool returns no rows, say so directly instead of speculating.
5. When querying ClickHouse, keep queries read-only and scoped to the problem at hand.

Be helpful, accurate, and explicit about which tool calls support your answer.`;

export type AIProvider = "anthropic" | "openai" | "bedrock";

export interface GuardrailResult {
  action: "NONE" | "GUARDRAIL_INTERVENED";
  details: string[];
  latencyMs: number;
}

export interface GuardrailAdapter {
  assessPrompt(prompt: string): Promise<GuardrailResult>;
}

export interface AgentStepRecord {
  stepId: string;
  traceId: string;
  tenantId: string;
  stepType: string;
  toolName: string;
  status: string;
  notes: string;
  startedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentTraceSummary {
  traceId: string;
  tenantId: string;
  provider: AIProvider;
  modelId: string;
  prompt: string;
  guardrailAction: string;
  status: string;
  startedAt: string;
  completedAt: string;
  totalSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

export interface TraceCollector {
  startTrace(metadata: {
    tenantId: string;
    provider: AIProvider;
    modelId: string;
    prompt: string;
  }): string;
  recordStep(traceId: string, step: AgentStepRecord): void;
  endTrace(traceId: string, summary: AgentTraceSummary): Promise<void>;
}

class InMemoryTraceCollector implements TraceCollector {
  private traces = new Map<string, AgentStepRecord[]>();

  startTrace(): string {
    const traceId = crypto.randomUUID();
    this.traces.set(traceId, []);
    return traceId;
  }

  recordStep(traceId: string, step: AgentStepRecord): void {
    const steps = this.traces.get(traceId);
    if (!steps) {
      return;
    }

    steps.push(step);
  }

  async endTrace(): Promise<void> {
    return;
  }
}

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
  tenantId: string;
  traceCollector: TraceCollector;
}

export function createInMemoryTraceCollector(): TraceCollector {
  return new InMemoryTraceCollector();
}

interface ModelSelection {
  provider: AIProvider;
  modelId: string;
  model: AgentModel;
}

type ToolTiming = {
  duration: number;
  stepNumber: number;
  toolName: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    isObjectRecord(part) &&
    part.type === "text" &&
    typeof part.text === "string"
  );
}

function hasExecutableTool(tool: unknown): tool is ExecutableTool {
  return isObjectRecord(tool) && typeof tool.execute === "function";
}

function toAgentModel(
  model: AnthropicModel | BedrockModel | OpenAIModel,
): AgentModel {
  return model as unknown as AgentModel;
}

function getToolCallId(context: unknown): string | undefined {
  if (!isObjectRecord(context) || typeof context.toolCallId !== "string") {
    return undefined;
  }

  return context.toolCallId;
}

function selectModel(config: AgentProviderConfig): ModelSelection {
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

function extractUserPrompt(messages: UIMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return (
    lastUserMessage?.parts
      ?.filter(isTextPart)
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

async function closeMcpClient(client: MCPClient) {
  if (typeof client.close !== "function") {
    return;
  }

  await client.close().catch(() => undefined);
}

export async function createAgentRuntime(
  options: AgentRuntimeOptions,
): Promise<AgentRuntime> {
  const modelSelection = selectModel(options.providerConfig);
  const mcpClient = await experimental_createMCPClient({
    name: "moose-mcp-server",
    transport: {
      type: "http",
      url: `${options.mcpServerUrl}/tools`,
      headers: { Authorization: `Bearer ${options.bearerToken}` },
    },
  });
  const tools = await mcpClient.tools();

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
    mcpServerUrl: options.mcpServerUrl,
    close: () => closeMcpClient(mcpClient),
  };
}

function createGuardrailBlockedStream(details: string[]) {
  return createUIMessageStream({
    execute: ({ writer }) => {
      const textId = "guardrail-block";
      writer.write({
        type: "text-start",
        id: textId,
      });
      writer.write({
        type: "text-delta",
        id: textId,
        delta:
          "The request was blocked by the configured guardrails before a model call was made.\n\n" +
          details.join("\n"),
      });
      writer.write({
        type: "text-end",
        id: textId,
      });
    },
  });
}

export async function createAgentStream(
  options: CreateAgentStreamOptions,
): Promise<ReturnType<typeof createUIMessageStream>> {
  const runtime = await createAgentRuntime(options);
  const userPrompt = extractUserPrompt(options.messages);
  const traceStartedAt = new Date().toISOString();
  const traceStartedAtMs = Date.now();
  const traceId = options.traceCollector.startTrace({
    tenantId: options.tenantId,
    provider: runtime.provider,
    modelId: runtime.modelId,
    prompt: userPrompt,
  });

  let stepCount = 0;
  const toolCallTimings = new Map<string, ToolTiming>();
  const observedSteps: AgentStepRecord[] = [];
  let traceClosed = false;

  async function finalizeTrace(
    summary: Omit<
      AgentTraceSummary,
      | "traceId"
      | "tenantId"
      | "provider"
      | "modelId"
      | "prompt"
      | "startedAt"
      | "completedAt"
      | "totalDurationMs"
    > & { status: string; completedAt?: string },
  ) {
    if (traceClosed) {
      return;
    }

    traceClosed = true;

    try {
      await options.traceCollector.endTrace(traceId, {
        traceId,
        tenantId: options.tenantId,
        provider: runtime.provider,
        modelId: runtime.modelId,
        prompt: userPrompt,
        startedAt: traceStartedAt,
        completedAt: summary.completedAt ?? new Date().toISOString(),
        totalDurationMs: Date.now() - traceStartedAtMs,
        ...summary,
      });
    } finally {
      await runtime.close();
    }
  }

  const guardrailResult =
    await runtime.guardrailAdapter.assessPrompt(userPrompt);
  if (guardrailResult.action === "GUARDRAIL_INTERVENED") {
    const blockedStep: AgentStepRecord = {
      stepId: crypto.randomUUID(),
      traceId,
      tenantId: options.tenantId,
      stepType: "guardrail",
      toolName: "",
      status: "blocked",
      notes: guardrailResult.details.join("; "),
      startedAt: traceStartedAt,
      durationMs: guardrailResult.latencyMs,
      inputTokens: 0,
      outputTokens: 0,
    };

    options.traceCollector.recordStep(traceId, blockedStep);
    await finalizeTrace({
      guardrailAction: "guardrail_intervened",
      status: "blocked",
      totalSteps: 1,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      completedAt: new Date().toISOString(),
    });

    return createGuardrailBlockedStream(guardrailResult.details);
  }

  return createUIMessageStream({
    execute: async ({ writer }) => {
      const tools =
        Object.keys(runtime.tools).length > 0 ? wrapTools() : runtime.tools;
      const result = streamText({
        model: runtime.model,
        system: runtime.system,
        messages: runtime.messages,
        tools: tools as StreamTextTools,
        toolChoice: runtime.toolChoice,
        stopWhen: runtime.stopWhen,
        onStepFinish: async (stepResult: StepResult) => {
          stepCount += 1;

          if (!stepResult.toolCalls?.length) {
            return;
          }

          stepResult.toolCalls.forEach((toolCall) => {
            const timing = toolCallTimings.get(toolCall.toolCallId);
            if (!timing) {
              return;
            }

            writer.write({
              type: "data-tool-timing",
              data: {
                toolCallId: toolCall.toolCallId,
                duration: timing.duration,
                stepNumber: timing.stepNumber,
                toolName: timing.toolName,
              },
            });

            toolCallTimings.delete(toolCall.toolCallId);
          });
        },
        onFinish: async ({ totalUsage }: FinishResult) => {
          await finalizeTrace({
            guardrailAction: "none",
            status: "completed",
            totalSteps: observedSteps.length,
            totalInputTokens: totalUsage?.inputTokens ?? 0,
            totalOutputTokens: totalUsage?.outputTokens ?? 0,
          });
        },
        onError: async ({ error }) => {
          await finalizeTrace({
            guardrailAction: "none",
            status: "failed",
            totalSteps: observedSteps.length,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            completedAt: new Date().toISOString(),
          });
          console.error("Agent stream failed:", error);
        },
      });

      writer.merge(
        result.toUIMessageStream({
          onError: (error) =>
            error instanceof Error ?
              error.message
            : "An unexpected model error occurred.",
        }),
      );
    },
  });

  function wrapTools() {
    const wrappedTools: AgentTools = {};

    for (const [toolName, tool] of Object.entries(runtime.tools)) {
      if (!isObjectRecord(tool)) {
        wrappedTools[toolName] = tool;
        continue;
      }

      if (!hasExecutableTool(tool)) {
        wrappedTools[toolName] = tool;
        continue;
      }

      wrappedTools[toolName] = {
        ...tool,
        execute: async (args: unknown, context: ToolExecutionContext) => {
          const toolCallId = getToolCallId(context);
          const startedAt = new Date().toISOString();
          const startTime = Date.now();

          try {
            const result = await tool.execute(args, context);
            const duration = Date.now() - startTime;

            if (toolCallId) {
              toolCallTimings.set(toolCallId, {
                duration,
                toolName,
                stepNumber: stepCount + 1,
              });
            }

            const record: AgentStepRecord = {
              stepId: crypto.randomUUID(),
              traceId,
              tenantId: options.tenantId,
              stepType: "tool",
              toolName,
              status: "completed",
              notes: JSON.stringify(args),
              startedAt,
              durationMs: duration,
              inputTokens: 0,
              outputTokens: 0,
            };
            observedSteps.push(record);
            options.traceCollector.recordStep(traceId, record);

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            if (toolCallId) {
              toolCallTimings.set(toolCallId, {
                duration,
                toolName,
                stepNumber: stepCount + 1,
              });
            }

            const record: AgentStepRecord = {
              stepId: crypto.randomUUID(),
              traceId,
              tenantId: options.tenantId,
              stepType: "tool",
              toolName,
              status: "failed",
              notes:
                error instanceof Error ? error.message : "Unknown tool error",
              startedAt,
              durationMs: duration,
              inputTokens: 0,
              outputTokens: 0,
            };
            observedSteps.push(record);
            options.traceCollector.recordStep(traceId, record);

            throw error;
          }
        },
      };
    }

    return wrappedTools;
  }
}
