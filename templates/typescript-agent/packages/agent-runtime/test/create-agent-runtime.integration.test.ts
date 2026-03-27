import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const anthropicModelFactory = vi.fn((modelId: string) => {
    return { provider: "anthropic", modelId };
  });
  const bedrockModelFactory = vi.fn((modelId: string) => {
    return { provider: "bedrock", modelId };
  });
  const openAiModelFactory = vi.fn((modelId: string) => {
    return { provider: "openai", modelId };
  });

  return {
    anthropicModelFactory,
    bedrockModelFactory,
    openAiModelFactory,
    createAnthropicMock: vi.fn(() => anthropicModelFactory),
    createAmazonBedrockMock: vi.fn(() => bedrockModelFactory),
    createOpenAiMock: vi.fn(() => openAiModelFactory),
    createUIMessageStreamMock: vi.fn(({ execute }) => {
      return { execute };
    }),
    generateTextMock: vi.fn(),
    streamTextMock: vi.fn(),
    mcpCloseMock: vi.fn(async () => undefined),
    mcpToolsMock: vi.fn(),
    experimentalCreateMcpClientMock: vi.fn(),
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  return {
    ...actual,
    createUIMessageStream: mocks.createUIMessageStreamMock,
    generateText: mocks.generateTextMock,
    streamText: mocks.streamTextMock,
  };
});

vi.mock("@ai-sdk/anthropic", () => {
  return {
    createAnthropic: mocks.createAnthropicMock,
  };
});

vi.mock("@ai-sdk/amazon-bedrock", () => {
  return {
    createAmazonBedrock: mocks.createAmazonBedrockMock,
  };
});

vi.mock("@ai-sdk/openai", () => {
  return {
    createOpenAI: mocks.createOpenAiMock,
  };
});

vi.mock("@ai-sdk/mcp", () => {
  return {
    experimental_createMCPClient: mocks.experimentalCreateMcpClientMock,
  };
});

import {
  createAgentRuntime,
  createMultiAgentStream,
  DEFAULT_AGENT_SYSTEM_PROMPT,
  McpServerUnavailableError,
  resolveMcpServerUrl,
} from "../src/index";

const userMessages = [
  {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "Show me the latest tenant records." }],
  },
] satisfies UIMessage[];

describe("createAgentRuntime", () => {
  beforeEach(() => {
    mocks.createAnthropicMock.mockClear();
    mocks.createAmazonBedrockMock.mockClear();
    mocks.createOpenAiMock.mockClear();
    mocks.anthropicModelFactory.mockClear();
    mocks.bedrockModelFactory.mockClear();
    mocks.openAiModelFactory.mockClear();
    mocks.createUIMessageStreamMock.mockClear();
    mocks.generateTextMock.mockReset();
    mocks.streamTextMock.mockReset();
    mocks.mcpCloseMock.mockClear();
    mocks.mcpToolsMock.mockReset();
    mocks.experimentalCreateMcpClientMock.mockReset();

    mocks.mcpToolsMock.mockResolvedValue({
      query_clickhouse: { description: "Run read-only SQL" },
    });
    mocks.experimentalCreateMcpClientMock.mockResolvedValue({
      tools: mocks.mcpToolsMock,
      close: mocks.mcpCloseMock,
    });
  });

  it("builds an anthropic runtime with bearer-authenticated MCP tools", async () => {
    const runtime = await createAgentRuntime({
      messages: userMessages,
      bearerToken: "tenant-token",
      mcpServerUrl: "http://localhost:4000",
      providerConfig: {
        provider: "anthropic",
        apiKey: "anthropic-key",
      },
      guardrailAdapter: {
        assessPrompt: async () => {
          return {
            action: "NONE",
            details: [],
            latencyMs: 0,
          };
        },
      },
    });

    expect(mocks.createAnthropicMock).toHaveBeenCalledWith({
      apiKey: "anthropic-key",
    });
    expect(mocks.anthropicModelFactory).toHaveBeenCalledWith(
      "claude-haiku-4-5",
    );
    expect(mocks.experimentalCreateMcpClientMock).toHaveBeenCalledWith({
      name: "moose-mcp-server",
      transport: {
        type: "http",
        url: "http://localhost:4000/tools",
        headers: {
          Authorization: "Bearer tenant-token",
        },
      },
    });
    expect(runtime.provider).toBe("anthropic");
    expect(runtime.modelId).toBe("claude-haiku-4-5");
    expect(runtime.system).toBe(DEFAULT_AGENT_SYSTEM_PROMPT);
    expect(runtime.tools).toEqual({
      query_clickhouse: { description: "Run read-only SQL" },
    });

    await runtime.close();

    expect(mocks.mcpCloseMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a full MCP endpoint URL without double-appending /tools", async () => {
    await createAgentRuntime({
      messages: userMessages,
      bearerToken: "tenant-token",
      mcpServerUrl: "http://localhost:4000/tools/",
      providerConfig: {
        provider: "anthropic",
        apiKey: "anthropic-key",
      },
      guardrailAdapter: {
        assessPrompt: async () => {
          return {
            action: "NONE",
            details: [],
            latencyMs: 0,
          };
        },
      },
    });

    expect(mocks.experimentalCreateMcpClientMock).toHaveBeenCalledWith({
      name: "moose-mcp-server",
      transport: {
        type: "http",
        url: "http://localhost:4000/tools",
        headers: {
          Authorization: "Bearer tenant-token",
        },
      },
    });
  });

  it("wraps MCP connection failures with startup guidance", async () => {
    mocks.experimentalCreateMcpClientMock.mockRejectedValueOnce(
      new Error("fetch failed"),
    );

    const runtimePromise = createAgentRuntime({
      messages: userMessages,
      bearerToken: "tenant-token",
      mcpServerUrl: "http://localhost:4000",
      providerConfig: {
        provider: "anthropic",
        apiKey: "anthropic-key",
      },
      guardrailAdapter: {
        assessPrompt: async () => {
          return {
            action: "NONE",
            details: [],
            latencyMs: 0,
          };
        },
      },
    });

    await expect(runtimePromise).rejects.toEqual(
      expect.objectContaining({
        name: "McpServerUnavailableError",
        endpointUrl: "http://localhost:4000/tools",
      }),
    );

    await expect(runtimePromise).rejects.toBeInstanceOf(
      McpServerUnavailableError,
    );
  });

  it("supports explicit Bedrock model selection", async () => {
    const runtime = await createAgentRuntime({
      messages: userMessages,
      bearerToken: "tenant-token",
      mcpServerUrl: "http://localhost:4000",
      providerConfig: {
        provider: "bedrock",
        awsRegion: "us-west-2",
        modelId: "anthropic.claude-3-5-haiku-20241022-v1:0",
      },
      guardrailAdapter: {
        assessPrompt: async () => {
          return {
            action: "NONE",
            details: [],
            latencyMs: 0,
          };
        },
      },
      systemPrompt: "Custom prompt",
      maxSteps: 5,
    });

    expect(mocks.createAmazonBedrockMock).toHaveBeenCalledWith({
      region: "us-west-2",
    });
    expect(mocks.bedrockModelFactory).toHaveBeenCalledWith(
      "anthropic.claude-3-5-haiku-20241022-v1:0",
    );
    expect(runtime.provider).toBe("bedrock");
    expect(runtime.modelId).toBe("anthropic.claude-3-5-haiku-20241022-v1:0");
    expect(runtime.system).toBe("Custom prompt");
  });

  it("normalizes MCP URLs from either a base service URL or a full endpoint", () => {
    expect(resolveMcpServerUrl("http://localhost:4000")).toBe(
      "http://localhost:4000/tools",
    );
    expect(resolveMcpServerUrl("http://localhost:4000/")).toBe(
      "http://localhost:4000/tools",
    );
    expect(resolveMcpServerUrl("http://localhost:4000/tools")).toBe(
      "http://localhost:4000/tools",
    );
    expect(resolveMcpServerUrl("http://localhost:4000/custom")).toBe(
      "http://localhost:4000/custom/tools",
    );
  });

  it("orchestrates supervisor, specialist, and narrator stages", async () => {
    const traceCollector = {
      startTrace: vi.fn(() => "trace-1"),
      recordStep: vi.fn(),
      endTrace: vi.fn(async () => undefined),
    };
    const workerUiStream = { name: "worker-ui-stream" };
    const narratorUiStream = { name: "narrator-ui-stream" };
    const workerResult = {
      toUIMessageStream: vi.fn(() => workerUiStream),
      text: Promise.resolve("Worker notes from the sql investigator."),
      totalUsage: Promise.resolve({
        inputTokens: 11,
        outputTokens: 7,
      }),
    };
    const narratorResult = {
      toUIMessageStream: vi.fn(() => narratorUiStream),
      totalUsage: Promise.resolve({
        inputTokens: 5,
        outputTokens: 6,
      }),
    };

    mocks.generateTextMock.mockResolvedValue({
      text: "sql-investigator",
      totalUsage: {
        inputTokens: 2,
        outputTokens: 1,
      },
    });
    mocks.streamTextMock
      .mockReturnValueOnce(workerResult)
      .mockReturnValueOnce(narratorResult);

    await createMultiAgentStream({
      messages: userMessages,
      bearerToken: "tenant-token",
      tenantId: "acme",
      mcpServerUrl: "http://localhost:4000",
      providerConfig: {
        provider: "anthropic",
        apiKey: "anthropic-key",
      },
      guardrailAdapter: {
        assessPrompt: async () => {
          return {
            action: "NONE",
            details: [],
            latencyMs: 0,
          };
        },
      },
      traceCollector,
    });

    const execute = mocks.createUIMessageStreamMock.mock.calls[0][0].execute;
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: vi.fn(),
    };

    await execute({ writer });

    expect(mocks.generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Route the latest user request"),
      }),
    );
    expect(mocks.streamTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        system: expect.stringContaining("sql-investigator"),
        tools: expect.objectContaining({
          query_clickhouse: expect.anything(),
        }),
      }),
    );
    expect(mocks.streamTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        system: expect.stringContaining("You are the narrator"),
      }),
    );
    expect(workerResult.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({
        sendStart: false,
        sendFinish: false,
      }),
    );
    expect(narratorResult.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({
        sendStart: false,
      }),
    );
    expect(writer.merge).toHaveBeenNthCalledWith(1, workerUiStream);
    expect(writer.merge).toHaveBeenNthCalledWith(2, narratorUiStream);

    const emittedText = writer.write.mock.calls
      .map(([part]) => ("delta" in part ? part.delta : ""))
      .join("");
    expect(emittedText).toContain("[AGENT:supervisor]");
    expect(emittedText).toContain("[AGENT:sql-investigator]");
    expect(emittedText).toContain("[AGENT:narrator]");

    expect(
      traceCollector.recordStep.mock.calls.map(([, step]) => step.toolName),
    ).toEqual(["supervisor", "sql-investigator", "narrator"]);
    expect(traceCollector.endTrace).toHaveBeenCalledWith(
      "trace-1",
      expect.objectContaining({
        status: "completed",
        totalSteps: 3,
        totalInputTokens: 18,
        totalOutputTokens: 14,
      }),
    );
    expect(mocks.mcpCloseMock).toHaveBeenCalledTimes(1);
  });
});
