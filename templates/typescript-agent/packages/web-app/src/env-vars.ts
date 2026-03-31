import "server-only";

const MCP_ENDPOINT_PATH = "/tools";

function missingEnvError(envVarName: string, guidance: string): Error {
  return new Error(`${envVarName} is not set. ${guidance}`);
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

function formatUrl(url: URL): string {
  if (url.pathname === "/" && !url.search && !url.hash) {
    return url.origin;
  }

  return url.toString().replace(/\/$/, "");
}

function parseUrl(value: string, envVarName: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${envVarName} must be a valid URL`);
  }
}

function stripMcpEndpointPath(pathname: string): string {
  if (pathname === MCP_ENDPOINT_PATH) {
    return "/";
  }

  if (pathname.endsWith(MCP_ENDPOINT_PATH)) {
    const basePath = pathname.slice(0, -MCP_ENDPOINT_PATH.length);
    return basePath.length > 0 ? basePath : "/";
  }

  return pathname;
}

function normalizeMooseServiceUrl(value: string, envVarName: string): string {
  const url = parseUrl(value, envVarName);
  const pathname = normalizePathname(url.pathname);
  url.pathname = stripMcpEndpointPath(pathname);
  return formatUrl(url);
}

function normalizeMcpServerUrl(value: string, envVarName: string): string {
  const url = parseUrl(value, envVarName);
  const pathname = normalizePathname(url.pathname);

  url.pathname =
    pathname === "/" ? MCP_ENDPOINT_PATH
    : pathname.endsWith(MCP_ENDPOINT_PATH) ? pathname
    : `${pathname}${MCP_ENDPOINT_PATH}`;

  return formatUrl(url);
}

export function getMooseServiceUrl(): string {
  const primaryValue = process.env.MOOSE_SERVICE_URL;
  if (primaryValue) {
    return normalizeMooseServiceUrl(primaryValue, "MOOSE_SERVICE_URL");
  }

  const legacyValue = process.env.MCP_SERVER_URL;
  if (legacyValue) {
    return normalizeMooseServiceUrl(legacyValue, "MCP_SERVER_URL");
  }

  if (!primaryValue && !legacyValue) {
    throw missingEnvError(
      "MOOSE_SERVICE_URL",
      "Run `pnpm env:prepare` to create local env files, or set it in `packages/web-app/.env.local`.",
    );
  }

  throw missingEnvError(
    "MOOSE_SERVICE_URL",
    "Run `pnpm env:prepare` to create local env files, or set it in `packages/web-app/.env.local`.",
  );
}

export function getMcpServerUrl(): string {
  const override = process.env.MCP_SERVER_URL;
  if (override) {
    return normalizeMcpServerUrl(override, "MCP_SERVER_URL");
  }

  return normalizeMcpServerUrl(getMooseServiceUrl(), "MOOSE_SERVICE_URL");
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
    throw missingEnvError(
      "ANTHROPIC_API_KEY",
      "Add it to `packages/web-app/.env.local`, or switch `AI_PROVIDER` to `openai` or `bedrock`.",
    );
  }

  return value;
}

export function getAnthropicModelId(): string {
  return process.env.ANTHROPIC_MODEL_ID ?? "claude-haiku-4-5";
}

export function getOpenAiApiKey(): string {
  const value = process.env.OPENAI_API_KEY;

  if (!value) {
    throw missingEnvError(
      "OPENAI_API_KEY",
      "Add it to `packages/web-app/.env.local`, or switch `AI_PROVIDER` to `anthropic` or `bedrock`.",
    );
  }

  return value;
}

export function getOpenAiModelId(): string {
  return process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini";
}

export function getAwsRegion(): string {
  return process.env.AWS_REGION ?? "us-east-1";
}

export function getBedrockModelId(): string {
  const value = process.env.BEDROCK_MODEL_ID;

  if (!value) {
    throw missingEnvError(
      "BEDROCK_MODEL_ID",
      "Add it to `packages/web-app/.env.local` when `AI_PROVIDER=bedrock`.",
    );
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

  const configuredEntries = [
    ["OIDC_ISSUER", issuer],
    ["OIDC_CLIENT_ID", clientId],
    ["OIDC_CLIENT_SECRET", clientSecret],
  ] as const;
  const populatedEntries = configuredEntries.filter(([, value]) =>
    Boolean(value),
  );

  if (populatedEntries.length === 0) {
    return undefined;
  }

  if (populatedEntries.length !== configuredEntries.length) {
    const missingEnvVars = configuredEntries
      .filter(([, value]) => !value)
      .map(([envVarName]) => envVarName);

    throw new Error(
      `OIDC configuration is incomplete. Set ${missingEnvVars.join(", ")} or clear the partial OIDC env vars in \`packages/web-app/.env.local\`.`,
    );
  }

  if (!issuer || !clientId || !clientSecret) {
    throw new Error("OIDC configuration validation failed unexpectedly.");
  }

  return {
    issuer,
    clientId,
    clientSecret,
  };
}

export function getOidcOrgClaim(): string {
  return process.env.OIDC_ORG_CLAIM ?? "org_id";
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
