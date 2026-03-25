import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";

import { readSharedExtensions } from "./assets";
import { commandExists, runShell } from "./processRunner";

export interface CoreBinaryInstallResult {
  installed: boolean;
  missingCommands: string[];
}

export async function ensureSupportedPlatform(): Promise<void> {
  const platform = os.platform();
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      "MooseStack auto-provisioning currently supports macOS and Linux only.",
    );
  }
}

export async function ensureCoreBinaries(
  outputChannel: vscode.OutputChannel,
): Promise<CoreBinaryInstallResult> {
  await ensureSupportedPlatform();

  const hasMoose = await commandExists("moose");
  const has514 = await commandExists("514");

  if (hasMoose && has514) {
    return { installed: false, missingCommands: [] };
  }

  const missingCommands = [
    hasMoose ? null : "moose",
    has514 ? null : "514",
  ].filter((commandName): commandName is string => Boolean(commandName));

  outputChannel.appendLine(
    `Installing missing CLI tools: ${missingCommands.join(", ")}`,
  );

  const result = await runShell(
    "bash -i <(curl -fsSL https://fiveonefour.com/install.sh) 514,moose",
    {
      onStderr: (chunk) => outputChannel.append(chunk),
      onStdout: (chunk) => outputChannel.append(chunk),
    },
  );

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || "Failed to install MooseStack CLI tools.",
    );
  }

  return { installed: true, missingCommands };
}

export async function installRecommendedExtensions(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<string[]> {
  const sharedExtensions = readSharedExtensions(context);
  const recommendations = sharedExtensions.recommendations ?? [];
  const installed: string[] = [];

  for (const extensionId of recommendations) {
    if (vscode.extensions.getExtension(extensionId)) {
      continue;
    }

    try {
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        extensionId,
      );
      installed.push(extensionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `Failed to install recommended extension ${extensionId}: ${message}`,
      );
    }
  }

  return installed;
}

export async function runAgentInit(
  projectRoot: string,
  outputChannel: vscode.OutputChannel,
): Promise<true> {
  if (!(await commandExists("514"))) {
    throw new Error("The 514 CLI is not installed yet.");
  }

  const result = await runShell("514 agent init", {
    cwd: projectRoot,
    onStderr: (chunk) => outputChannel.append(chunk),
    onStdout: (chunk) => outputChannel.append(chunk),
  });

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `Failed to run 514 agent init in ${path.basename(projectRoot)}.`,
    );
  }

  return true;
}
