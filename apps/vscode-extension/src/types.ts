export type InstallResultStatus =
  | "failure"
  | "never"
  | "success"
  | "unsupported-platform";

export interface InstallState {
  cli514Version: string | null;
  lastAttemptAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  lastResult: InstallResultStatus;
  lastSuccessAt: string | null;
  mooseVersion: string | null;
  platform: NodeJS.Platform;
}

export interface InstallVersions {
  cli514Version: string | null;
  mooseVersion: string | null;
}

export interface CommandResult {
  code: number | null;
  stderr: string;
  signal: NodeJS.Signals | null;
  stdout: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
  stdin?: string;
  timeoutMs?: number;
}
