import type * as vscode from "vscode";

import { runProcess } from "./processRunner";
import type { TemplateInfo, TemplateListResponse } from "./types";

const SUPPORTED_TEMPLATE_LIST_SCHEMA_VERSION = 1;

export function parseTemplateListResponse(output: string): TemplateInfo[] {
  let parsed: TemplateListResponse;
  try {
    parsed = JSON.parse(output) as TemplateListResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const preview = output.trim().slice(0, 200);
    throw new Error(
      `Failed to parse \`moose template list --json\` output: ${message}. Output preview: ${preview}`,
    );
  }

  if (parsed.schema_version !== SUPPORTED_TEMPLATE_LIST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Moose template JSON schema version: ${String(parsed.schema_version)}.`,
    );
  }

  if (!Array.isArray(parsed.templates)) {
    throw new Error(
      "Moose template JSON output did not include a templates array.",
    );
  }

  return parsed.templates;
}

export async function getAvailableTemplates(
  outputChannel: vscode.OutputChannel,
): Promise<TemplateInfo[]> {
  const result = await runProcess("moose", ["template", "list", "--json"], {
    onStderr: (chunk) => outputChannel.append(chunk),
    onStdout: (chunk) => outputChannel.append(chunk),
  });

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to fetch Moose templates.");
  }

  return parseTemplateListResponse(result.stdout);
}
