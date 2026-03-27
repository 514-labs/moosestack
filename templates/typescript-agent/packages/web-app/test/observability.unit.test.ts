import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createInMemoryTraceCollectorMock,
  createLangfuseTraceCollectorMock,
  getLangfuseConfigMock,
} = vi.hoisted(() => {
  return {
    createInMemoryTraceCollectorMock: vi.fn(),
    createLangfuseTraceCollectorMock: vi.fn(),
    getLangfuseConfigMock: vi.fn(),
  };
});

vi.mock("@/lib/in-memory-trace-collector", () => {
  return {
    createInMemoryTraceCollector: createInMemoryTraceCollectorMock,
  };
});

vi.mock("agent-observability-langfuse", () => {
  return {
    createLangfuseTraceCollector: createLangfuseTraceCollectorMock,
  };
});

vi.mock("@/env-vars", () => {
  return {
    getLangfuseConfig: getLangfuseConfigMock,
  };
});

import { createTraceCollector } from "../src/lib/observability";

function createCollectorStub() {
  return {
    startTrace: vi.fn(() => "trace-id"),
    recordStep: vi.fn(),
    endTrace: vi.fn(async () => undefined),
  };
}

describe("createTraceCollector", () => {
  beforeEach(() => {
    createInMemoryTraceCollectorMock.mockReset();
    createLangfuseTraceCollectorMock.mockReset();
    getLangfuseConfigMock.mockReset();
  });

  it("falls back to the in-memory collector when Langfuse is not configured", () => {
    const collector = createCollectorStub();
    getLangfuseConfigMock.mockReturnValue(undefined);
    createInMemoryTraceCollectorMock.mockReturnValue(collector);

    expect(createTraceCollector()).toBe(collector);
    expect(createLangfuseTraceCollectorMock).not.toHaveBeenCalled();
  });

  it("uses the Langfuse collector when credentials are configured", () => {
    const collector = createCollectorStub();
    const config = {
      publicKey: "pk",
      secretKey: "sk",
      baseUrl: "https://langfuse.example",
    };

    getLangfuseConfigMock.mockReturnValue(config);
    createLangfuseTraceCollectorMock.mockReturnValue(collector);

    expect(createTraceCollector()).toBe(collector);
    expect(createLangfuseTraceCollectorMock).toHaveBeenCalledWith(config);
  });
});
