import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findMooseProjects, resolveActiveProject } from "../discovery";

function withTempDir(run: (tempDir: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-vscode-test-"));
  try {
    run(tempDir);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

test("findMooseProjects discovers sibling nested Moose projects", () => {
  withTempDir((tempDir) => {
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

    const discovered = findMooseProjects(tempDir);
    assert.equal(discovered.length, 2);
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
});
