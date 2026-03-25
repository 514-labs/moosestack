import os from "node:os";
import path from "node:path";
import type * as vscode from "vscode";

import {
  AgentInitCompatibilityError,
  buildAgentInitRequest,
  inferAgentId,
  parseAgentInitResponse,
  parseAgentInitSchema,
} from "./agentInit";
import { readSharedExtensions } from "./assets";
import { commandExists, runProcess, runShell } from "./processRunner";
import type { CommandResult, RunOptions } from "./types";

export interface CoreBinaryInstallResult {
  installed: boolean;
  missingCommands: string[];
}

export interface CoreBinaryInstallDependencies {
  commandExists(commandName: string): Promise<boolean>;
  runShell(command: string, options?: RunOptions): Promise<CommandResult>;
  showWarningMessage(
    message: string,
    options: {
      modal: boolean;
    },
    ...items: string[]
  ): PromiseLike<string | undefined>;
}

export interface AgentInitExecutionResult {
  agentId: string;
  message?: string;
  schemaVersion: number;
}

export interface AgentInitHostInfo {
  appName: string;
  uriScheme?: string;
}

export interface AgentInitDependencies {
  commandExists(commandName: string): Promise<boolean>;
  runProcess(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<CommandResult>;
}

const DEFAULT_AGENT_INIT_TIMEOUT_MS = 60_000;

function getVscodeApi(): typeof import("vscode") {
  return require("vscode") as typeof import("vscode");
}

function formatTimeoutSeconds(timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export async function ensureSupportedPlatform(): Promise<void> {
  const platform = os.platform();
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      "Fiveonefour auto-provisioning currently supports macOS and Linux only.",
    );
  }
}

export async function ensureCoreBinaries(
  outputChannel: vscode.OutputChannel,
  dependencies: Partial<CoreBinaryInstallDependencies> = {},
): Promise<CoreBinaryInstallResult> {
  await ensureSupportedPlatform();

  const resolvedDependencies: CoreBinaryInstallDependencies = {
    commandExists,
    runShell,
    showWarningMessage: (message, options, ...items) =>
      getVscodeApi().window.showWarningMessage(message, options, ...items),
    ...dependencies,
  };

  const hasMoose = await resolvedDependencies.commandExists("moose");
  const has514 = await resolvedDependencies.commandExists("514");

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
  const confirmation = await resolvedDependencies.showWarningMessage(
    `Install missing CLI tools: ${missingCommands.join(", ")}?`,
    { modal: true },
    "Install",
  );
  if (confirmation !== "Install") {
    outputChannel.appendLine("CLI installation canceled by the user.");
    throw new Error("Fiveonefour CLI installation canceled.");
  }

  const result = await resolvedDependencies.runShell(
    `bash -i <(curl -fsSL https://fiveonefour.com/install.sh) ${missingCommands.join(",")}`,
    {
      onStderr: (chunk) => outputChannel.append(chunk),
      onStdout: (chunk) => outputChannel.append(chunk),
    },
  );

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || "Failed to install Fiveonefour CLI tools.",
    );
  }

  return { installed: true, missingCommands };
}

export async function installRecommendedExtensions(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<string[]> {
  const vscodeApi = getVscodeApi();
  let recommendations: string[] = [];
  try {
    recommendations = readSharedExtensions(context).recommendations ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(
      `Could not load shared extension recommendations: ${message}`,
    );
  }
  const installed: string[] = [];

  for (const extensionId of recommendations) {
    if (vscodeApi.extensions.getExtension(extensionId)) {
      continue;
    }

    try {
      await vscodeApi.commands.executeCommand(
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
  options: {
    dependencies?: AgentInitDependencies;
    host?: AgentInitHostInfo;
    timeoutMs?: number;
  } = {},
): Promise<AgentInitExecutionResult> {
  const dependencies = options.dependencies ?? {
    commandExists,
    runProcess,
  };
  const host =
    options.host ??
    (() => {
      const vscodeApi = getVscodeApi();
      return {
        appName: vscodeApi.env.appName,
        uriScheme: vscodeApi.env.uriScheme,
      };
    })();
  const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_INIT_TIMEOUT_MS;

  await ensureSupportedPlatform();

  if (!(await dependencies.commandExists("514"))) {
    throw new Error("The 514 CLI is not installed yet.");
  }

  const agentId = inferAgentId(host.appName, host.uriScheme);
  if (!agentId) {
    throw new AgentInitCompatibilityError(
      `The current editor host (${host.appName}) is not mapped to a supported \`514 agent init\` agent id.`,
    );
  }

  outputChannel.appendLine("Fetching the 514 agent init JSON schema...");
  const schemaResult = await dependencies.runProcess(
    "514",
    ["agent", "init", "schema", "--json"],
    {
      cwd: projectRoot,
      onStderr: (chunk) => outputChannel.append(chunk),
    },
  );

  if (schemaResult.code !== 0) {
    throw new AgentInitCompatibilityError(
      schemaResult.stderr.trim() ||
        "Failed to fetch `514 agent init schema --json`.",
    );
  }

  const schema = parseAgentInitSchema(schemaResult.stdout);
  const request = buildAgentInitRequest(schema, agentId);
  outputChannel.appendLine(
    `Running 514 agent init for ${agentId} using request schema v${schema.requestVersion}...`,
  );

  const result = await dependencies.runProcess(
    "514",
    ["agent", "init", "--json"],
    {
      cwd: projectRoot,
      onStderr: (chunk) => outputChannel.append(chunk),
      stdin: `${JSON.stringify(request)}\n`,
      timeoutMs,
    },
  );

  if (result.timedOut) {
    throw new Error(
      `514 agent init timed out after ${formatTimeoutSeconds(timeoutMs)}.`,
    );
  }

  const response = parseAgentInitResponse(result.stdout);
  if (result.code !== 0) {
    throw new Error(
      response?.message ||
        result.stderr.trim() ||
        `Failed to run 514 agent init in ${path.basename(projectRoot)}.`,
    );
  }

  if (response?.status === "error") {
    throw new Error(
      response.message ||
        `Failed to run 514 agent init in ${path.basename(projectRoot)}.`,
    );
  }

  if (response?.message) {
    outputChannel.appendLine(response.message);
  }

  return {
    agentId,
    message: response?.message,
    schemaVersion: schema.schemaVersion,
  };
}
