import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { isPathInsideRoot, isSingleDirectoryName } from "../src/workspacePaths";

test("isPathInsideRoot rejects directory prefix confusion", () => {
  const rootPath = path.join(path.sep, "repo", "myapp");

  assert.equal(isPathInsideRoot(rootPath, rootPath), true);
  assert.equal(
    isPathInsideRoot(rootPath, path.join(rootPath, "packages", "analytics")),
    true,
  );
  assert.equal(
    isPathInsideRoot(rootPath, path.join(path.sep, "repo", "myapp-secrets")),
    false,
  );
  assert.equal(
    isPathInsideRoot(rootPath, path.resolve(rootPath, "..", "myapp-secrets")),
    false,
  );
});

test("isSingleDirectoryName only accepts a single directory segment", () => {
  assert.equal(isSingleDirectoryName("analytics-service"), true);
  assert.equal(isSingleDirectoryName("."), false);
  assert.equal(isSingleDirectoryName(".."), false);
  assert.equal(isSingleDirectoryName("services/api"), false);
  assert.equal(isSingleDirectoryName("services\\api"), false);
});
