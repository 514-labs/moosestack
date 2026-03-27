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
});
