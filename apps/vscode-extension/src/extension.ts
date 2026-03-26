import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { COMMANDS } from "./constants";
import {
  findMooseProjects,
  getNoProjectsStateKey,
  getWorkspaceStateKey,
  hasWorkspaceMarker,
  resolveActiveProject,
  shouldSkipAutomaticBootstrap,
} from "./discovery";
import { runProcess } from "./processRunner";
import {
  ensureCoreBinaries,
  installRecommendedExtensions,
  runAgentInit,
} from "./provisioning";
import { buildSetupSummary } from "./status";
import { getAvailableTemplates } from "./templates";
import type { DiscoveredProject, ExtensionState, TemplateInfo } from "./types";
import { configureWorkspace } from "./workspaceConfig";

interface ProjectQuickPickItem extends vscode.QuickPickItem {
  projectRoot: string;
  workspaceRoot: string;
}

interface TemplateQuickPickItem extends vscode.QuickPickItem {
  template: TemplateInfo;
}

interface ActivityReporter {
  step(message: string): void;
}

interface ActivityHandle extends ActivityReporter {
  complete(): void;
  fail(message: string): void;
}

interface ActivityController {
  begin(title: string): ActivityHandle;
  dispose(): void;
}

interface PendingActivity {
  id: number;
  message: string;
  title: string;
}

function createExtensionState(): ExtensionState {
  return {
    activeProject: null,
    cliInstallRan: false,
    discoveredProjects: [],
    installedExtensions: [],
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createActivityController(
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
      outputChannel.show(true);
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
              "$(check) MooseStack ready",
              "MooseStack is idle.",
            );
          }
        },
        fail(message: string): void {
          const failedActivity = removeActivity(pendingActivity.id);
          if (!failedActivity) {
            return;
          }

          outputChannel.appendLine(
            `${failedActivity.title} failed: ${message}`,
          );
          render();
          if (pendingActivities.length === 0) {
            showTransientStatus("$(error) MooseStack failed", message);
          }
        },
      };
    },
    dispose(): void {
      clearResetTimer();
    },
  };
}

async function withActivity<T>(
  title: string,
  outputChannel: vscode.OutputChannel,
  activityController: ActivityController,
  run: (reporter: ActivityReporter) => Promise<T>,
): Promise<T> {
  const activity = activityController.begin(title);

  try {
    const result = await run(activity);
    activity.complete();
    return result;
  } catch (error) {
    activity.fail(getErrorMessage(error));
    throw error;
  }
}

async function runCommand(
  title: string,
  outputChannel: vscode.OutputChannel,
  activityController: ActivityController,
  run: () => Promise<void>,
): Promise<void> {
  const activity = activityController.begin(title);

  try {
    await run();
    activity.complete();
  } catch (error) {
    const message = getErrorMessage(error);
    activity.fail(message);
    await vscode.window.showErrorMessage(`${title} failed: ${message}`);
  }
}

async function refreshDiscoveredProjects(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<DiscoveredProject[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const discovered: DiscoveredProject[] = [];

  for (const workspaceFolder of workspaceFolders) {
    const projectRoots = findMooseProjects(workspaceFolder.uri.fsPath);
    const storedProject = context.workspaceState.get<string>(
      getWorkspaceStateKey(workspaceFolder.uri.fsPath),
    );
    const activeProject = resolveActiveProject(projectRoots, storedProject);
    const noProjectsStateKey = getNoProjectsStateKey(
      workspaceFolder.uri.fsPath,
    );

    await context.workspaceState.update(
      noProjectsStateKey,
      projectRoots.length === 0,
    );

    if (activeProject) {
      await context.workspaceState.update(
        getWorkspaceStateKey(workspaceFolder.uri.fsPath),
        activeProject,
      );
    } else {
      await context.workspaceState.update(
        getWorkspaceStateKey(workspaceFolder.uri.fsPath),
        undefined,
      );
    }

    for (const projectRoot of projectRoots) {
      discovered.push({
        label:
          path.relative(workspaceFolder.uri.fsPath, projectRoot) ||
          path.basename(projectRoot),
        projectRoot,
        workspaceRoot: workspaceFolder.uri.fsPath,
      });
    }
  }

  outputChannel.appendLine(`Discovered ${discovered.length} Moose project(s).`);
  return discovered.sort((left, right) =>
    left.projectRoot.localeCompare(right.projectRoot),
  );
}

function getStoredActiveProject(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): string | null {
  return (
    context.workspaceState.get<string>(getWorkspaceStateKey(workspaceRoot)) ??
    null
  );
}

async function setActiveProject(
  context: vscode.ExtensionContext,
  projectRoot: string,
  workspaceRoot: string,
): Promise<void> {
  await context.workspaceState.update(
    getWorkspaceStateKey(workspaceRoot),
    projectRoot,
  );
}

function getActiveProjectForWorkspace(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  discoveredProjects: readonly DiscoveredProject[],
): string | null {
  return resolveActiveProject(
    discoveredProjects
      .filter((project) => project.workspaceRoot === workspaceRoot)
      .map((project) => project.projectRoot),
    getStoredActiveProject(context, workspaceRoot),
  );
}

async function selectActiveProject(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  outputChannel: vscode.OutputChannel,
): Promise<string | null> {
  if (state.discoveredProjects.length === 0) {
    await vscode.window.showInformationMessage(
      "No Moose projects were found in the current workspace.",
    );
    return null;
  }

  const pick = await vscode.window.showQuickPick<ProjectQuickPickItem>(
    state.discoveredProjects.map((project) => ({
      description: project.workspaceRoot,
      detail: project.projectRoot,
      label: project.label,
      projectRoot: project.projectRoot,
      workspaceRoot: project.workspaceRoot,
    })),
    {
      placeHolder:
        "Select the active Moose project for project-scoped commands",
    },
  );

  if (!pick) {
    return null;
  }

  await setActiveProject(context, pick.projectRoot, pick.workspaceRoot);
  state.activeProject = pick.projectRoot;
  outputChannel.appendLine(`Active Moose project set to ${pick.projectRoot}`);
  await vscode.window.showInformationMessage(
    `Active Moose project: ${pick.projectRoot}`,
  );
  return pick.projectRoot;
}

function getActiveProject(
  context: vscode.ExtensionContext,
  state: ExtensionState,
): string | null {
  if (state.activeProject) {
    return state.activeProject;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  for (const workspaceFolder of workspaceFolders) {
    const activeProject = getActiveProjectForWorkspace(
      context,
      workspaceFolder.uri.fsPath,
      state.discoveredProjects,
    );
    if (activeProject) {
      state.activeProject = activeProject;
      return activeProject;
    }
  }

  return null;
}

function getContainingWorkspaceFolder(
  projectRoot: string,
): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectRoot));
}

async function configureCurrentWorkspace(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  outputChannel: vscode.OutputChannel,
  rerunAgentInit = false,
  activity?: ActivityReporter,
): Promise<string | null> {
  const activeProject = getActiveProject(context, state);
  if (!activeProject) {
    await vscode.window.showInformationMessage(
      "Open or create a Moose project first.",
    );
    return null;
  }

  const workspaceFolder = getContainingWorkspaceFolder(activeProject);
  if (!workspaceFolder) {
    throw new Error(`Could not find a workspace folder for ${activeProject}`);
  }

  activity?.step(
    "Syncing workspace settings, extension recommendations, and MCP config...",
  );
  await configureWorkspace(context, workspaceFolder.uri.fsPath, outputChannel);

  const agentInitStateKey = `moosestack.agentInit:${activeProject}`;
  const alreadyInitialized =
    context.workspaceState.get<boolean>(agentInitStateKey) === true;
  if (rerunAgentInit || !alreadyInitialized) {
    activity?.step(
      `Running 514 agent init in ${path.relative(workspaceFolder.uri.fsPath, activeProject) || path.basename(activeProject)}...`,
    );
    await runAgentInit(activeProject, outputChannel);
    await context.workspaceState.update(agentInitStateKey, true);
  } else {
    activity?.step("Dev harness already initialized. Skipping 514 agent init.");
  }

  await vscode.window.showInformationMessage(
    `Moose workspace configured for ${
      path.relative(workspaceFolder.uri.fsPath, activeProject) || activeProject
    }.`,
  );

  return workspaceFolder.uri.fsPath;
}

async function createNewProject(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  outputChannel: vscode.OutputChannel,
  activityController: ActivityController,
): Promise<void> {
  const templates = await withActivity(
    "Moose: Preparing Project Creation",
    outputChannel,
    activityController,
    async (activity) => {
      activity.step("Checking Moose and 514 CLI availability...");
      await ensureCoreBinaries(outputChannel);
      activity.step("Loading available Moose templates...");
      return getAvailableTemplates(outputChannel);
    },
  );
  const templatePick = await vscode.window.showQuickPick<TemplateQuickPickItem>(
    templates.map((template) => ({
      description: template.language,
      detail: template.description,
      label: template.name,
      template,
    })),
    {
      placeHolder: "Choose a Moose template",
    },
  );

  if (!templatePick) {
    return;
  }

  const projectName = await vscode.window.showInputBox({
    placeHolder: "analytics-service",
    prompt: "Enter a name for the new Moose project",
    validateInput(value) {
      return value.trim() ? null : "Project name is required.";
    },
  });

  if (!projectName) {
    return;
  }

  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  let parentDir = workspaceRoot;

  if (workspaceRoot) {
    const relativeParentDir = await vscode.window.showInputBox({
      placeHolder: "moose",
      prompt:
        "Enter the parent directory relative to the current workspace root. Leave empty for the workspace root.",
      value: "",
      validateInput(value) {
        const resolvedParent = path.resolve(workspaceRoot, value || ".");
        return resolvedParent.startsWith(path.resolve(workspaceRoot)) ? null : (
            "Parent directory must stay inside the current workspace root."
          );
      },
    });

    if (relativeParentDir === undefined) {
      return;
    }

    parentDir = path.resolve(workspaceRoot, relativeParentDir || ".");
    fs.mkdirSync(parentDir, { recursive: true });
  } else {
    const pickedFolder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select parent folder for the new Moose project",
    });

    if (!pickedFolder?.[0]) {
      return;
    }

    parentDir = pickedFolder[0].fsPath;
  }

  await withActivity(
    "Moose: Creating Project",
    outputChannel,
    activityController,
    async (activity) => {
      activity.step(
        `Running moose init for ${projectName} (${templatePick.template.name})...`,
      );
      const result = await runProcess(
        "moose",
        ["init", projectName, templatePick.template.name],
        {
          cwd: parentDir ?? undefined,
          onStderr: (chunk) => outputChannel.append(chunk),
          onStdout: (chunk) => outputChannel.append(chunk),
        },
      );

      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "moose init failed.");
      }

      const projectRoot = path.join(parentDir ?? "", projectName);
      const containingWorkspace = workspaceRoot ?? path.dirname(projectRoot);

      activity.step("Refreshing discovered Moose projects...");
      await setActiveProject(context, projectRoot, containingWorkspace);
      state.activeProject = projectRoot;
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );

      if (
        workspaceRoot &&
        projectRoot.startsWith(path.resolve(workspaceRoot))
      ) {
        if (hasWorkspaceMarker(workspaceRoot)) {
          await vscode.window.showInformationMessage(
            "Moose project created in a workspace repo. If needed, add the new folder to pnpm workspaces and use workspace:* dependencies from consumer packages.",
          );
        }

        activity.step("Configuring the new Moose workspace...");
        await configureCurrentWorkspace(
          context,
          state,
          outputChannel,
          true,
          activity,
        );
        return;
      }

      activity.step("Opening the new Moose project in VS Code...");
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(projectRoot),
        false,
      );
    },
  );
}

async function bootstrap(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  outputChannel: vscode.OutputChannel,
  activity?: ActivityReporter,
  respectNoProjectsSkip = true,
): Promise<void> {
  try {
    const workspaceFolderPaths = (vscode.workspace.workspaceFolders ?? []).map(
      (workspaceFolder) => workspaceFolder.uri.fsPath,
    );

    if (
      respectNoProjectsSkip &&
      shouldSkipAutomaticBootstrap(
        workspaceFolderPaths,
        (workspaceFolderPath) =>
          context.workspaceState.get<boolean>(
            getNoProjectsStateKey(workspaceFolderPath),
          ) === true,
      )
    ) {
      state.activeProject = null;
      state.discoveredProjects = [];
      activity?.step(
        "No Moose projects were found during a previous scan. Skipping automatic bootstrap.",
      );
      return;
    }

    activity?.step("Checking Moose and 514 CLI availability...");
    const installResult = await ensureCoreBinaries(outputChannel);
    state.cliInstallRan = installResult.installed;
    activity?.step("Installing recommended editor extensions...");
    state.installedExtensions = await installRecommendedExtensions(
      context,
      outputChannel,
    );
    activity?.step("Scanning the workspace for Moose projects...");
    state.discoveredProjects = await refreshDiscoveredProjects(
      context,
      outputChannel,
    );

    const activeProject = getActiveProject(context, state);
    if (activeProject) {
      activity?.step("Configuring the active Moose workspace...");
      await configureCurrentWorkspace(
        context,
        state,
        outputChannel,
        false,
        activity,
      );
    } else {
      activity?.step("Bootstrap complete. No Moose projects found yet.");
    }
  } catch (error) {
    const message = getErrorMessage(error);
    outputChannel.appendLine(message);
    await vscode.window.showErrorMessage(
      `MooseStack bootstrap failed: ${message}`,
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("MooseStack");
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  const state = createExtensionState();
  const activityController = createActivityController(
    statusBarItem,
    outputChannel,
  );

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push({
    dispose: () => {
      activityController.dispose();
    },
  });
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.createNewProject, async () => {
      await runCommand(
        "Moose: Create New Project",
        outputChannel,
        activityController,
        async () => {
          await createNewProject(
            context,
            state,
            outputChannel,
            activityController,
          );
        },
      );
    }),
    vscode.commands.registerCommand(COMMANDS.selectActiveProject, async () => {
      await runCommand(
        "Moose: Select Active Moose Project",
        outputChannel,
        activityController,
        async () => {
          await withActivity(
            "Moose: Refreshing Projects",
            outputChannel,
            activityController,
            async (activity) => {
              activity.step("Scanning the workspace for Moose projects...");
              state.discoveredProjects = await refreshDiscoveredProjects(
                context,
                outputChannel,
              );
            },
          );
          await selectActiveProject(context, state, outputChannel);
        },
      );
    }),
    vscode.commands.registerCommand(COMMANDS.configureWorkspace, async () => {
      await runCommand(
        "Moose: Configure Workspace",
        outputChannel,
        activityController,
        async () => {
          await withActivity(
            "Moose: Configuring Workspace",
            outputChannel,
            activityController,
            async (activity) => {
              activity.step("Scanning the workspace for Moose projects...");
              state.discoveredProjects = await refreshDiscoveredProjects(
                context,
                outputChannel,
              );
              await configureCurrentWorkspace(
                context,
                state,
                outputChannel,
                true,
                activity,
              );
            },
          );
        },
      );
    }),
    vscode.commands.registerCommand(COMMANDS.setupHarness, async () => {
      await runCommand(
        "Moose: Re-run Dev Harness Setup",
        outputChannel,
        activityController,
        async () => {
          await withActivity(
            "Moose: Running Dev Harness Setup",
            outputChannel,
            activityController,
            async (activity) => {
              await bootstrap(context, state, outputChannel, activity, false);
            },
          );
        },
      );
    }),
    vscode.commands.registerCommand(COMMANDS.showSetupStatus, async () => {
      await runCommand(
        "Moose: Show Setup Status",
        outputChannel,
        activityController,
        async () => {
          await withActivity(
            "Moose: Gathering Setup Status",
            outputChannel,
            activityController,
            async (activity) => {
              activity.step("Refreshing Moose project discovery...");
              state.discoveredProjects = await refreshDiscoveredProjects(
                context,
                outputChannel,
              );
              state.activeProject = getActiveProject(context, state);
            },
          );
          await vscode.window.showInformationMessage(buildSetupSummary(state), {
            modal: true,
          });
        },
      );
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );
      state.activeProject = getActiveProject(context, state);
    }),
  );

  void withActivity(
    "MooseStack: Bootstrapping Workspace",
    outputChannel,
    activityController,
    async (activity) => {
      await bootstrap(context, state, outputChannel, activity);
    },
  );
}

export function deactivate(): void {}
