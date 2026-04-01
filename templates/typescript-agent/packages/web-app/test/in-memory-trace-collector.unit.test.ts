import { describe, expect, it } from "vitest";
import { createInMemoryTraceCollector } from "../src/lib/in-memory-trace-collector";

describe("createInMemoryTraceCollector", () => {
  it("implements the trace collector contract without throwing", async () => {
    const collector = createInMemoryTraceCollector();
    const traceId = collector.startTrace({
      accessScopeId: "org_a",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      prompt: "Show me the latest records.",
    });

    collector.recordStep(traceId, {
      stepId: "step-1",
      traceId,
      accessScopeId: "org_a",
      stepType: "agent",
      toolName: "supervisor",
      status: "completed",
      notes: "routed_to=metrics-investigator",
      startedAt: new Date().toISOString(),
      durationMs: 12,
      inputTokens: 3,
      outputTokens: 2,
    });
    collector.recordStep("missing-trace", {
      stepId: "step-2",
      traceId: "missing-trace",
      accessScopeId: "org_a",
      stepType: "tool",
      toolName: "query_tenant_knowledge_metrics",
      status: "completed",
      notes: "queried tenant metrics",
      startedAt: new Date().toISOString(),
      durationMs: 4,
      inputTokens: 0,
      outputTokens: 0,
    });

    await expect(
      collector.endTrace(traceId, {
        traceId,
        accessScopeId: "org_a",
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        prompt: "Show me the latest records.",
        guardrailAction: "none",
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalSteps: 1,
        totalInputTokens: 3,
        totalOutputTokens: 2,
        totalDurationMs: 20,
      }),
    ).resolves.toBeUndefined();
  });
});
