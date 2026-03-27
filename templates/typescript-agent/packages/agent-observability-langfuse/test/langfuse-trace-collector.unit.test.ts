import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const generationMock = vi.fn();
  const updateMock = vi.fn();
  const traceMock = vi.fn(() => {
    return {
      generation: generationMock,
      update: updateMock,
    };
  });
  const flushAsyncMock = vi.fn(async () => undefined);
  const LangfuseMock = vi.fn(() => {
    return {
      trace: traceMock,
      flushAsync: flushAsyncMock,
    };
  });

  return {
    flushAsyncMock,
    generationMock,
    LangfuseMock,
    traceMock,
    updateMock,
  };
});

vi.mock("langfuse", () => {
  return {
    Langfuse: mocks.LangfuseMock,
  };
});

import { createLangfuseTraceCollector } from "../src/index";

describe("createLangfuseTraceCollector", () => {
  beforeEach(() => {
    mocks.LangfuseMock.mockClear();
    mocks.traceMock.mockClear();
    mocks.generationMock.mockClear();
    mocks.updateMock.mockClear();
    mocks.flushAsyncMock.mockClear();
  });

  it("flushes and removes completed traces from memory", async () => {
    const collector = createLangfuseTraceCollector({
      publicKey: "public-key",
      secretKey: "secret-key",
      baseUrl: "https://langfuse.example.com",
    });
    const traceId = collector.startTrace({
      tenantId: "acme",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      prompt: "Show tenant records",
    });
    const traces = Reflect.get(collector as object, "traces") as Map<
      string,
      unknown
    >;

    expect(traces.size).toBe(1);

    await collector.endTrace(traceId, {
      traceId,
      tenantId: "acme",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      prompt: "Show tenant records",
      startedAt: new Date("2026-03-27T12:00:00.000Z").toISOString(),
      completedAt: new Date("2026-03-27T12:00:01.000Z").toISOString(),
      totalDurationMs: 1000,
      status: "completed",
      guardrailAction: "none",
      totalSteps: 2,
      totalInputTokens: 12,
      totalOutputTokens: 8,
    });

    expect(mocks.flushAsyncMock).toHaveBeenCalledTimes(1);
    expect(traces.size).toBe(0);
  });
});
