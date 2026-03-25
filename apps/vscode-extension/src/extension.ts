import * as vscode from "vscode";

import { createActivityController } from "./activityController";
import {
  COMMANDS,
  EXTENSION_BRAND,
  INSTALL_STATE_KEY,
  OUTPUT_CHANNEL_NAME,
} from "./constants";
import { showHarnessSplashPanel } from "./getStartedPanel";
import {
  getUnsupportedPlatformMessage,
  installLatestCli,
  isInstallerSupportedPlatform,
} from "./provisioning";
import {
  buildInstallStateSummary,
  createInitialInstallState,
  recordInstallAttempt,
  recordInstallFailure,
  recordInstallSuccess,
  recordUnsupportedPlatform,
  shouldShowHarnessSplash,
} from "./status";
import type { InstallState } from "./types";

interface SessionState {
  splashShown: boolean;
  windowsWarningShown: boolean;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getStoredInstallState(context: vscode.ExtensionContext): InstallState {
  return (
    context.globalState.get<InstallState>(INSTALL_STATE_KEY) ??
    createInitialInstallState()
  );
}

async function storeInstallState(
  context: vscode.ExtensionContext,
  state: InstallState,
): Promise<void> {
  await context.globalState.update(INSTALL_STATE_KEY, state);
}

async function showInstallState(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const state = getStoredInstallState(context);

  outputChannel.appendLine("");
  outputChannel.appendLine(`${EXTENSION_BRAND} install state`);
  outputChannel.appendLine(buildInstallStateSummary(state));
  outputChannel.show(true);

  const openGuideLabel = "Open Harness Guide";

  if (state.lastResult === "failure") {
    const selection = await vscode.window.showErrorMessage(
      `${EXTENSION_BRAND} install state is available in the output panel.`,
      openGuideLabel,
    );
    if (selection === openGuideLabel) {
      showHarnessSplashPanel(context, outputChannel);
    }
    return;
  }

  if (state.lastResult === "unsupported-platform") {
    const selection = await vscode.window.showWarningMessage(
      `${EXTENSION_BRAND} install state is available in the output panel.`,
      openGuideLabel,
    );
    if (selection === openGuideLabel) {
      showHarnessSplashPanel(context, outputChannel);
    }
    return;
  }

  const selection = await vscode.window.showInformationMessage(
    `${EXTENSION_BRAND} install state is available in the output panel.`,
    openGuideLabel,
  );
  if (selection === openGuideLabel) {
    showHarnessSplashPanel(context, outputChannel);
  }
}

async function runInstallerOnActivation(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  activityController: ReturnType<typeof createActivityController>,
  session: SessionState,
): Promise<void> {
  const previousState = getStoredInstallState(context);
  const platform = process.platform;
  const now = new Date().toISOString();
  const attemptedState = recordInstallAttempt(previousState, { now, platform });
  await storeInstallState(context, attemptedState);

  if (!isInstallerSupportedPlatform(platform)) {
    const unsupportedState = recordUnsupportedPlatform(
      attemptedState,
      getUnsupportedPlatformMessage(platform),
      { now, platform },
    );
    await storeInstallState(context, unsupportedState);

    if (!session.windowsWarningShown) {
      session.windowsWarningShown = true;
      const selection = await vscode.window.showWarningMessage(
        getUnsupportedPlatformMessage(platform),
        "Open Harness Guide",
      );
      if (selection === "Open Harness Guide") {
        showHarnessSplashPanel(context, outputChannel);
      }
    }
    return;
  }

  const activity = activityController.begin(
    "Fiveonefour: Installing Moose and 514 CLIs",
  );

  try {
    activity.step("Running the latest Fiveonefour installer");
    const versions = await installLatestCli(outputChannel);
    const successState = recordInstallSuccess(attemptedState, versions, {
      platform,
    });
    await storeInstallState(context, successState);
    activity.complete();

    if (shouldShowHarnessSplash(successState, session.splashShown)) {
      session.splashShown = true;
      showHarnessSplashPanel(context, outputChannel);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    const failureState = recordInstallFailure(attemptedState, message, {
      platform,
    });
    await storeInstallState(context, failureState);
    activity.fail(message);

    const selection = await vscode.window.showErrorMessage(
      `${EXTENSION_BRAND} could not update the Moose and 514 CLIs: ${message}`,
      "Open Harness Guide",
    );
    if (selection === "Open Harness Guide") {
      showHarnessSplashPanel(context, outputChannel);
    }
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  );
  const activityController = createActivityController(
    statusBarItem,
    outputChannel,
  );
  const session: SessionState = {
    splashShown: false,
    windowsWarningShown: false,
  };

  statusBarItem.name = EXTENSION_BRAND;
  statusBarItem.command = COMMANDS.checkInstallState;

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    vscode.commands.registerCommand(COMMANDS.checkInstallState, async () => {
      await showInstallState(context, outputChannel);
    }),
    {
      dispose(): void {
        activityController.dispose();
      },
    },
  );

  void runInstallerOnActivation(
    context,
    outputChannel,
    activityController,
    session,
  );
}
