import { createUIMessageStream, streamText } from "ai";
import { formatAgentRuntimeErrorMessage } from "../errors.js";
import { createAgentRuntime } from "../runtime/create-agent-runtime.js";
import type { CreateAgentStreamOptions } from "../runtime/types.js";
import type { GuardrailResult } from "../shared-types.js";
import { extractUserPrompt } from "../utils/message-parts.js";
import type { StreamTextTools, ToolTiming } from "../utils/sdk-types.js";
import { createGuardrailBlockedStream } from "./create-guardrail-blocked-stream.js";
import { emitToolTimings, wrapTools } from "./tool-tracing.js";
import { createTraceSession } from "./trace-session.js";

export async function createAgentStream(
  options: CreateAgentStreamOptions,
): Promise<ReturnType<typeof createUIMessageStream>> {
  const runtime = await createAgentRuntime(options);
  const userPrompt = extractUserPrompt(options.messages);
  const traceSession = createTraceSession(options, runtime, userPrompt);

  let guardrailResult: GuardrailResult;
  try {
    guardrailResult = await runtime.guardrailAdapter.assessPrompt(userPrompt);
  } catch (error) {
    await traceSession.finalizeTrace({
      guardrailAction: "none",
      status: "failed",
      totalSteps: traceSession.observedSteps.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }

  if (guardrailResult.action === "GUARDRAIL_INTERVENED") {
    traceSession.recordStep({
      stepId: crypto.randomUUID(),
      traceId: traceSession.traceId,
      accessScopeId: options.accessScopeId,
      stepType: "guardrail",
      toolName: "",
      status: "blocked",
      notes: guardrailResult.details.join("; "),
      startedAt: new Date().toISOString(),
      durationMs: guardrailResult.latencyMs,
      inputTokens: 0,
      outputTokens: 0,
    });

    await traceSession.finalizeTrace({
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
        const toolCallTimings = new Map<string, ToolTiming>();
        let stepCount = 0;
        const tools =
          Object.keys(runtime.tools).length > 0
            ? wrapTools({
                runtimeTools: runtime.tools,
                accessScopeId: options.accessScopeId,
                traceId: traceSession.traceId,
                toolCallTimings,
                getStepNumber: () => stepCount + 1,
                recordStep: traceSession.recordStep,
              })
            : runtime.tools;

        const result = streamText({
          model: runtime.model,
          system: runtime.system,
          messages: runtime.messages,
          tools: tools as StreamTextTools,
          toolChoice: runtime.toolChoice,
          stopWhen: runtime.stopWhen,
          onStepFinish: async (stepResult) => {
            stepCount += 1;

            if (!stepResult.toolCalls?.length) {
              return;
            }

            emitToolTimings(writer, toolCallTimings, stepResult.toolCalls);
          },
          onFinish: async ({ totalUsage }) => {
            await traceSession.finalizeTrace({
              guardrailAction: "none",
              status: "completed",
              totalSteps: traceSession.observedSteps.length,
              totalInputTokens: totalUsage?.inputTokens ?? 0,
              totalOutputTokens: totalUsage?.outputTokens ?? 0,
            });
          },
          onError: async ({ error }) => {
            await traceSession.finalizeTrace({
              guardrailAction: "none",
              status: "failed",
              totalSteps: traceSession.observedSteps.length,
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
      } catch (error) {
        await traceSession.finalizeTrace({
          guardrailAction: "none",
          status: "failed",
          totalSteps: traceSession.observedSteps.length,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          completedAt: new Date().toISOString(),
        });
        throw new Error(formatAgentRuntimeErrorMessage(error));
      }
    },
  });
}
