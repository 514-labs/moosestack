interface AgentInitFieldDefinition {
  enum?: readonly number[] | readonly string[];
}

interface AgentInitAgentsField {
  items?: AgentInitFieldDefinition;
}

interface AgentInitSchemaFields {
  agents?: AgentInitAgentsField;
  version?: AgentInitFieldDefinition;
}

interface AgentInitSchemaPayload {
  fields?: AgentInitSchemaFields;
  input_format?: string;
  version?: number;
}

interface AgentInitResponsePayload {
  message?: string;
  status?: string;
}

export interface AgentInitSchema {
  requestVersion: number;
  schemaVersion: number;
  supportedAgents: string[];
}

export interface AgentInitRequest {
  agents: string[];
  version: number;
  yes: true;
}

export interface AgentInitResponse {
  message?: string;
  status?: string;
}

export class AgentInitCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInitCompatibilityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function getNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is number => typeof entry === "number");
}

function parseJson<T>(output: string, command: string): T {
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const preview = output.trim().slice(0, 200);
    throw new AgentInitCompatibilityError(
      `Failed to parse \`${command}\` output: ${message}. Output preview: ${preview}`,
    );
  }
}

export function inferAgentId(
  appName: string,
  uriScheme?: string,
): "cursor" | "kiro" | "vscode" | null {
  const normalizedAppName = appName.trim().toLowerCase();
  const normalizedUriScheme = (uriScheme ?? "").trim().toLowerCase();

  if (
    normalizedUriScheme.includes("cursor") ||
    normalizedAppName.includes("cursor")
  ) {
    return "cursor";
  }

  if (
    normalizedUriScheme.includes("kiro") ||
    normalizedAppName.includes("kiro")
  ) {
    return "kiro";
  }

  if (
    normalizedUriScheme === "vscode" ||
    normalizedUriScheme === "code-oss" ||
    normalizedUriScheme === "vscodium" ||
    normalizedAppName.includes("visual studio code") ||
    normalizedAppName.includes("code - oss") ||
    normalizedAppName.includes("vscodium")
  ) {
    return "vscode";
  }

  return null;
}

export function parseAgentInitSchema(output: string): AgentInitSchema {
  const parsed = parseJson<AgentInitSchemaPayload>(
    output,
    "514 agent init schema --json",
  );

  if (parsed.version !== 1) {
    throw new AgentInitCompatibilityError(
      `Unsupported 514 agent init schema version: ${String(parsed.version)}.`,
    );
  }

  if (parsed.input_format !== "json") {
    throw new AgentInitCompatibilityError(
      "Installed 514 CLI does not advertise JSON input support for `agent init`.",
    );
  }

  const versionField = parsed.fields?.version;
  const requestVersions = getNumberArray(versionField?.enum);
  const requestVersion = requestVersions.find((version) => version === 1);
  if (requestVersion === undefined) {
    throw new AgentInitCompatibilityError(
      "Installed 514 CLI did not advertise a supported `agent init` request version.",
    );
  }

  const agentsField = parsed.fields?.agents;
  const supportedAgents = getStringArray(agentsField?.items?.enum);
  if (supportedAgents.length === 0) {
    throw new AgentInitCompatibilityError(
      "Installed 514 CLI did not advertise any supported agent ids.",
    );
  }

  return {
    requestVersion,
    schemaVersion: parsed.version,
    supportedAgents,
  };
}

export function buildAgentInitRequest(
  schema: AgentInitSchema,
  agentId: string,
): AgentInitRequest {
  if (!schema.supportedAgents.includes(agentId)) {
    throw new AgentInitCompatibilityError(
      `Installed 514 CLI does not support the \`${agentId}\` agent id for \`514 agent init\`.`,
    );
  }

  return {
    agents: [agentId],
    version: schema.requestVersion,
    yes: true,
  };
}

export function parseAgentInitResponse(
  output: string,
): AgentInitResponse | null {
  const trimmedOutput = output.trim();
  if (!trimmedOutput) {
    return null;
  }

  const parsed = parseJson<AgentInitResponsePayload>(
    trimmedOutput,
    "514 agent init --json",
  );
  if (!isRecord(parsed)) {
    throw new AgentInitCompatibilityError(
      "`514 agent init --json` returned a non-object JSON payload.",
    );
  }

  return {
    message: typeof parsed.message === "string" ? parsed.message : undefined,
    status: typeof parsed.status === "string" ? parsed.status : undefined,
  };
}
