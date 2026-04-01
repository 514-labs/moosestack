const BEDROCK_MODEL_ACCESS_PATTERNS = [
  /AccessDeniedException/i,
  /not authorized to invoke/i,
  /model access denied/i,
  /access to the model/i,
  /invoke model/i,
] as const;

export function formatAgentRuntimeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error).trim();

  if (message.length === 0) {
    return "An unexpected model error occurred.";
  }

  if (
    BEDROCK_MODEL_ACCESS_PATTERNS.some((pattern) => {
      return pattern.test(message);
    })
  ) {
    return "Model access denied. Enable model access in the AWS Bedrock console for the selected model, or change `BEDROCK_MODEL_ID` / `AI_PROVIDER`.";
  }

  return message;
}

export class McpServerUnavailableError extends Error {
  readonly endpointUrl: string;

  constructor(endpointUrl: string, cause?: unknown) {
    const causeMessage =
      cause instanceof Error && cause.message.trim().length > 0 ? ` (${cause.message.trim()})` : "";

    super(
      `Cannot connect to MCP server at ${endpointUrl}. Start the local stack with \`pnpm dev:start\`, or start just the Moose service with \`pnpm dev:moose\`, and verify the custom MCP tools endpoint is reachable.${causeMessage}`,
    );
    this.name = "McpServerUnavailableError";
    this.endpointUrl = endpointUrl;
  }
}
