import fs from "node:fs";
import path from "node:path";

import { IGNORED_DIRECTORY_NAMES, normalizePath } from "./constants";

function isIgnoredDirectory(directoryName: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(directoryName);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findMooseProjects(rootPath: string): Promise<string[]> {
  const discovered: string[] = [];
  const queue = [normalizePath(rootPath)];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(currentPath, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    const hasMooseConfig = entries.some(
      (entry) => entry.isFile() && entry.name === "moose.config.toml",
    );

    if (hasMooseConfig) {
      discovered.push(normalizePath(currentPath));
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredDirectory(entry.name)) {
        continue;
      }

      queue.push(normalizePath(path.join(currentPath, entry.name)));
    }
  }

  return discovered.sort();
}

export async function hasWorkspaceMarker(rootPath: string): Promise<boolean> {
  if (
    (await pathExists(path.join(rootPath, "pnpm-workspace.yaml"))) ||
    (await pathExists(path.join(rootPath, "turbo.json")))
  ) {
    return true;
  }

  const packageJsonPath = path.join(rootPath, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(packageJsonPath, "utf8"),
    ) as {
      workspaces?: unknown;
    };
    return Boolean(packageJson.workspaces);
  } catch {
    return false;
  }
}

export function resolveActiveProject(
  discoveredProjects: readonly string[],
  storedProjectPath: string | null | undefined,
): string | null {
  if (
    storedProjectPath &&
    discoveredProjects.includes(normalizePath(storedProjectPath))
  ) {
    return normalizePath(storedProjectPath);
  }

  return discoveredProjects[0] ?? null;
}

export function getWorkspaceStateKey(workspaceFolderPath: string): string {
  return `moosestack.activeProject:${normalizePath(workspaceFolderPath)}`;
}

export function getNoProjectsStateKey(workspaceFolderPath: string): string {
  return `moosestack.noProjects:${normalizePath(workspaceFolderPath)}`;
}

export function shouldSkipAutomaticBootstrap(
  workspaceFolderPaths: readonly string[],
  hasPreviouslyScannedWithoutProjects: (workspaceFolderPath: string) => boolean,
): boolean {
  return (
    workspaceFolderPaths.length > 0 &&
    workspaceFolderPaths.every((workspaceFolderPath) =>
      hasPreviouslyScannedWithoutProjects(normalizePath(workspaceFolderPath)),
    )
  );
}

export async function shouldSkipAutomaticBootstrapAfterLiveCheck(
  workspaceFolderPaths: readonly string[],
  hasPreviouslyScannedWithoutProjects: (workspaceFolderPath: string) => boolean,
  hasLiveMooseConfig: (workspaceFolderPath: string) => Promise<boolean>,
  clearNoProjectsState: (workspaceFolderPath: string) => Promise<void>,
): Promise<boolean> {
  const normalizedWorkspaceFolderPaths =
    workspaceFolderPaths.map(normalizePath);

  if (
    !shouldSkipAutomaticBootstrap(
      normalizedWorkspaceFolderPaths,
      hasPreviouslyScannedWithoutProjects,
    )
  ) {
    return false;
  }

  let foundLiveProject = false;

  for (const workspaceFolderPath of normalizedWorkspaceFolderPaths) {
    if (!(await hasLiveMooseConfig(workspaceFolderPath))) {
      continue;
    }

    foundLiveProject = true;
    await clearNoProjectsState(workspaceFolderPath);
  }

  return !foundLiveProject;
}
