import { spawn } from "node:child_process";

import type { CommandResult, RunOptions } from "./types";

export function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    function clearTimers(): void {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = undefined;
      }
    }

    if (options.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 1000);
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk: { toString(): string } | string) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on("data", (chunk: { toString(): string } | string) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    }

    child.on("error", (error) => {
      clearTimers();
      reject(error);
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimers();
      resolve({ code, signal, stderr, stdout, timedOut });
    });
  });
}

export async function commandExists(commandName: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._-]+$/.test(commandName)) {
    return false;
  }

  if (process.platform === "win32") {
    return false;
  }

  const result = await runProcess("/bin/bash", [
    "-lc",
    `command -v ${commandName}`,
  ]);
  return result.code === 0;
}

export function runShell(
  command: string,
  options: RunOptions = {},
): Promise<CommandResult> {
  return runProcess("/bin/bash", ["-lc", command], options);
}
