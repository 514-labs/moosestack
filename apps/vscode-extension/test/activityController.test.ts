import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

import { createActivityController } from "../src/activityController";

function createStatusBarItem(): vscode.StatusBarItem {
  return {
    hide(): void {
      return;
    },
    show(): void {
      return;
    },
    text: "",
    tooltip: "",
  } as unknown as vscode.StatusBarItem;
}

function createOutputChannel(): {
  lines: string[];
  outputChannel: vscode.OutputChannel;
  showCalls: boolean[];
} {
  const lines: string[] = [];
  const showCalls: boolean[] = [];

  return {
    lines,
    outputChannel: {
      append(): void {
        return;
      },
      appendLine(value: string): void {
        lines.push(value);
      },
      clear(): void {
        return;
      },
      dispose(): void {
        return;
      },
      hide(): void {
        return;
      },
      name: "Fiveonefour",
      replace(): void {
        return;
      },
      show(preserveFocus?: boolean): void {
        showCalls.push(Boolean(preserveFocus));
      },
    } as unknown as vscode.OutputChannel,
    showCalls,
  };
}

test("createActivityController keeps logs hidden until a failure occurs", () => {
  const statusBarItem = createStatusBarItem();
  const { lines, outputChannel, showCalls } = createOutputChannel();
  const controller = createActivityController(statusBarItem, outputChannel);

  const activity = controller.begin("Fiveonefour: Bootstrapping Workspace");

  assert.deepEqual(lines, ["Fiveonefour: Bootstrapping Workspace started."]);
  assert.deepEqual(showCalls, []);

  activity.fail("boom");

  assert.deepEqual(showCalls, [true]);
  assert.match(
    lines.at(-1) ?? "",
    /Fiveonefour: Bootstrapping Workspace failed: boom/,
  );

  controller.dispose();
});
