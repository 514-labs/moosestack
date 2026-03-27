import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadEnvVarsModule() {
  vi.resetModules();
  return await import("../src/env-vars");
}

describe("env-vars", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MOOSE_SERVICE_URL;
    delete process.env.MCP_SERVER_URL;
    delete process.env.ANTHROPIC_MODEL_ID;
    delete process.env.OPENAI_MODEL_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("derives the MCP endpoint from the canonical Moose service URL", async () => {
    process.env.MOOSE_SERVICE_URL = "http://localhost:4000/";

    const { getMcpServerUrl, getMooseServiceUrl } = await loadEnvVarsModule();

    expect(getMooseServiceUrl()).toBe("http://localhost:4000");
    expect(getMcpServerUrl()).toBe("http://localhost:4000/tools");
  });

  it("treats the legacy MCP_SERVER_URL alias as a full endpoint override", async () => {
    process.env.MCP_SERVER_URL = "http://localhost:4000/tools/";

    const { getMcpServerUrl, getMooseServiceUrl } = await loadEnvVarsModule();

    expect(getMooseServiceUrl()).toBe("http://localhost:4000");
    expect(getMcpServerUrl()).toBe("http://localhost:4000/tools");
  });

  it("strips a trailing /tools suffix from a misconfigured MOOSE_SERVICE_URL", async () => {
    process.env.MOOSE_SERVICE_URL = "http://localhost:4000/tools";

    const { getMcpServerUrl, getMooseServiceUrl } = await loadEnvVarsModule();

    expect(getMooseServiceUrl()).toBe("http://localhost:4000");
    expect(getMcpServerUrl()).toBe("http://localhost:4000/tools");
  });

  it("returns actionable guidance when MOOSE_SERVICE_URL is missing", async () => {
    const { getMooseServiceUrl } = await loadEnvVarsModule();

    expect(() => getMooseServiceUrl()).toThrow(/pnpm env:prepare/);
  });

  it("exposes configurable provider model IDs with safe defaults", async () => {
    process.env.ANTHROPIC_MODEL_ID = "claude-custom";
    process.env.OPENAI_MODEL_ID = "gpt-custom";

    const { getAnthropicModelId, getOpenAiModelId } = await loadEnvVarsModule();

    expect(getAnthropicModelId()).toBe("claude-custom");
    expect(getOpenAiModelId()).toBe("gpt-custom");
  });
});
