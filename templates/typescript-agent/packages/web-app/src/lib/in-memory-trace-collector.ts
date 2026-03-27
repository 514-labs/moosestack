import type { AgentStepRecord, TraceCollector } from "agent-runtime";

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

export function createInMemoryTraceCollector(): TraceCollector {
  return new InMemoryTraceCollector();
}
