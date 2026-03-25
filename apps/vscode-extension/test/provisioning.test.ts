import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

import { AgentInitCompatibilityError } from "../src/agentInit";
import {
  ensureCoreBinaries,
  runAgentInit,
  type CoreBinaryInstallDependencies,
  type AgentInitDependencies,
  type AgentInitHostInfo,
} from "../src/provisioning";
import type { CommandResult, RunOptions } from "../src/types";

const schemaJson = JSON.stringify({
  fields: {
    agents: {
      items: {
        enum: ["vscode", "cursor", "kiro"],
        type: "string",
      },
      type: "array<string>",
    },
    version: {
      enum: [2, 1],
      type: "integer",
    },
  },
  input_format: "json",
  version: 1,
});

interface RecordedCall {
  args: readonly string[];
  command: string;
  options?: RunOptions;
}

function createOutputChannel(): vscode.OutputChannel {
  const lines: string[] = [];

  return {
    append(value: string): void {
      lines.push(value);
    },
    appendLine(value: string): void {
      lines.push(value);
    },
  } as vscode.OutputChannel;
}

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

test("runAgentInit sends versioned JSON input for the current editor", async () => {
  const calls: RecordedCall[] = [];
  const dependencies: AgentInitDependencies = {
    async commandExists(): Promise<boolean> {
      return true;
    },
    async runProcess(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<CommandResult> {
      calls.push({ args, command, options });

      if (args[2] === "schema") {
        return createCommandResult({ stdout: schemaJson });
      }

      return createCommandResult({
        stdout: JSON.stringify({
          message: "Configured VS Code successfully.",
          status: "ok",
        }),
      });
    },
  };

  const result = await runAgentInit("/repo/project", createOutputChannel(), {
    dependencies,
    host: {
      appName: "Visual Studio Code",
      uriScheme: "vscode",
    },
  });

  assert.equal(result.agentId, "vscode");
  assert.equal(result.schemaVersion, 1);
  assert.equal(calls[0]?.command, "514");
  assert.deepEqual(calls[0]?.args, ["agent", "init", "schema", "--json"]);
  assert.equal(calls[0]?.options?.cwd, "/repo/project");
  assert.equal(calls[1]?.command, "514");
  assert.deepEqual(calls[1]?.args, ["agent", "init", "--json"]);
  assert.equal(calls[1]?.options?.cwd, "/repo/project");
  assert.deepEqual(JSON.parse(calls[1]?.options?.stdin ?? "{}"), {
    agents: ["vscode"],
    version: 1,
    yes: true,
  });
});

test("ensureCoreBinaries installs only the missing commands", async () => {
  const { lines, outputChannel } = createOutputRecorder();
  const shellCommands: string[] = [];
  const dependencies: CoreBinaryInstallDependencies = {
    async commandExists(commandName: string): Promise<boolean> {
      return commandName === "moose";
    },
    async runShell(
      command: string,
      options?: RunOptions,
    ): Promise<CommandResult> {
      shellCommands.push(command);
      options?.onStdout?.("installed");
      return createCommandResult();
    },
    async showWarningMessage(): Promise<string | undefined> {
      return "Install";
    },
  };

  const result = await ensureCoreBinaries(outputChannel, dependencies);

  assert.deepEqual(result, {
    installed: true,
    missingCommands: ["514"],
  });
  assert.deepEqual(shellCommands, [
    "bash -i <(curl -fsSL https://fiveonefour.com/install.sh) 514",
  ]);
  assert.match(lines.join("\n"), /Installing missing CLI tools: 514/);
});

test("runAgentInit surfaces structured JSON errors", async () => {
  const dependencies: AgentInitDependencies = {
    async commandExists(): Promise<boolean> {
      return true;
    },
    async runProcess(
      _command: string,
      args: readonly string[],
    ): Promise<CommandResult> {
      if (args[2] === "schema") {
        return createCommandResult({ stdout: schemaJson });
      }

      return createCommandResult({
        code: 1,
        stdout: JSON.stringify({
          message: "514 agent init requires explicit confirmation.",
          status: "error",
        }),
      });
    },
  };

  await assert.rejects(
    runAgentInit("/repo/project", createOutputChannel(), {
      dependencies,
      host: {
        appName: "Visual Studio Code",
        uriScheme: "vscode",
      },
    }),
    /explicit confirmation/,
  );
});

test("runAgentInit rejects editors unsupported by the advertised schema", async () => {
  const dependencies: AgentInitDependencies = {
    async commandExists(): Promise<boolean> {
      return true;
    },
    async runProcess(
      _command: string,
      _args: readonly string[],
    ): Promise<CommandResult> {
      return createCommandResult({
        stdout: JSON.stringify({
          fields: {
            agents: {
              items: {
                enum: ["vscode"],
                type: "string",
              },
              type: "array<string>",
            },
            version: {
              enum: [1],
              type: "integer",
            },
          },
          input_format: "json",
          version: 1,
        }),
      });
    },
  };

  await assert.rejects(
    runAgentInit("/repo/project", createOutputChannel(), {
      dependencies,
      host: {
        appName: "Cursor",
        uriScheme: "cursor",
      },
    }),
    AgentInitCompatibilityError,
  );
});

test("runAgentInit reports timeouts clearly", async () => {
  const dependencies: AgentInitDependencies = {
    async commandExists(): Promise<boolean> {
      return true;
    },
    async runProcess(
      _command: string,
      args: readonly string[],
      _options?: RunOptions,
    ): Promise<CommandResult> {
      if (args[2] === "schema") {
        return createCommandResult({ stdout: schemaJson });
      }

      return createCommandResult({
        code: null,
        signal: "SIGTERM",
        timedOut: true,
      });
    },
  };

  const host: AgentInitHostInfo = {
    appName: "Visual Studio Code",
    uriScheme: "vscode",
  };

  await assert.rejects(
    runAgentInit("/repo/project", createOutputChannel(), {
      dependencies,
      host,
      timeoutMs: 1_000,
    }),
    /timed out after 1 second/,
  );
});
