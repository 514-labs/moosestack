import type {
  AgentStepRecord,
  AgentTraceSummary,
} from "../observability-contract.js";
import type {
  AgentRuntime,
  CreateAgentStreamOptions,
} from "../runtime/types.js";

type TraceSummaryInput = Omit<
  AgentTraceSummary,
  | "traceId"
  | "tenantId"
  | "provider"
  | "modelId"
  | "prompt"
  | "startedAt"
  | "completedAt"
  | "totalDurationMs"
> & { status: string; completedAt?: string };

export function createTraceSession(
  options: Pick<CreateAgentStreamOptions, "tenantId" | "traceCollector">,
  runtime: Pick<AgentRuntime, "provider" | "modelId" | "close">,
  userPrompt: string,
) {
  const traceStartedAt = new Date().toISOString();
  const traceStartedAtMs = Date.now();
  const traceId = options.traceCollector.startTrace({
    tenantId: options.tenantId,
    provider: runtime.provider,
    modelId: runtime.modelId,
    prompt: userPrompt,
  });
  const observedSteps: AgentStepRecord[] = [];
  let traceClosed = false;

  function recordStep(step: AgentStepRecord) {
    observedSteps.push(step);
    options.traceCollector.recordStep(traceId, step);
  }

  async function finalizeTrace(summary: TraceSummaryInput) {
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

  return {
    traceId,
    observedSteps,
    recordStep,
    finalizeTrace,
  };
}
