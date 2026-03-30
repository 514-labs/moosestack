import { describe, expect, it } from "vitest";
import { createInMemoryTraceCollector } from "../src/lib/in-memory-trace-collector";

describe("createInMemoryTraceCollector", () => {
  it("implements the trace collector contract without throwing", async () => {
    const collector = createInMemoryTraceCollector();
    const traceId = collector.startTrace({
      tenantId: "acme",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      prompt: "Show me the latest records.",
    });

    collector.recordStep(traceId, {
      stepId: "step-1",
      traceId,
      tenantId: "acme",
      stepType: "agent",
      toolName: "supervisor",
      status: "completed",
      notes: "routed_to=sql-investigator",
      startedAt: new Date().toISOString(),
      durationMs: 12,
      inputTokens: 3,
      outputTokens: 2,
    });
    collector.recordStep("missing-trace", {
      stepId: "step-2",
      traceId: "missing-trace",
      tenantId: "acme",
      stepType: "tool",
      toolName: "query_clickhouse",
      status: "completed",
      notes: "SELECT 1",
      startedAt: new Date().toISOString(),
      durationMs: 4,
      inputTokens: 0,
      outputTokens: 0,
    });

    await expect(
      collector.endTrace(traceId, {
        traceId,
        tenantId: "acme",
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
