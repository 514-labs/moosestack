import assert from "node:assert/strict";
import test from "node:test";

import { buildSetupSummary } from "../src/status";

test("buildSetupSummary returns a readable status block", () => {
  const summary = buildSetupSummary({
    activeProject: "/repo/moose",
    cliInstallRan: true,
    discoveredProjects: [
      {
        label: "moose",
        projectRoot: "/repo/moose",
        workspaceRoot: "/repo",
      },
    ],
    installedExtensions: ["mtxr.sqltools"],
  });

  assert.match(summary, /Active Moose project: \/repo\/moose/);
  assert.match(summary, /Optional extensions installed: 1/);
});
