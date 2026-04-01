import { createUIMessageStream, generateText, streamText } from "ai";
import { formatAgentRuntimeErrorMessage } from "../errors.js";
import {
  MULTI_AGENT_NARRATOR_PROMPT,
  MULTI_AGENT_SPECIALISTS,
  MULTI_AGENT_SUPERVISOR_PROMPT,
  parseSpecialistSelection,
} from "../prompts/multi-agent.js";
import { createAgentRuntime } from "../runtime/create-agent-runtime.js";
import type { CreateAgentStreamOptions } from "../runtime/types.js";
import type { GuardrailResult } from "../shared-types.js";
import { extractUserPrompt } from "../utils/message-parts.js";
import type { StreamTextTools, ToolTiming } from "../utils/sdk-types.js";
import { createGuardrailBlockedStream } from "./create-guardrail-blocked-stream.js";
import {
  getInputTokens,
  getOutputTokens,
  writeAgentMarker,
} from "./helpers.js";
import { emitToolTimings, wrapTools } from "./tool-tracing.js";
import { createTraceSession } from "./trace-session.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createMultiAgentStream(
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
      let stepCount = 0;
      const toolCallTimings = new Map<string, ToolTiming>();

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

        traceSession.recordStep({
          stepId: crypto.randomUUID(),
          traceId: traceSession.traceId,
          accessScopeId: options.accessScopeId,
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
          "Investigating with the authenticated MCP tools.",
        );

        const tools =
          Object.keys(runtime.tools).length > 0 ?
            wrapTools({
              runtimeTools: runtime.tools,
              accessScopeId: options.accessScopeId,
              traceId: traceSession.traceId,
              toolCallTimings,
              getStepNumber: () => stepCount + 1,
              recordStep: traceSession.recordStep,
            })
          : runtime.tools;
        const workerStartedAt = new Date().toISOString();
        const workerStartedAtMs = Date.now();
        let workerFailed = false;
        const workerResult = streamText({
          model: runtime.model,
          system: `${runtime.system}\n\n${specialist.systemPrompt}`,
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
          onError: ({ error }) => {
            workerFailed = true;
            traceSession.recordStep({
              stepId: crypto.randomUUID(),
              traceId: traceSession.traceId,
              accessScopeId: options.accessScopeId,
              stepType: "agent",
              toolName: specialist.label,
              status: "failed",
              notes: getErrorMessage(error),
              startedAt: workerStartedAt,
              durationMs: Date.now() - workerStartedAtMs,
              inputTokens: 0,
              outputTokens: 0,
            });
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

        if (!workerFailed) {
          traceSession.recordStep({
            stepId: crypto.randomUUID(),
            traceId: traceSession.traceId,
            accessScopeId: options.accessScopeId,
            stepType: "agent",
            toolName: specialist.label,
            status: "completed",
            notes: workerNotes,
            startedAt: workerStartedAt,
            durationMs: Date.now() - workerStartedAtMs,
            inputTokens: getInputTokens(workerUsage),
            outputTokens: getOutputTokens(workerUsage),
          });
        }

        writeAgentMarker(
          writer,
          "narrator",
          "Turning the specialist notes into the final answer.",
        );

        const narratorStartedAt = new Date().toISOString();
        const narratorStartedAtMs = Date.now();
        let narratorFailed = false;
        const narratorResult = streamText({
          model: runtime.model,
          system: MULTI_AGENT_NARRATOR_PROMPT,
          prompt: `Latest user request:\n${userPrompt}\n\nSupervisor route:\n${specialist.label}\n\nSpecialist notes:\n${workerNotes}`,
          stopWhen: runtime.stopWhen,
          onError: ({ error }) => {
            narratorFailed = true;
            traceSession.recordStep({
              stepId: crypto.randomUUID(),
              traceId: traceSession.traceId,
              accessScopeId: options.accessScopeId,
              stepType: "agent",
              toolName: "narrator",
              status: "failed",
              notes: getErrorMessage(error),
              startedAt: narratorStartedAt,
              durationMs: Date.now() - narratorStartedAtMs,
              inputTokens: 0,
              outputTokens: 0,
            });
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

        if (!narratorFailed) {
          traceSession.recordStep({
            stepId: crypto.randomUUID(),
            traceId: traceSession.traceId,
            accessScopeId: options.accessScopeId,
            stepType: "agent",
            toolName: "narrator",
            status: "completed",
            notes: `worker=${specialist.label}`,
            startedAt: narratorStartedAt,
            durationMs: Date.now() - narratorStartedAtMs,
            inputTokens: getInputTokens(narratorUsage),
            outputTokens: getOutputTokens(narratorUsage),
          });
        }

        await traceSession.finalizeTrace({
          guardrailAction: "none",
          status: "completed",
          totalSteps: traceSession.observedSteps.length,
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
