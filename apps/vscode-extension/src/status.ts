import { HARNESS_INIT_COMMAND, WINDOWS_WSL_MESSAGE } from "./constants";
import type { InstallState, InstallVersions } from "./types";

interface InstallStateUpdateOptions {
  now?: string;
  platform?: NodeJS.Platform;
}

function resolveNow(now?: string): string {
  return now ?? new Date().toISOString();
}

function resolvePlatform(platform?: NodeJS.Platform): NodeJS.Platform {
  return platform ?? process.platform;
}

function formatTimestamp(value: string | null): string {
  return value ?? "never";
}

function describeLastResult(state: InstallState): string {
  switch (state.lastResult) {
    case "success":
      return "latest installer run succeeded";
    case "failure":
      return "latest installer run failed";
    case "unsupported-platform":
      return "native Windows is unsupported";
    default:
      return "installer has not run yet";
  }
}

function describePlatformSupport(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "Windows via WSL only";
  }

  return "macOS, Linux, and VS Code Remote - WSL";
}

export function createInitialInstallState(
  platform = process.platform,
): InstallState {
  return {
    cli514Version: null,
    lastAttemptAt: null,
    lastFailureAt: null,
    lastFailureMessage: null,
    lastResult: "never",
    lastSuccessAt: null,
    mooseVersion: null,
    platform,
  };
}

export function recordInstallAttempt(
  state: InstallState,
  options: InstallStateUpdateOptions = {},
): InstallState {
  return {
    ...state,
    lastAttemptAt: resolveNow(options.now),
    platform: resolvePlatform(options.platform),
  };
}

export function recordInstallSuccess(
  state: InstallState,
  versions: InstallVersions,
  options: InstallStateUpdateOptions = {},
): InstallState {
  const now = resolveNow(options.now);

  return {
    ...state,
    cli514Version: versions.cli514Version,
    lastAttemptAt: now,
    lastFailureAt: null,
    lastFailureMessage: null,
    lastResult: "success",
    lastSuccessAt: now,
    mooseVersion: versions.mooseVersion,
    platform: resolvePlatform(options.platform),
  };
}

export function recordInstallFailure(
  state: InstallState,
  message: string,
  options: InstallStateUpdateOptions = {},
): InstallState {
  const now = resolveNow(options.now);

  return {
    ...state,
    lastAttemptAt: now,
    lastFailureAt: now,
    lastFailureMessage: message,
    lastResult: "failure",
    platform: resolvePlatform(options.platform),
  };
}

export function recordUnsupportedPlatform(
  state: InstallState,
  message = WINDOWS_WSL_MESSAGE,
  options: InstallStateUpdateOptions = {},
): InstallState {
  const now = resolveNow(options.now);

  return {
    ...state,
    lastAttemptAt: now,
    lastFailureAt: now,
    lastFailureMessage: message,
    lastResult: "unsupported-platform",
    platform: resolvePlatform(options.platform),
  };
}

export function shouldShowHarnessSplash(
  state: InstallState,
  splashAlreadyShown: boolean,
): boolean {
  return !splashAlreadyShown && state.lastResult === "success";
}

export function buildInstallStateSummary(state: InstallState): string {
  const lines = [
    `Platform: ${state.platform}`,
    `Supported environments: ${describePlatformSupport(state.platform)}`,
    `Last result: ${describeLastResult(state)}`,
    `Last attempt: ${formatTimestamp(state.lastAttemptAt)}`,
    `Last success: ${formatTimestamp(state.lastSuccessAt)}`,
    `Last failure: ${formatTimestamp(state.lastFailureAt)}`,
    `Moose CLI: ${state.mooseVersion ?? "not detected"}`,
    `514 CLI: ${state.cli514Version ?? "not detected"}`,
    `Harness init command: ${HARNESS_INIT_COMMAND}`,
  ];

  if (state.lastFailureMessage) {
    lines.push(`Last message: ${state.lastFailureMessage}`);
  }

  return lines.join("\n");
}
