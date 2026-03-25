import type { ExtensionState } from "./types";

export function buildSetupSummary(state: ExtensionState): string {
  return [
    `Active Moose project: ${state.activeProject ?? "none"}`,
    `Discovered Moose projects: ${state.discoveredProjects.length}`,
    `CLI install step ran this session: ${state.cliInstallRan ? "yes" : "no"}`,
    `Optional extensions installed: ${state.installedExtensions.length}`,
  ].join("\n");
}
