import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMcpServerUrl,
  getAnthropicApiKey,
  getMcpApiToken,
} from "../../packages/web-app/src/env-vars";

describe("getMcpServerUrl", () => {
  const originalEnv = process.env.MCP_SERVER_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_SERVER_URL = originalEnv;
    } else {
      delete process.env.MCP_SERVER_URL;
    }
  });

  it("returns the URL when set", () => {
    process.env.MCP_SERVER_URL = "http://localhost:4000";
    expect(getMcpServerUrl()).toBe("http://localhost:4000");
  });

  it("throws when not set", () => {
    delete process.env.MCP_SERVER_URL;
    expect(() => getMcpServerUrl()).toThrow(
      "MCP_SERVER_URL environment variable is not set",
    );
  });
});

describe("getAnthropicApiKey", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("returns the key when set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-123";
    expect(getAnthropicApiKey()).toBe("sk-ant-test-123");
  });

  it("throws when not set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => getAnthropicApiKey()).toThrow(
      "ANTHROPIC_API_KEY environment variable is not set",
    );
  });
});

describe("getMcpApiToken", () => {
  const originalEnv = process.env.MCP_API_TOKEN;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_API_TOKEN = originalEnv;
    } else {
      delete process.env.MCP_API_TOKEN;
    }
  });

  it("returns the token when set", () => {
    process.env.MCP_API_TOKEN = "test-bearer-token";
    expect(getMcpApiToken()).toBe("test-bearer-token");
  });

  it("returns undefined when not set", () => {
    delete process.env.MCP_API_TOKEN;
    expect(getMcpApiToken()).toBeUndefined();
  });

  it("returns undefined when empty string", () => {
    process.env.MCP_API_TOKEN = "";
    expect(getMcpApiToken()).toBeUndefined();
  });
});
