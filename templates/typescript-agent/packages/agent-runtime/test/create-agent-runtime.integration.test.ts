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
    mcpCloseMock: vi.fn(async () => undefined),
    mcpToolsMock: vi.fn(),
    experimentalCreateMcpClientMock: vi.fn(),
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

import { createAgentRuntime, DEFAULT_AGENT_SYSTEM_PROMPT } from "../src/index";

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
});
