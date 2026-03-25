import os from "node:os";
import type * as vscode from "vscode";

import {
  INSTALLER_SCRIPT_URL,
  INSTALLER_TARGETS,
  WINDOWS_WSL_MESSAGE,
} from "./constants";
import { runProcess, runShell } from "./processRunner";
import type { CommandResult, InstallVersions, RunOptions } from "./types";

export interface InstallDependencies {
  platform(): NodeJS.Platform;
  runProcess(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<CommandResult>;
  runShell(command: string, options?: RunOptions): Promise<CommandResult>;
}

export class UnsupportedPlatformError extends Error {
  constructor(message = WINDOWS_WSL_MESSAGE) {
    super(message);
    this.name = "UnsupportedPlatformError";
  }
}

function normalizeVersion(stdout: string): string | null {
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

async function readVersion(
  command: string,
  dependencies: InstallDependencies,
): Promise<string | null> {
  try {
    const result = await dependencies.runProcess(command, ["--version"]);

    if (result.code !== 0) {
      return null;
    }

    return normalizeVersion(result.stdout);
  } catch {
    return null;
  }
}

export function isInstallerSupportedPlatform(
  platform = os.platform(),
): boolean {
  return platform === "darwin" || platform === "linux";
}

export function getUnsupportedPlatformMessage(
  platform = os.platform(),
): string {
  if (platform === "win32") {
    return WINDOWS_WSL_MESSAGE;
  }

  return "Fiveonefour currently installs the Moose and 514 CLIs on macOS and Linux only.";
}

export function buildInstallerCommand(): string {
  return `bash <(curl -sSfL ${INSTALLER_SCRIPT_URL}) ${INSTALLER_TARGETS.join(",")}`;
}

export async function detectInstalledVersions(
  dependencies: Partial<InstallDependencies> = {},
): Promise<InstallVersions> {
  const resolvedDependencies: InstallDependencies = {
    platform: () => os.platform(),
    runProcess,
    runShell,
    ...dependencies,
  };

  return {
    cli514Version: await readVersion("514", resolvedDependencies),
    mooseVersion: await readVersion("moose", resolvedDependencies),
  };
}

export async function installLatestCli(
  outputChannel: vscode.OutputChannel,
  dependencies: Partial<InstallDependencies> = {},
): Promise<InstallVersions> {
  const resolvedDependencies: InstallDependencies = {
    platform: () => os.platform(),
    runProcess,
    runShell,
    ...dependencies,
  };
  const platform = resolvedDependencies.platform();

  if (!isInstallerSupportedPlatform(platform)) {
    throw new UnsupportedPlatformError(getUnsupportedPlatformMessage(platform));
  }

  outputChannel.appendLine(
    "Running the Fiveonefour installer for the Moose and 514 CLIs.",
  );

  const result = await resolvedDependencies.runShell(buildInstallerCommand(), {
    onStderr: (chunk) => outputChannel.append(chunk),
    onStdout: (chunk) => outputChannel.append(chunk),
  });

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Failed to install the Moose and 514 CLIs.",
    );
  }

  outputChannel.appendLine("Installer completed. Detecting CLI versions...");
  const versions = await detectInstalledVersions(resolvedDependencies);
  outputChannel.appendLine(
    `Detected Moose CLI: ${versions.mooseVersion ?? "not detected"}`,
  );
  outputChannel.appendLine(
    `Detected 514 CLI: ${versions.cli514Version ?? "not detected"}`,
  );

  return versions;
}
