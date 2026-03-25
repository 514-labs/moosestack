import fs from "node:fs";
import path from "node:path";

import { IGNORED_DIRECTORY_NAMES, normalizePath } from "./constants";

function isIgnoredDirectory(directoryName: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(directoryName);
}

export function findMooseProjects(rootPath: string): string[] {
  const discovered: string[] = [];

  function visit(currentPath: string): void {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasMooseConfig = entries.some(
      (entry) => entry.isFile() && entry.name === "moose.config.toml",
    );

    if (hasMooseConfig) {
      discovered.push(normalizePath(currentPath));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredDirectory(entry.name)) {
        continue;
      }

      visit(path.join(currentPath, entry.name));
    }
  }

  visit(normalizePath(rootPath));

  return discovered.sort();
}

export function hasWorkspaceMarker(rootPath: string): boolean {
  if (
    fs.existsSync(path.join(rootPath, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(rootPath, "turbo.json"))
  ) {
    return true;
  }

  const packageJsonPath = path.join(rootPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
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
