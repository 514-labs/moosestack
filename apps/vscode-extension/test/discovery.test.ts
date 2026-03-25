import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findMooseProjects,
  getNoProjectsStateKey,
  resolveActiveProject,
  shouldSkipAutomaticBootstrap,
} from "../src/discovery";

function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-vscode-test-"));
  return run(tempDir).finally(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });
}

test("findMooseProjects discovers sibling nested Moose projects", async () => {
  await withTempDir(async (tempDir) => {
    fs.mkdirSync(path.join(tempDir, "packages", "analytics"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempDir, "packages", "billing"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, "packages", "analytics", "moose.config.toml"),
      "",
    );
    fs.writeFileSync(
      path.join(tempDir, "packages", "billing", "moose.config.toml"),
      "",
    );

    const discovered = await findMooseProjects(tempDir);
    assert.deepEqual(discovered, [
      path.join(tempDir, "packages", "analytics"),
      path.join(tempDir, "packages", "billing"),
    ]);
  });
});

test("resolveActiveProject prefers the stored project when it still exists", () => {
  const projects = ["/repo/packages/a", "/repo/packages/b"];
  assert.equal(
    resolveActiveProject(projects, "/repo/packages/b"),
    "/repo/packages/b",
  );
  assert.equal(
    resolveActiveProject(projects, "/repo/packages/c"),
    "/repo/packages/a",
  );
  assert.equal(resolveActiveProject([], "/repo/packages/a"), null);
});

test("getNoProjectsStateKey normalizes workspace paths", () => {
  assert.equal(
    getNoProjectsStateKey("/repo/../repo/project"),
    getNoProjectsStateKey("/repo/project"),
  );
});

test("shouldSkipAutomaticBootstrap only skips after every workspace was scanned without projects", () => {
  const emptyWorkspaces = new Set(["/repo/a", "/repo/b"]);

  assert.equal(
    shouldSkipAutomaticBootstrap(
      ["/repo/a", "/repo/b"],
      (workspaceFolderPath) => emptyWorkspaces.has(workspaceFolderPath),
    ),
    true,
  );
  assert.equal(
    shouldSkipAutomaticBootstrap(
      ["/repo/a", "/repo/c"],
      (workspaceFolderPath) => emptyWorkspaces.has(workspaceFolderPath),
    ),
    false,
  );
  assert.equal(
    shouldSkipAutomaticBootstrap([], (workspaceFolderPath) =>
      emptyWorkspaces.has(workspaceFolderPath),
    ),
    false,
  );
});
