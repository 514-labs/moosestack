import { describe, expect, it, vi } from "vitest";
import { createTraceSession } from "../src/streams/trace-session";

describe("createTraceSession", () => {
  it("redacts prompts and step notes before forwarding them to collectors", async () => {
    const traceCollector = {
      startTrace: vi.fn(() => "trace-1"),
      recordStep: vi.fn(),
      endTrace: vi.fn(async () => undefined),
    };
    const runtime = {
      provider: "anthropic" as const,
      modelId: "claude-haiku-4-5",
      close: vi.fn(async () => undefined),
    };
    const session = createTraceSession(
      {
        accessScopeId: "org_a",
        traceCollector,
      },
      runtime,
      "Show me the most recent revenue rows for this organization.",
    );

    session.recordStep({
      stepId: "step-1",
      traceId: session.traceId,
      accessScopeId: "org_a",
      stepType: "tool",
      toolName: "query_tenant_knowledge_metrics",
      status: "completed",
      notes: "Queried organization knowledge metrics for the last 7 days.",
      startedAt: new Date("2026-03-28T12:00:00.000Z").toISOString(),
      durationMs: 42,
      inputTokens: 0,
      outputTokens: 0,
    });

    await session.finalizeTrace({
      guardrailAction: "none",
      status: "completed",
      totalSteps: 1,
      totalInputTokens: 12,
      totalOutputTokens: 8,
    });

    expect(traceCollector.startTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringMatching(/^\[redacted prompt; \d+ chars\]$/),
      }),
    );
    expect(traceCollector.recordStep).toHaveBeenCalledWith(
      "trace-1",
      expect.objectContaining({
        notes: expect.stringMatching(/^\[redacted tool payload; \d+ chars\]$/),
      }),
    );
    expect(traceCollector.endTrace).toHaveBeenCalledWith(
      "trace-1",
      expect.objectContaining({
        prompt: expect.stringMatching(/^\[redacted prompt; \d+ chars\]$/),
      }),
    );
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("treats collector failures as best-effort and still closes the runtime", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const traceCollector = {
      startTrace: vi.fn(() => "trace-2"),
      recordStep: vi.fn(() => {
        throw new Error("record step failed");
      }),
      endTrace: vi.fn(async () => {
        throw new Error("end trace failed");
      }),
    };
    const runtime = {
      provider: "anthropic" as const,
      modelId: "claude-haiku-4-5",
      close: vi.fn(async () => undefined),
    };
    const session = createTraceSession(
      {
        accessScopeId: "org_a",
        traceCollector,
      },
      runtime,
      "Show me the organization summary.",
    );

    expect(() =>
      session.recordStep({
        stepId: "step-2",
        traceId: session.traceId,
        accessScopeId: "org_a",
        stepType: "agent",
        toolName: "narrator",
        status: "failed",
        notes: "Trace collector failure should not break the request",
        startedAt: new Date("2026-03-28T12:00:00.000Z").toISOString(),
        durationMs: 12,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).not.toThrow();

    await expect(
      session.finalizeTrace({
        guardrailAction: "none",
        status: "failed",
        totalSteps: 1,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }),
    ).resolves.toBeUndefined();

    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("falls back to a local trace id when the collector cannot start a trace", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const traceCollector = {
      startTrace: vi.fn(() => {
        throw new Error("start trace failed");
      }),
      recordStep: vi.fn(),
      endTrace: vi.fn(async () => undefined),
    };
    const runtime = {
      provider: "anthropic" as const,
      modelId: "claude-haiku-4-5",
      close: vi.fn(async () => undefined),
    };
    const session = createTraceSession(
      {
        accessScopeId: "org_a",
        traceCollector,
      },
      runtime,
      "Show me the organization summary.",
    );

    expect(session.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    session.recordStep({
      stepId: "step-3",
      traceId: session.traceId,
      accessScopeId: "org_a",
      stepType: "agent",
      toolName: "supervisor",
      status: "completed",
      notes: "Route to metrics-investigator",
      startedAt: new Date("2026-03-28T12:00:00.000Z").toISOString(),
      durationMs: 12,
      inputTokens: 0,
      outputTokens: 0,
    });

    await expect(
      session.finalizeTrace({
        guardrailAction: "none",
        status: "completed",
        totalSteps: 1,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }),
    ).resolves.toBeUndefined();

    expect(traceCollector.recordStep).not.toHaveBeenCalled();
    expect(traceCollector.endTrace).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
