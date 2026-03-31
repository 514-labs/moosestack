import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

import {
  buildInstallerCommand,
  getUnsupportedPlatformMessage,
  installLatestCli,
  UnsupportedPlatformError,
} from "../src/provisioning";
import type { CommandResult, RunOptions } from "../src/types";

function createOutputRecorder(): {
  lines: string[];
  outputChannel: vscode.OutputChannel;
} {
  const lines: string[] = [];

  return {
    lines,
    outputChannel: {
      append(value: string): void {
        lines.push(value);
      },
      appendLine(value: string): void {
        lines.push(value);
      },
    } as vscode.OutputChannel,
  };
}

function createCommandResult(
  overrides: Partial<CommandResult> = {},
): CommandResult {
  return {
    code: 0,
    signal: null,
    stderr: "",
    stdout: "",
    timedOut: false,
    ...overrides,
  };
}

test("buildInstallerCommand installs both cli tools", () => {
  assert.equal(
    buildInstallerCommand(),
    "bash <(curl -sSfL https://fiveonefour.com/install.sh) moose,514",
  );
});

test("installLatestCli runs the installer and records detected versions", async () => {
  const { lines, outputChannel } = createOutputRecorder();
  const shellCommands: string[] = [];

  const versions = await installLatestCli(outputChannel, {
    platform: () => "linux",
    async runProcess(): Promise<CommandResult> {
      throw new Error("runProcess should not be called");
    },
    async runShell(
      command: string,
      options?: RunOptions,
    ): Promise<CommandResult> {
      shellCommands.push(command);

      if (command === buildInstallerCommand()) {
        options?.onStdout?.("install ok");
        return createCommandResult();
      }

      if (command === "514 --version") {
        return createCommandResult({ stdout: "514 4.5.6\n" });
      }

      if (command === "moose --version") {
        return createCommandResult({ stdout: "moose 1.2.3\n" });
      }

      return createCommandResult();
    },
  });

  assert.deepEqual(shellCommands, [
    buildInstallerCommand(),
    "514 --version",
    "moose --version",
  ]);
  assert.deepEqual(versions, {
    cli514Version: "514 4.5.6",
    mooseVersion: "moose 1.2.3",
  });
  assert.match(lines.join("\n"), /Running the Fiveonefour installer/);
  assert.match(lines.join("\n"), /Detected Moose CLI: moose 1\.2\.3/);
});

test("installLatestCli refuses to run on native Windows", async () => {
  let shellCalled = false;

  await assert.rejects(
    installLatestCli(createOutputRecorder().outputChannel, {
      platform: () => "win32",
      async runProcess(): Promise<CommandResult> {
        throw new Error("runProcess should not be called");
      },
      async runShell(): Promise<CommandResult> {
        shellCalled = true;
        return createCommandResult();
      },
    }),
    UnsupportedPlatformError,
  );

  assert.equal(shellCalled, false);
  assert.match(getUnsupportedPlatformMessage("win32"), /WSL/);
});

test("installLatestCli surfaces installer failures", async () => {
  await assert.rejects(
    installLatestCli(createOutputRecorder().outputChannel, {
      platform: () => "darwin",
      async runProcess(): Promise<CommandResult> {
        throw new Error("runProcess should not be called");
      },
      async runShell(): Promise<CommandResult> {
        return createCommandResult({
          code: 1,
          stderr: "permission denied",
        });
      },
    }),
    /permission denied/,
  );
});
