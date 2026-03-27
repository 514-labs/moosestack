import type {
  AgentStepRecord,
  AgentTraceSummary,
  AIProvider,
  TraceCollector,
} from "agent-runtime";
import { Langfuse } from "langfuse";

export interface LangfuseTraceCollectorConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

class LangfuseTraceCollector implements TraceCollector {
  private langfuse: Langfuse;
  private traces = new Map<string, ReturnType<Langfuse["trace"]>>();

  constructor(config: LangfuseTraceCollectorConfig) {
    this.langfuse = new Langfuse(config);
  }

  startTrace(metadata: {
    tenantId: string;
    provider: AIProvider;
    modelId: string;
    prompt: string;
  }): string {
    const traceId = crypto.randomUUID();
    const trace = this.langfuse.trace({
      id: traceId,
      name: `agent:${metadata.tenantId}`,
      input: metadata.prompt,
      metadata: {
        tenantId: metadata.tenantId,
        provider: metadata.provider,
        modelId: metadata.modelId,
      },
    });

    this.traces.set(traceId, trace);
    return traceId;
  }

  recordStep(traceId: string, step: AgentStepRecord): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    trace.generation({
      name: step.toolName || step.stepType,
      model: "template-agent-runtime",
      input: step.notes,
      usage: {
        input: step.inputTokens,
        output: step.outputTokens,
      },
      metadata: {
        stepType: step.stepType,
        status: step.status,
        durationMs: step.durationMs,
      },
    });
  }

  async endTrace(traceId: string, summary: AgentTraceSummary): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    try {
      trace.update({
        output: {
          status: summary.status,
          totalSteps: summary.totalSteps,
          totalDurationMs: summary.totalDurationMs,
        },
        metadata: {
          guardrailAction: summary.guardrailAction,
          totalInputTokens: summary.totalInputTokens,
          totalOutputTokens: summary.totalOutputTokens,
        },
      });

      await this.langfuse.flushAsync().catch(() => undefined);
    } finally {
      this.traces.delete(traceId);
    }
  }
}

export function createLangfuseTraceCollector(
  config: LangfuseTraceCollectorConfig,
): TraceCollector {
  return new LangfuseTraceCollector(config);
}
