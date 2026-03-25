export type JsonPrimitive = boolean | null | number | string;
export type JsonArray = JsonValue[];
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface SqlToolsConnection {
  name: string;
  [key: string]: JsonValue | undefined;
}

export interface SettingsFile extends JsonObject {
  "python.analysis.extraPaths"?: string[];
  "sqltools.connections"?: SqlToolsConnection[];
}

export interface ExtensionsFile extends JsonObject {
  recommendations?: string[];
  unwantedRecommendations?: string[];
}

export interface McpConfig extends JsonObject {
  mcpServers?: JsonObject;
}

export interface TemplateInfo {
  description: string;
  language: string;
  name: string;
}

export interface TemplateListResponse {
  schema_version: number;
  template_version: string;
  templates?: TemplateInfo[];
}

export interface DiscoveredProject {
  label: string;
  projectRoot: string;
  workspaceRoot: string;
}

export interface ExtensionState {
  activeProject: string | null;
  cliInstallRan: boolean;
  discoveredProjects: DiscoveredProject[];
  installedExtensions: string[];
}

export interface CommandResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
}
