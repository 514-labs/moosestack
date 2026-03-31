import type { AgentStepRecord, TraceCollector } from "agent-runtime";

class InMemoryTraceCollector implements TraceCollector {
  private traces = new Map<string, AgentStepRecord[]>();

  startTrace(_metadata: Parameters<TraceCollector["startTrace"]>[0]): string {
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

  async endTrace(
    _traceId: string,
    _summary: Parameters<TraceCollector["endTrace"]>[1],
  ): Promise<void> {
    return;
  }
}

export function createInMemoryTraceCollector(): TraceCollector {
  return new InMemoryTraceCollector();
}
