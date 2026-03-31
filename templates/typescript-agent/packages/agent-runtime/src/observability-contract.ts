import type { AIProvider } from "./shared-types.js";

export interface AgentStepRecord {
  stepId: string;
  traceId: string;
  accessScopeId: string;
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
  accessScopeId: string;
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
    accessScopeId: string;
    provider: AIProvider;
    modelId: string;
    prompt: string;
  }): string;
  recordStep(traceId: string, step: AgentStepRecord): void;
  endTrace(traceId: string, summary: AgentTraceSummary): Promise<void>;
}
