import { getAiProvider } from "../env-vars";

const LOCAL_AWS_CREDENTIAL_HINTS = [
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ROLE_ARN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
] as const;

export interface ProviderStatus {
  provider: "anthropic" | "openai" | "bedrock";
  providerLabel: string;
  providerReady: boolean;
  guardrailsConfigured: boolean;
  status: "ready" | "missing_key";
  details?: string;
}

function hasLocalBedrockCredentialHints() {
  return LOCAL_AWS_CREDENTIAL_HINTS.some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0;
  });
}

function getBedrockReadinessDetails() {
  if (!process.env.AWS_REGION) {
    return "Set AWS_REGION before using Amazon Bedrock.";
  }

  if (!process.env.BEDROCK_MODEL_ID) {
    return "Set BEDROCK_MODEL_ID before using Amazon Bedrock.";
  }

  if (
    process.env.NODE_ENV !== "production" &&
    !hasLocalBedrockCredentialHints()
  ) {
    return "Bedrock is selected, but no local AWS credentials were detected. Set AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.";
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
      details:
        providerReady ? undefined : (
          "Set OPENAI_API_KEY before using the chat feature."
        ),
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
    details:
      providerReady ? undefined : (
        "Set ANTHROPIC_API_KEY before using the chat feature."
      ),
  };
}

export function assertProviderReady() {
  const status = getProviderStatus();
  if (!status.providerReady) {
    throw new Error(
      status.details ?? `${status.providerLabel} is not configured.`,
    );
  }
}
