import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { COMMANDS } from "./constants";
import {
  findMooseProjects,
  getWorkspaceStateKey,
  hasWorkspaceMarker,
  resolveActiveProject,
} from "./discovery";
import { runShell } from "./processRunner";
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

    if (activeProject) {
      await context.workspaceState.update(
        getWorkspaceStateKey(workspaceFolder.uri.fsPath),
        activeProject,
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

  await configureWorkspace(context, workspaceFolder.uri.fsPath, outputChannel);

  const agentInitStateKey = `moosestack.agentInit:${activeProject}`;
  const alreadyInitialized =
    context.workspaceState.get<boolean>(agentInitStateKey) === true;
  if (rerunAgentInit || !alreadyInitialized) {
    await runAgentInit(activeProject, outputChannel);
    await context.workspaceState.update(agentInitStateKey, true);
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
): Promise<void> {
  await ensureCoreBinaries(outputChannel);

  const templates = await getAvailableTemplates(outputChannel);
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

  const result = await runShell(
    `moose init ${projectName} ${templatePick.template.name}`,
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

  await setActiveProject(context, projectRoot, containingWorkspace);
  state.activeProject = projectRoot;
  state.discoveredProjects = await refreshDiscoveredProjects(
    context,
    outputChannel,
  );

  if (workspaceRoot && projectRoot.startsWith(path.resolve(workspaceRoot))) {
    if (hasWorkspaceMarker(workspaceRoot)) {
      await vscode.window.showInformationMessage(
        "Moose project created in a workspace repo. If needed, add the new folder to pnpm workspaces and use workspace:* dependencies from consumer packages.",
      );
    }

    await configureCurrentWorkspace(context, state, outputChannel, true);
    return;
  }

  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(projectRoot),
    false,
  );
}

async function bootstrap(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  try {
    const installResult = await ensureCoreBinaries(outputChannel);
    state.cliInstallRan = installResult.installed;
    state.installedExtensions = await installRecommendedExtensions(
      context,
      outputChannel,
    );
    state.discoveredProjects = await refreshDiscoveredProjects(
      context,
      outputChannel,
    );

    const activeProject = getActiveProject(context, state);
    if (activeProject) {
      await configureCurrentWorkspace(context, state, outputChannel);
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
  const state = createExtensionState();

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.createNewProject, async () => {
      await createNewProject(context, state, outputChannel);
    }),
    vscode.commands.registerCommand(COMMANDS.selectActiveProject, async () => {
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );
      await selectActiveProject(context, state, outputChannel);
    }),
    vscode.commands.registerCommand(COMMANDS.configureWorkspace, async () => {
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );
      await configureCurrentWorkspace(context, state, outputChannel, true);
    }),
    vscode.commands.registerCommand(COMMANDS.setupHarness, async () => {
      await bootstrap(context, state, outputChannel);
    }),
    vscode.commands.registerCommand(COMMANDS.showSetupStatus, async () => {
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );
      state.activeProject = getActiveProject(context, state);
      await vscode.window.showInformationMessage(buildSetupSummary(state), {
        modal: true,
      });
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );
      state.activeProject = getActiveProject(context, state);
    }),
  );

  void bootstrap(context, state, outputChannel);
}

export function deactivate(): void {}
