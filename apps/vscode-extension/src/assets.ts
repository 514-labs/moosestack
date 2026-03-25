import fs from "node:fs";
import path from "node:path";
import type * as vscode from "vscode";

import { ASSET_FILE_NAMES } from "./constants";
import type { ExtensionsFile, McpConfig, SettingsFile } from "./types";

function readBundledAsset<T>(
  context: vscode.ExtensionContext,
  assetFileName: string,
): T {
  const assetPath = path.join(
    context.extensionPath,
    "dist",
    "assets",
    assetFileName,
  );
  try {
    return JSON.parse(fs.readFileSync(assetPath, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `readBundledAsset failed for "${assetFileName}" at ${assetPath}: ${message}`,
    );
  }
}

export function readSharedSettings(
  context: vscode.ExtensionContext,
): SettingsFile {
  return readBundledAsset<SettingsFile>(context, ASSET_FILE_NAMES.settings);
}

export function readSharedExtensions(
  context: vscode.ExtensionContext,
): ExtensionsFile {
  return readBundledAsset<ExtensionsFile>(context, ASSET_FILE_NAMES.extensions);
}

export function readSharedMcp(context: vscode.ExtensionContext): McpConfig {
  return readBundledAsset<McpConfig>(context, ASSET_FILE_NAMES.mcp);
}
