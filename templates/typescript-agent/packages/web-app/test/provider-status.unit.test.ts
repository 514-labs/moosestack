import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAiProviderMock, getMcpServerUrlMock } = vi.hoisted(() => {
  return {
    getAiProviderMock: vi.fn(() => "anthropic"),
    getMcpServerUrlMock: vi.fn(() => "http://localhost:4000/tools"),
  };
});

vi.mock("@/env-vars", () => {
  return {
    getAiProvider: getAiProviderMock,
    getMcpServerUrl: getMcpServerUrlMock,
  };
});

import { getChatProviderStatus } from "../src/lib/provider-status";

describe("getChatProviderStatus", () => {
  let previousAnthropicApiKey: string | undefined;

  beforeEach(() => {
    previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    getAiProviderMock.mockReset();
    getMcpServerUrlMock.mockReset();
    getAiProviderMock.mockReturnValue("anthropic");
    getMcpServerUrlMock.mockReturnValue("http://localhost:4000/tools");
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
  });

  afterEach(() => {
    if (previousAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks MCP as ready when the endpoint is reachable but requires auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        });
      }),
    );

    const status = await getChatProviderStatus();

    expect(status.providerReady).toBe(true);
    expect(status.mcpReady).toBe(true);
    expect(status.mcpStatus).toBe("ready");
    expect(status.mcpUrl).toBe("http://localhost:4000/tools");
  });

  it("returns startup guidance when the MCP endpoint is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const status = await getChatProviderStatus();

    expect(status.providerReady).toBe(true);
    expect(status.mcpReady).toBe(false);
    expect(status.mcpStatus).toBe("unavailable");
    expect(status.mcpDetails).toContain("http://localhost:4000/tools");
    expect(status.mcpDetails).toContain("pnpm dev:moose");
  });
});
