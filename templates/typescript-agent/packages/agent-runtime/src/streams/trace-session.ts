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

export interface TraceSession {
  traceId: string;
  observedSteps: AgentStepRecord[];
  recordStep(step: AgentStepRecord): void;
  finalizeTrace(summary: TraceSummaryInput): Promise<void>;
}

function createRedactedSummary(label: string, value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  return `[redacted ${label}; ${trimmedValue.length} chars]`;
}

function sanitizeTracePrompt(prompt: string): string {
  return createRedactedSummary("prompt", prompt);
}

function sanitizeStep(step: AgentStepRecord): AgentStepRecord {
  const redactionLabel = (() => {
    if (step.stepType === "tool") {
      return step.status === "failed" ? "tool error" : "tool payload";
    }

    if (step.stepType === "guardrail") {
      return "guardrail details";
    }

    if (step.toolName) {
      return `${step.toolName} notes`;
    }

    return "trace notes";
  })();

  return {
    ...step,
    notes: createRedactedSummary(redactionLabel, step.notes),
  };
}

export function createTraceSession(
  options: Pick<CreateAgentStreamOptions, "tenantId" | "traceCollector">,
  runtime: Pick<AgentRuntime, "provider" | "modelId" | "close">,
  userPrompt: string,
): TraceSession {
  const traceStartedAt = new Date().toISOString();
  const traceStartedAtMs = Date.now();
  const sanitizedPrompt = sanitizeTracePrompt(userPrompt);
  let collectorStarted = false;
  let traceId: string = crypto.randomUUID();

  try {
    traceId = options.traceCollector.startTrace({
      tenantId: options.tenantId,
      provider: runtime.provider,
      modelId: runtime.modelId,
      prompt: sanitizedPrompt,
    });
    collectorStarted = true;
  } catch (error) {
    console.error("Trace collector failed to start a trace:", error);
  }

  const observedSteps: AgentStepRecord[] = [];
  let traceClosed = false;

  function recordStep(step: AgentStepRecord): void {
    const sanitizedStep = sanitizeStep(step);
    observedSteps.push(sanitizedStep);

    if (!collectorStarted) {
      return;
    }

    try {
      options.traceCollector.recordStep(traceId, sanitizedStep);
    } catch (error) {
      console.error("Trace collector failed to record a step:", error);
    }
  }

  async function finalizeTrace(summary: TraceSummaryInput): Promise<void> {
    if (traceClosed) {
      return;
    }

    traceClosed = true;

    try {
      if (collectorStarted) {
        try {
          await options.traceCollector.endTrace(traceId, {
            traceId,
            tenantId: options.tenantId,
            provider: runtime.provider,
            modelId: runtime.modelId,
            prompt: sanitizedPrompt,
            startedAt: traceStartedAt,
            completedAt: summary.completedAt ?? new Date().toISOString(),
            totalDurationMs: Date.now() - traceStartedAtMs,
            ...summary,
          });
        } catch (error) {
          console.error("Trace collector failed to finish a trace:", error);
        }
      }
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
