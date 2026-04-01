import { getAiProvider, getMcpServerUrl } from "@/env-vars";

const MCP_HEALTHCHECK_TIMEOUT_MS = 1500;
const MCP_READY_STATUS_CODES = new Set([200, 400, 401, 405]);

export interface ProviderStatus {
  provider: "anthropic" | "openai" | "bedrock";
  providerLabel: string;
  providerReady: boolean;
  guardrailsConfigured: boolean;
  status: "ready" | "missing_key";
  details?: string;
}

export interface ChatProviderStatus extends ProviderStatus {
  mcpReady: boolean;
  mcpStatus: "ready" | "unavailable";
  mcpUrl: string | null;
  mcpDetails?: string;
}

function getBedrockReadinessDetails() {
  if (!process.env.AWS_REGION) {
    return "Set AWS_REGION before using Amazon Bedrock.";
  }

  return undefined;
}

export function getProviderStatus(): ProviderStatus {
  const provider = getAiProvider();

  if (provider === "openai") {
    const providerReady = !!process.env.OPENAI_API_KEY;
    return {
      provider,
      providerLabel: "OpenAI",
      providerReady,
      guardrailsConfigured: false,
      status: providerReady ? "ready" : "missing_key",
      details: providerReady ? undefined : "Set OPENAI_API_KEY before using the chat feature.",
    };
  }

  if (provider === "bedrock") {
    const details = getBedrockReadinessDetails();
    const providerReady = !details;

    return {
      provider,
      providerLabel: "Amazon Bedrock",
      providerReady,
      guardrailsConfigured: !!process.env.BEDROCK_GUARDRAIL_ID,
      status: providerReady ? "ready" : "missing_key",
      details,
    };
  }

  const providerReady = !!process.env.ANTHROPIC_API_KEY;
  return {
    provider,
    providerLabel: "Anthropic",
    providerReady,
    guardrailsConfigured: false,
    status: providerReady ? "ready" : "missing_key",
    details: providerReady ? undefined : "Set ANTHROPIC_API_KEY before using the chat feature.",
  };
}

function getMcpTimeoutSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(MCP_HEALTHCHECK_TIMEOUT_MS);
  }

  return undefined;
}

function formatMcpUnavailableMessage(endpointUrl: string | null, cause?: unknown): string {
  const locationSuffix = endpointUrl ? ` at ${endpointUrl}` : "";
  const causeMessage =
    cause instanceof Error && cause.message.trim().length > 0 ? ` (${cause.message.trim()})` : "";

  return (
    `Cannot connect to MCP server${locationSuffix}. Start the local stack with \`pnpm dev:start\`, or start just the Moose service with \`pnpm dev:moose\`, and verify the custom MCP tools endpoint is reachable.` +
    causeMessage
  );
}

export async function getChatProviderStatus(): Promise<ChatProviderStatus> {
  const providerStatus = getProviderStatus();

  let mcpUrl: string | null = null;
  try {
    mcpUrl = getMcpServerUrl();
  } catch (error) {
    return {
      ...providerStatus,
      mcpReady: false,
      mcpStatus: "unavailable",
      mcpUrl: null,
      mcpDetails: formatMcpUnavailableMessage(null, error),
    };
  }

  try {
    const response = await fetch(mcpUrl, {
      method: "GET",
      cache: "no-store",
      signal: getMcpTimeoutSignal(),
    });

    if (MCP_READY_STATUS_CODES.has(response.status)) {
      return {
        ...providerStatus,
        mcpReady: true,
        mcpStatus: "ready",
        mcpUrl,
      };
    }

    return {
      ...providerStatus,
      mcpReady: false,
      mcpStatus: "unavailable",
      mcpUrl,
      mcpDetails: `MCP server responded with ${response.status} ${response.statusText}. Verify ${mcpUrl} points to the custom MCP tools endpoint.`,
    };
  } catch (error) {
    return {
      ...providerStatus,
      mcpReady: false,
      mcpStatus: "unavailable",
      mcpUrl,
      mcpDetails: formatMcpUnavailableMessage(mcpUrl, error),
    };
  }
}

export function assertProviderReady() {
  const status = getProviderStatus();
  if (!status.providerReady) {
    throw new Error(status.details ?? `${status.providerLabel} is not configured.`);
  }
}
