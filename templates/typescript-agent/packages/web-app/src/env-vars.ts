export function getMooseServiceUrl(): string {
  const value = process.env.MOOSE_SERVICE_URL ?? process.env.MCP_SERVER_URL;

  if (!value) {
    throw new Error("MOOSE_SERVICE_URL environment variable is not set");
  }

  return value;
}

export function getMcpServerUrl(): string {
  return getMooseServiceUrl();
}

export function getAiProvider(): "anthropic" | "openai" | "bedrock" {
  const value = process.env.AI_PROVIDER ?? "anthropic";

  if (value !== "anthropic" && value !== "openai" && value !== "bedrock") {
    throw new Error("AI_PROVIDER must be one of anthropic, openai, or bedrock");
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

export function getOpenAiApiKey(): string {
  const value = process.env.OPENAI_API_KEY;

  if (!value) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  return value;
}

export function getAwsRegion(): string {
  return process.env.AWS_REGION ?? "us-east-1";
}

export function getBedrockModelId(): string {
  const value = process.env.BEDROCK_MODEL_ID;

  if (!value) {
    throw new Error("BEDROCK_MODEL_ID environment variable is not set");
  }

  return value;
}

export function getAuthMode(): "local" | "oidc" {
  const value = process.env.MOOSE_AUTH_MODE ?? "local";

  if (value !== "local" && value !== "oidc") {
    throw new Error("MOOSE_AUTH_MODE must be either local or oidc");
  }

  return value;
}

export function getOidcConfig():
  | { issuer: string; clientId: string; clientSecret: string }
  | undefined {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    return undefined;
  }

  return { issuer, clientId, clientSecret };
}

export function getOidcTenantClaim(): string {
  return process.env.OIDC_TENANT_CLAIM ?? "tenant_id";
}

export function getLangfuseConfig():
  | { publicKey: string; secretKey: string; baseUrl: string }
  | undefined {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return undefined;
  }

  return {
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
  };
}

export function getBedrockGuardrailConfig():
  | { id: string; version: string; region: string }
  | undefined {
  const id = process.env.BEDROCK_GUARDRAIL_ID;

  if (!id) {
    return undefined;
  }

  return {
    id,
    version: process.env.BEDROCK_GUARDRAIL_VERSION ?? "DRAFT",
    region: getAwsRegion(),
  };
}
