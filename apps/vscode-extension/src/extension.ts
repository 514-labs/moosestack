import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import {
  createActivityController,
  type ActivityController,
  type ActivityReporter,
} from "./activityController";
import { AgentInitCompatibilityError, inferAgentId } from "./agentInit";
import { COMMANDS, IGNORED_DIRECTORY_NAMES } from "./constants";
import {
  findMooseProjects,
  getNoProjectsStateKey,
  getWorkspaceStateKey,
  hasWorkspaceMarker,
  resolveActiveProject,
  shouldSkipAutomaticBootstrapAfterLiveCheck,
} from "./discovery";
import {
  createGetStartedProjectData,
  queuePendingGetStartedProject,
  showGetStartedPanel,
  showPendingGetStartedProject,
} from "./getStartedPanel";
import { runProcess } from "./processRunner";
import {
  ensureCoreBinaries,
  installRecommendedExtensions,
  runAgentInit,
} from "./provisioning";
import { buildSetupSummary } from "./status";
import { getAvailableTemplates } from "./templates";
import type { DiscoveredProject, ExtensionState, TemplateInfo } from "./types";
import { isPathInsideRoot, isSingleDirectoryName } from "./workspacePaths";
import { configureWorkspace } from "./workspaceConfig";

interface ProjectQuickPickItem extends vscode.QuickPickItem {
  projectRoot: string;
  workspaceRoot: string;
}

interface TemplateQuickPickItem extends vscode.QuickPickItem {
  template: TemplateInfo;
}

interface AgentInitSuccessState {
  agentId: string;
  completedAt: string;
  schemaVersion: number;
}

interface AgentInitCompatibilityState {
  agentId: string;
  message: string;
  recordedAt: string;
}

const EXTENSION_BRAND = "Fiveonefour";
const MOOSE_CONFIG_GLOB = "**/moose.config.toml";
const LIVE_MOOSE_CONFIG_EXCLUDE_GLOB = `**/{${Array.from(IGNORED_DIRECTORY_NAMES).join(",")}}/**`;
const ERROR_MESSAGE_ALREADY_SHOWN = Symbol(
  "fiveonefour.errorMessageAlreadyShown",
);

type UserVisibleError = Error & {
  [ERROR_MESSAGE_ALREADY_SHOWN]?: true;
};

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

function markErrorMessageShown(error: unknown): void {
  if (error instanceof Error) {
    (error as UserVisibleError)[ERROR_MESSAGE_ALREADY_SHOWN] = true;
  }
}

function wasErrorMessageShown(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as UserVisibleError)[ERROR_MESSAGE_ALREADY_SHOWN] === true
  );
}

function getCurrentEditorAgentId(): string | null {
  return inferAgentId(vscode.env.appName, vscode.env.uriScheme);
}

async function requireTrustedWorkspace(action: string): Promise<boolean> {
  if (vscode.workspace.isTrusted) {
    return true;
  }

  await vscode.window.showWarningMessage(
    `${EXTENSION_BRAND} is limited in Restricted Mode. Trust the workspace to ${action}.`,
  );
  return false;
}

function getAgentInitSuccessStateKey(
  projectRoot: string,
  agentId: string,
): string {
  return `moosestack.agentInit:${projectRoot}:${agentId}`;
}

function getAgentInitCompatibilityStateKey(
  projectRoot: string,
  agentId: string,
): string {
  return `moosestack.agentInitIncompatible:${projectRoot}:${agentId}`;
}

function getAutomaticBootstrapConsentStateKey(workspaceRoot: string): string {
  return `moosestack.autoBootstrapConsent:${path.resolve(workspaceRoot)}`;
}

async function confirmAutomaticBootstrap(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<boolean> {
  const stateKey = getAutomaticBootstrapConsentStateKey(workspaceRoot);
  const storedDecision = context.workspaceState.get<boolean>(stateKey);

  if (storedDecision !== undefined) {
    return storedDecision;
  }

  const selection = await vscode.window.showInformationMessage(
    `${EXTENSION_BRAND} can install CLI tools, install recommended extensions, and update .vscode workspace files for this Moose project. Run automatic bootstrap now?`,
    { modal: true },
    "Bootstrap",
  );
  const approved = selection === "Bootstrap";
  await context.workspaceState.update(stateKey, approved);
  return approved;
}

async function hasLiveMooseConfig(
  workspaceFolderPath: string,
): Promise<boolean> {
  const matches = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolderPath, MOOSE_CONFIG_GLOB),
    LIVE_MOOSE_CONFIG_EXCLUDE_GLOB,
    1,
  );

  return matches.length > 0;
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
    if (!wasErrorMessageShown(error)) {
      void vscode.window.showErrorMessage(`${title} failed: ${message}`);
    }
  }
}

async function refreshDiscoveredProjects(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<DiscoveredProject[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const discovered: DiscoveredProject[] = [];

  for (const workspaceFolder of workspaceFolders) {
    const projectRoots = await findMooseProjects(workspaceFolder.uri.fsPath);
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
    const activeProject = state.discoveredProjects.find(
      (project) => project.projectRoot === state.activeProject,
    );
    if (activeProject) {
      state.activeProject = activeProject.projectRoot;
      return activeProject.projectRoot;
    }

    state.activeProject = null;
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
  showSuccessMessage = false,
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

  const editorAgentId = getCurrentEditorAgentId();
  if (!editorAgentId) {
    const message =
      "The current editor is not mapped to a supported 514 agent id. Skipping dev harness setup.";
    outputChannel.appendLine(message);
    activity?.step(message);
    if (rerunAgentInit) {
      throw new Error(message);
    }
  } else {
    const agentInitStateKey = getAgentInitSuccessStateKey(
      activeProject,
      editorAgentId,
    );
    const incompatibleStateKey = getAgentInitCompatibilityStateKey(
      activeProject,
      editorAgentId,
    );
    const alreadyInitialized = Boolean(
      context.workspaceState.get<AgentInitSuccessState>(agentInitStateKey),
    );
    const incompatibleState =
      context.workspaceState.get<AgentInitCompatibilityState>(
        incompatibleStateKey,
      ) ?? null;

    if (!rerunAgentInit && incompatibleState) {
      outputChannel.appendLine(incompatibleState.message);
      activity?.step(
        `${incompatibleState.message} Automatic dev harness setup is paused for this workspace.`,
      );
    } else if (rerunAgentInit || !alreadyInitialized) {
      await context.workspaceState.update(incompatibleStateKey, undefined);
      activity?.step(
        `Running 514 agent init for ${editorAgentId} in ${
          path.relative(workspaceFolder.uri.fsPath, activeProject) ||
          path.basename(activeProject)
        }...`,
      );

      try {
        const result = await runAgentInit(activeProject, outputChannel);
        await context.workspaceState.update(agentInitStateKey, {
          agentId: result.agentId,
          completedAt: new Date().toISOString(),
          schemaVersion: result.schemaVersion,
        } satisfies AgentInitSuccessState);
      } catch (error) {
        if (error instanceof AgentInitCompatibilityError) {
          const message = `${error.message} Automatic dev harness setup is paused for this workspace until you re-run it manually.`;
          await context.workspaceState.update(incompatibleStateKey, {
            agentId: editorAgentId,
            message,
            recordedAt: new Date().toISOString(),
          } satisfies AgentInitCompatibilityState);

          if (rerunAgentInit) {
            throw new Error(error.message);
          }

          outputChannel.appendLine(message);
          activity?.step(message);
          void vscode.window.showWarningMessage(message);
          return workspaceFolder.uri.fsPath;
        }

        throw error;
      }
    } else {
      activity?.step(
        `Dev harness already initialized for ${editorAgentId}. Skipping 514 agent init.`,
      );
    }
  }

  if (showSuccessMessage) {
    void vscode.window.showInformationMessage(
      `Moose workspace configured for ${
        path.relative(workspaceFolder.uri.fsPath, activeProject) ||
        activeProject
      }.`,
    );
  }

  await context.workspaceState.update(
    getAutomaticBootstrapConsentStateKey(workspaceFolder.uri.fsPath),
    true,
  );

  return workspaceFolder.uri.fsPath;
}

async function createNewProject(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  outputChannel: vscode.OutputChannel,
  activityController: ActivityController,
): Promise<void> {
  if (!(await requireTrustedWorkspace("create Moose projects"))) {
    return;
  }

  const templates = await withActivity(
    `${EXTENSION_BRAND}: Preparing Moose Project Creation`,
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
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        return "Project name is required.";
      }

      return isSingleDirectoryName(trimmedValue) ? null : (
          "Project name must be a single directory name."
        );
    },
  });

  if (!projectName) {
    return;
  }
  const normalizedProjectName = projectName.trim();
  if (!isSingleDirectoryName(normalizedProjectName)) {
    throw new Error("Project name must be a single directory name.");
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
        return isPathInsideRoot(workspaceRoot, resolvedParent) ? null : (
            "Parent directory must stay inside the current workspace root."
          );
      },
    });

    if (relativeParentDir === undefined) {
      return;
    }

    parentDir = path.resolve(workspaceRoot, relativeParentDir || ".");
    if (!isPathInsideRoot(workspaceRoot, parentDir)) {
      throw new Error(
        "Parent directory must stay inside the current workspace root.",
      );
    }
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
    `${EXTENSION_BRAND}: Creating Moose Project`,
    outputChannel,
    activityController,
    async (activity) => {
      activity.step(
        `Running moose init for ${normalizedProjectName} (${templatePick.template.name})...`,
      );
      const projectRoot = path.resolve(parentDir ?? "", normalizedProjectName);
      if (workspaceRoot && !isPathInsideRoot(workspaceRoot, projectRoot)) {
        throw new Error(
          "Project directory must stay inside the current workspace root.",
        );
      }

      const result = await runProcess(
        "moose",
        ["init", normalizedProjectName, templatePick.template.name],
        {
          cwd: parentDir ?? undefined,
          onStderr: (chunk) => outputChannel.append(chunk),
          onStdout: (chunk) => outputChannel.append(chunk),
        },
      );

      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "moose init failed.");
      }

      const getStartedProject = createGetStartedProjectData(
        projectRoot,
        normalizedProjectName,
        templatePick.template.name,
        result.stdout,
      );
      const containingWorkspace = workspaceRoot ?? path.dirname(projectRoot);

      activity.step("Refreshing discovered Moose projects...");
      await setActiveProject(context, projectRoot, containingWorkspace);
      state.activeProject = projectRoot;
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );

      if (workspaceRoot && isPathInsideRoot(workspaceRoot, projectRoot)) {
        if (await hasWorkspaceMarker(workspaceRoot)) {
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
          true,
        );
        showGetStartedPanel(context, outputChannel, getStartedProject);
        return;
      }

      await queuePendingGetStartedProject(context, getStartedProject);
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
  rerunAgentInit = false,
  showSuccessMessage = false,
  requireAutomaticBootstrapConsent = false,
): Promise<void> {
  try {
    if (!vscode.workspace.isTrusted) {
      activity?.step(
        `Workspace is in Restricted Mode. ${EXTENSION_BRAND} will only scan for Moose projects until trust is granted.`,
      );
      state.discoveredProjects = await refreshDiscoveredProjects(
        context,
        outputChannel,
      );
      state.activeProject = getActiveProject(context, state);
      return;
    }

    const workspaceFolderPaths = (vscode.workspace.workspaceFolders ?? []).map(
      (workspaceFolder) => workspaceFolder.uri.fsPath,
    );

    if (
      respectNoProjectsSkip &&
      (await shouldSkipAutomaticBootstrapAfterLiveCheck(
        workspaceFolderPaths,
        (workspaceFolderPath) =>
          context.workspaceState.get<boolean>(
            getNoProjectsStateKey(workspaceFolderPath),
          ) === true,
        hasLiveMooseConfig,
        async (workspaceFolderPath) => {
          await context.workspaceState.update(
            getNoProjectsStateKey(workspaceFolderPath),
            undefined,
          );
        },
      ))
    ) {
      state.activeProject = null;
      state.discoveredProjects = [];
      activity?.step(
        "No Moose projects were found during a previous scan. Skipping automatic bootstrap.",
      );
      return;
    }

    activity?.step("Scanning the workspace for Moose projects...");
    state.discoveredProjects = await refreshDiscoveredProjects(
      context,
      outputChannel,
    );

    const activeProject = getActiveProject(context, state);
    if (activeProject) {
      const workspaceFolder = getContainingWorkspaceFolder(activeProject);
      if (!workspaceFolder) {
        throw new Error(
          `Could not find a workspace folder for ${activeProject}`,
        );
      }

      if (
        requireAutomaticBootstrapConsent &&
        !(await confirmAutomaticBootstrap(context, workspaceFolder.uri.fsPath))
      ) {
        activity?.step(
          "Automatic bootstrap is paused until you run a Fiveonefour command manually.",
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
      activity?.step("Configuring the active Moose workspace...");
      await configureCurrentWorkspace(
        context,
        state,
        outputChannel,
        rerunAgentInit,
        activity,
        showSuccessMessage,
      );
    } else {
      activity?.step("Bootstrap complete. No Moose projects found yet.");
    }
  } catch (error) {
    const message = getErrorMessage(error);
    outputChannel.appendLine(`${EXTENSION_BRAND} bootstrap failed: ${message}`);
    markErrorMessageShown(error);
    void vscode.window.showErrorMessage(
      `${EXTENSION_BRAND} bootstrap failed: ${message}`,
    );
    throw error;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_BRAND);
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
        `${EXTENSION_BRAND}: Create Moose Project`,
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
        `${EXTENSION_BRAND}: Select Active Moose Project`,
        outputChannel,
        activityController,
        async () => {
          await withActivity(
            `${EXTENSION_BRAND}: Refreshing Projects`,
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
        `${EXTENSION_BRAND}: Configure Workspace`,
        outputChannel,
        activityController,
        async () => {
          if (!(await requireTrustedWorkspace("configure the workspace"))) {
            return;
          }

          await withActivity(
            `${EXTENSION_BRAND}: Configuring Workspace`,
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
                true,
              );
            },
          );
        },
      );
    }),
    vscode.commands.registerCommand(COMMANDS.setupHarness, async () => {
      await runCommand(
        `${EXTENSION_BRAND}: Re-run Dev Harness Setup`,
        outputChannel,
        activityController,
        async () => {
          if (!(await requireTrustedWorkspace("run dev harness setup"))) {
            return;
          }

          await withActivity(
            `${EXTENSION_BRAND}: Running Dev Harness Setup`,
            outputChannel,
            activityController,
            async (activity) => {
              await bootstrap(
                context,
                state,
                outputChannel,
                activity,
                false,
                true,
                true,
                false,
              );
            },
          );
        },
      );
    }),
    vscode.commands.registerCommand(COMMANDS.showSetupStatus, async () => {
      await runCommand(
        `${EXTENSION_BRAND}: Show Setup Status`,
        outputChannel,
        activityController,
        async () => {
          await withActivity(
            `${EXTENSION_BRAND}: Gathering Setup Status`,
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
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void withActivity(
        `${EXTENSION_BRAND}: Bootstrapping Workspace`,
        outputChannel,
        activityController,
        async (activity) => {
          activity.step(
            "Workspace trust granted. Resuming Fiveonefour setup...",
          );
          await bootstrap(
            context,
            state,
            outputChannel,
            activity,
            false,
            false,
            false,
            true,
          );
        },
      ).catch(() => undefined);
    }),
  );

  void withActivity(
    `${EXTENSION_BRAND}: Bootstrapping Workspace`,
    outputChannel,
    activityController,
    async (activity) => {
      await bootstrap(
        context,
        state,
        outputChannel,
        activity,
        true,
        false,
        false,
        true,
      );
      await showPendingGetStartedProject(context, outputChannel);
    },
  ).catch(() => undefined);
}

export function deactivate(): void {}
