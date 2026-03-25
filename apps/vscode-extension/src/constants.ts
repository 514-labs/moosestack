import path from "node:path";

export const COMMANDS = {
  configureWorkspace: "moosestack.configureWorkspace",
  createNewProject: "moosestack.createNewProject",
  selectActiveProject: "moosestack.selectActiveProject",
  setupHarness: "moosestack.setupHarness",
  showSetupStatus: "moosestack.showSetupStatus",
} as const;

export const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".venv",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
  "target",
  "test-results",
  "tmp",
]);

export const ASSET_FILE_NAMES = {
  extensions: "extensions.json",
  mcp: "mcp.json",
  settings: "settings.json",
} as const;

export function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}
