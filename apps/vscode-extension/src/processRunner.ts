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
      env: options.env ?? process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

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

    child.on("error", reject);
    child.on("close", (code: number | null) =>
      resolve({ code, stderr, stdout }),
    );
  });
}

export async function commandExists(commandName: string): Promise<boolean> {
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
