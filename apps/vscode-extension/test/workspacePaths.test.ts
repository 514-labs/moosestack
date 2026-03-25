import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isPathInsideRoot, isSingleDirectoryName } from "../src/workspacePaths";

test("isPathInsideRoot rejects directory prefix confusion", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-paths-"));

  try {
    const rootPath = path.join(tempDir, "myapp");
    const siblingPath = path.join(tempDir, "myapp-secrets");

    fs.mkdirSync(path.join(rootPath, "packages", "analytics"), {
      recursive: true,
    });
    fs.mkdirSync(siblingPath, { recursive: true });

    assert.equal(isPathInsideRoot(rootPath, rootPath), true);
    assert.equal(
      isPathInsideRoot(rootPath, path.join(rootPath, "packages", "analytics")),
      true,
    );
    assert.equal(isPathInsideRoot(rootPath, siblingPath), false);
    assert.equal(
      isPathInsideRoot(rootPath, path.resolve(rootPath, "..", "myapp-secrets")),
      false,
    );
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("isPathInsideRoot rejects paths that escape through a symlink", () => {
  if (process.platform === "win32") {
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-paths-"));

  try {
    const workspaceRoot = path.join(tempDir, "workspace");
    const outsideRoot = path.join(tempDir, "outside");
    const outsideLink = path.join(workspaceRoot, "linked-outside");
    const insideRoot = path.join(workspaceRoot, "real-projects");
    const insideLink = path.join(workspaceRoot, "linked-inside");

    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.mkdirSync(insideRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, outsideLink);
    fs.symlinkSync(insideRoot, insideLink);

    assert.equal(
      isPathInsideRoot(workspaceRoot, path.join(outsideLink, "new-project")),
      false,
    );
    assert.equal(
      isPathInsideRoot(workspaceRoot, path.join(insideLink, "new-project")),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

test("isSingleDirectoryName only accepts a single directory segment", () => {
  assert.equal(isSingleDirectoryName("analytics-service"), true);
  assert.equal(isSingleDirectoryName("."), false);
  assert.equal(isSingleDirectoryName(".."), false);
  assert.equal(isSingleDirectoryName("services/api"), false);
  assert.equal(isSingleDirectoryName("services\\api"), false);
});
