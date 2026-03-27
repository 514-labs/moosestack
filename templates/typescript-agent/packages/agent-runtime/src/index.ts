import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageStreamWriter,
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

const MCP_ENDPOINT_PATH = "/tools";
const BEDROCK_MODEL_ACCESS_PATTERNS = [
  /AccessDeniedException/i,
  /not authorized to invoke/i,
  /model access denied/i,
  /access to the model/i,
  /invoke model/i,
] as const;

export function formatAgentRuntimeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : String(error).trim();

  if (message.length === 0) {
    return "An unexpected model error occurred.";
  }

  if (
    BEDROCK_MODEL_ACCESS_PATTERNS.some((pattern) => {
      return pattern.test(message);
    })
  ) {
    return "Model access denied. Enable model access in the AWS Bedrock console for the selected model, or change `BEDROCK_MODEL_ID` / `AI_PROVIDER`.";
  }

  return message;
}

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

export class McpServerUnavailableError extends Error {
  readonly endpointUrl: string;

  constructor(endpointUrl: string, cause?: unknown) {
    const causeMessage =
      cause instanceof Error && cause.message.trim().length > 0 ?
        ` (${cause.message.trim()})`
      : "";

    super(
      `Cannot connect to MCP server at ${endpointUrl}. Start the local stack with \`pnpm dev:start\`, or start just the Moose service with \`pnpm dev:moose\`, and verify the custom MCP tools endpoint is reachable.${causeMessage}`,
    );
    this.name = "McpServerUnavailableError";
    this.endpointUrl = endpointUrl;
  }
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

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

type SpecialistId =
  | "catalog-researcher"
  | "knowledge-analyst"
  | "sql-investigator";

type SpecialistDefinition = {
  label: string;
  handoffSummary: string;
  systemPrompt: string;
};

const MULTI_AGENT_SPECIALISTS: Record<SpecialistId, SpecialistDefinition> = {
  "catalog-researcher": {
    label: "catalog-researcher",
    handoffSummary: "schema discovery, table selection, or catalog inspection",
    systemPrompt: `You are the catalog-researcher specialist.

Focus on schema discovery, table selection, and clarifying which tenant-scoped data components matter.

Rules:
1. Start with MCP catalog inspection before suggesting SQL.
2. Use DESCRIBE TABLE when column details matter.
3. Stream compact working notes for a downstream narrator.
4. If the schema does not support the request, say so directly.`,
  },
  "knowledge-analyst": {
    label: "knowledge-analyst",
    handoffSummary:
      "summaries, priorities, recent changes, or trend interpretation",
    systemPrompt: `You are the knowledge-analyst specialist.

Focus on tenant-scoped summaries, trend interpretation, and priority analysis over the seeded knowledge domain.

Rules:
1. Use the available tools to verify claims before summarizing.
2. Prefer short bullet-style working notes over polished prose.
3. Call out the strongest signals first.
4. Mention missing evidence instead of filling gaps with guesses.`,
  },
  "sql-investigator": {
    label: "sql-investigator",
    handoffSummary:
      "direct SQL analysis, grouped metrics, or precise comparisons",
    systemPrompt: `You are the sql-investigator specialist.

Focus on precise, read-only SQL analysis for the authenticated tenant.

Rules:
1. Use MCP tools for schema checks before writing non-trivial queries.
2. Keep SQL read-only and scoped to the problem.
3. Stream concise working notes that cite the relevant query outcome.
4. If a request needs unsupported data, say exactly what is missing.`,
  },
};

const MULTI_AGENT_SUPERVISOR_PROMPT = `You are the supervisor in a reference multi-agent MooseStack template.

Route the latest user request to exactly one specialist:
- catalog-researcher: schema discovery, tool selection, table or column lookup
- knowledge-analyst: summaries, priorities, recent changes, trend interpretation
- sql-investigator: precise counts, grouped metrics, comparisons, or direct SQL work

Reply with only one specialist label and no extra commentary.`;

const MULTI_AGENT_NARRATOR_PROMPT = `You are the narrator in a reference multi-agent MooseStack template.

Turn the specialist's working notes into the final user-facing answer.

Rules:
1. Lead with the answer.
2. Keep the response concise and concrete.
3. Mention the most relevant tools only when they materially support the answer.
4. Preserve uncertainty or missing data instead of smoothing it over.
5. Do not invent rows, schema details, or tool outputs.`;

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

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

function formatUrl(url: URL): string {
  if (url.pathname === "/" && !url.search && !url.hash) {
    return url.origin;
  }

  return url.toString().replace(/\/$/, "");
}

export function resolveMcpServerUrl(value: string): string {
  const url = new URL(value);
  const pathname = normalizePathname(url.pathname);

  if (pathname === "/") {
    url.pathname = MCP_ENDPOINT_PATH;
    return formatUrl(url);
  }

  url.pathname =
    pathname.endsWith(MCP_ENDPOINT_PATH) ? pathname : (
      `${pathname}${MCP_ENDPOINT_PATH}`
    );

  return formatUrl(url);
}

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

  let tools: AgentTools;
  try {
    tools = await mcpClient.tools();
  } catch (error) {
    await closeMcpClient(mcpClient);

    if (shouldWrapMcpConnectionError(error)) {
      throw new McpServerUnavailableError(resolvedMcpServerUrl, error);
    }

    throw error;
  }

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

function getInputTokens(usage?: TokenUsage) {
  return usage?.inputTokens ?? 0;
}

function getOutputTokens(usage?: TokenUsage) {
  return usage?.outputTokens ?? 0;
}

function writeAgentMarker(
  writer: UIMessageStreamWriter<UIMessage>,
  agentName: string,
  text: string,
) {
  const textId = crypto.randomUUID();

  writer.write({
    type: "text-start",
    id: textId,
  });
  writer.write({
    type: "text-delta",
    id: textId,
    delta: `[AGENT:${agentName}] ${text}\n\n`,
  });
  writer.write({
    type: "text-end",
    id: textId,
  });
}

function parseSpecialistSelection(text: string): SpecialistId {
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("catalog-researcher")) {
    return "catalog-researcher";
  }

  if (normalized.includes("knowledge-analyst")) {
    return "knowledge-analyst";
  }

  if (normalized.includes("sql-investigator")) {
    return "sql-investigator";
  }

  throw new Error(
    `Supervisor returned an unknown specialist route: ${text || "<empty>"}`,
  );
}

export async function createMultiAgentStream(
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

  function recordStep(step: AgentStepRecord) {
    observedSteps.push(step);
    options.traceCollector.recordStep(traceId, step);
  }

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
    recordStep({
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
    });

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
      try {
        const supervisorStartedAt = new Date().toISOString();
        const supervisorStartedAtMs = Date.now();
        const supervisorResult = await generateText({
          model: runtime.model,
          system: MULTI_AGENT_SUPERVISOR_PROMPT,
          messages: runtime.messages,
        });
        const specialist =
          MULTI_AGENT_SPECIALISTS[
            parseSpecialistSelection(supervisorResult.text)
          ];

        recordStep({
          stepId: crypto.randomUUID(),
          traceId,
          tenantId: options.tenantId,
          stepType: "agent",
          toolName: "supervisor",
          status: "completed",
          notes: `routed_to=${specialist.label}`,
          startedAt: supervisorStartedAt,
          durationMs: Date.now() - supervisorStartedAtMs,
          inputTokens: getInputTokens(supervisorResult.totalUsage),
          outputTokens: getOutputTokens(supervisorResult.totalUsage),
        });

        writeAgentMarker(
          writer,
          "supervisor",
          `Routing this request to ${specialist.label} for ${specialist.handoffSummary}.`,
        );
        writeAgentMarker(
          writer,
          specialist.label,
          "Investigating with tenant-scoped MCP tools.",
        );

        const tools =
          Object.keys(runtime.tools).length > 0 ? wrapTools() : runtime.tools;
        const workerStartedAt = new Date().toISOString();
        const workerStartedAtMs = Date.now();
        const workerResult = streamText({
          model: runtime.model,
          system: `${runtime.system}\n\n${specialist.systemPrompt}`,
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
          onError: (error) => {
            console.error("Multi-agent worker stream failed:", error);
          },
        });

        writer.merge(
          workerResult.toUIMessageStream({
            sendStart: false,
            sendFinish: false,
            onError: formatAgentRuntimeErrorMessage,
          }),
        );

        const workerNotes = await workerResult.text;
        const workerUsage = await workerResult.totalUsage;

        recordStep({
          stepId: crypto.randomUUID(),
          traceId,
          tenantId: options.tenantId,
          stepType: "agent",
          toolName: specialist.label,
          status: "completed",
          notes: workerNotes,
          startedAt: workerStartedAt,
          durationMs: Date.now() - workerStartedAtMs,
          inputTokens: getInputTokens(workerUsage),
          outputTokens: getOutputTokens(workerUsage),
        });

        writeAgentMarker(
          writer,
          "narrator",
          "Turning the specialist notes into the final answer.",
        );

        const narratorStartedAt = new Date().toISOString();
        const narratorStartedAtMs = Date.now();
        const narratorResult = streamText({
          model: runtime.model,
          system: MULTI_AGENT_NARRATOR_PROMPT,
          prompt: `Latest user request:\n${userPrompt}\n\nSupervisor route:\n${specialist.label}\n\nSpecialist notes:\n${workerNotes}`,
          stopWhen: stepCountIs(5),
          onError: (error) => {
            console.error("Multi-agent narrator stream failed:", error);
          },
        });

        writer.merge(
          narratorResult.toUIMessageStream({
            sendStart: false,
            onError: formatAgentRuntimeErrorMessage,
          }),
        );

        const narratorUsage = await narratorResult.totalUsage;

        recordStep({
          stepId: crypto.randomUUID(),
          traceId,
          tenantId: options.tenantId,
          stepType: "agent",
          toolName: "narrator",
          status: "completed",
          notes: `worker=${specialist.label}`,
          startedAt: narratorStartedAt,
          durationMs: Date.now() - narratorStartedAtMs,
          inputTokens: getInputTokens(narratorUsage),
          outputTokens: getOutputTokens(narratorUsage),
        });

        await finalizeTrace({
          guardrailAction: "none",
          status: "completed",
          totalSteps: observedSteps.length,
          totalInputTokens:
            getInputTokens(supervisorResult.totalUsage) +
            getInputTokens(workerUsage) +
            getInputTokens(narratorUsage),
          totalOutputTokens:
            getOutputTokens(supervisorResult.totalUsage) +
            getOutputTokens(workerUsage) +
            getOutputTokens(narratorUsage),
        });
      } catch (error) {
        await finalizeTrace({
          guardrailAction: "none",
          status: "failed",
          totalSteps: observedSteps.length,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          completedAt: new Date().toISOString(),
        });

        throw new Error(formatAgentRuntimeErrorMessage(error));
      }
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

            recordStep({
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
            });

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

            recordStep({
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
            });

            throw error;
          }
        },
      };
    }

    return wrappedTools;
  }
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
          onError: formatAgentRuntimeErrorMessage,
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
