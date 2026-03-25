import path from "node:path";
import type * as vscode from "vscode";

import {
  readSharedExtensions,
  readSharedMcp,
  readSharedSettings,
} from "./assets";
import {
  ensureJsonFile,
  mergeExtensions,
  mergeSettings,
  readJson,
} from "./configuration";
import type { ExtensionsFile, McpConfig, SettingsFile } from "./types";

export interface WorkspaceConfigResult {
  extensionsChanged: boolean;
  mcpChanged: boolean;
  settingsChanged: boolean;
}

export async function configureWorkspace(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel,
): Promise<WorkspaceConfigResult> {
  const sharedSettings = readSharedSettings(context);
  const sharedExtensions = readSharedExtensions(context);
  const sharedMcp = readSharedMcp(context);

  const vscodeDir = path.join(workspaceRoot, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");
  const extensionsPath = path.join(vscodeDir, "extensions.json");
  const mcpPath = path.join(vscodeDir, "mcp.json");

  const settingsChanged = ensureJsonFile(
    settingsPath,
    mergeSettings(readJson<SettingsFile>(settingsPath) ?? {}, sharedSettings),
  );
  const extensionsChanged = ensureJsonFile(
    extensionsPath,
    mergeExtensions(
      readJson<ExtensionsFile>(extensionsPath) ?? {},
      sharedExtensions,
    ),
  );
  const mcpChanged = ensureJsonFile(mcpPath, sharedMcp as McpConfig);

  outputChannel.appendLine(
    `Workspace config sync complete for ${workspaceRoot} ` +
      `(settings=${settingsChanged}, extensions=${extensionsChanged}, mcp=${mcpChanged})`,
  );

  return {
    extensionsChanged,
    mcpChanged,
    settingsChanged,
  };
}
