export function getMcpServerUrl(): string {
  const value = process.env.MCP_SERVER_URL;

  if (!value) {
    throw new Error("MCP_SERVER_URL environment variable is not set");
  }

  return value;
}

export function getAnthropicApiKey(): string {
  const value = process.env.ANTHROPIC_API_KEY;

  if (!value) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  return value;
}
