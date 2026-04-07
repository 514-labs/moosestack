import type * as vscode from "vscode";

import { EXTENSION_BRAND } from "./constants";

export interface ActivityReporter {
  step(message: string): void;
}

export interface ActivityHandle extends ActivityReporter {
  complete(): void;
  fail(message: string): void;
}

export interface ActivityController {
  begin(title: string): ActivityHandle;
  dispose(): void;
}

interface PendingActivity {
  id: number;
  message: string;
  title: string;
}

export function createActivityController(
  statusBarItem: vscode.StatusBarItem,
  outputChannel: vscode.OutputChannel,
): ActivityController {
  let nextId = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingActivities: PendingActivity[] = [];

  function clearResetTimer(): void {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = undefined;
    }
  }

  function showTransientStatus(text: string, tooltip: string): void {
    clearResetTimer();
    statusBarItem.text = text;
    statusBarItem.tooltip = tooltip;
    statusBarItem.show();
    resetTimer = setTimeout(() => {
      statusBarItem.hide();
      resetTimer = undefined;
    }, 4000);
  }

  function render(): void {
    clearResetTimer();
    const currentActivity = pendingActivities[pendingActivities.length - 1];
    if (!currentActivity) {
      statusBarItem.hide();
      return;
    }

    statusBarItem.text = `$(sync~spin) ${currentActivity.message}`;
    statusBarItem.tooltip = currentActivity.title;
    statusBarItem.show();
  }

  function removeActivity(id: number): PendingActivity | undefined {
    const index = pendingActivities.findIndex((activity) => activity.id === id);
    if (index === -1) {
      return undefined;
    }

    return pendingActivities.splice(index, 1)[0];
  }

  return {
    begin(title: string): ActivityHandle {
      const pendingActivity: PendingActivity = {
        id: nextId++,
        message: title,
        title,
      };
      pendingActivities.push(pendingActivity);
      outputChannel.appendLine(`${title} started.`);
      render();

      return {
        step(message: string): void {
          pendingActivity.message = message;
          outputChannel.appendLine(message);
          render();
        },
        complete(): void {
          const completedActivity = removeActivity(pendingActivity.id);
          if (!completedActivity) {
            return;
          }

          outputChannel.appendLine(`${completedActivity.title} completed.`);
          render();
          if (pendingActivities.length === 0) {
            showTransientStatus(
              `$(check) ${EXTENSION_BRAND} ready`,
              `${EXTENSION_BRAND} is idle.`,
            );
          }
        },
        fail(message: string): void {
          const failedActivity = removeActivity(pendingActivity.id);
          if (!failedActivity) {
            return;
          }

          outputChannel.show(true);
          outputChannel.appendLine(
            `${failedActivity.title} failed: ${message}`,
          );
          render();
          if (pendingActivities.length === 0) {
            showTransientStatus(`$(error) ${EXTENSION_BRAND} failed`, message);
          }
        },
      };
    },
    dispose(): void {
      clearResetTimer();
    },
  };
}
