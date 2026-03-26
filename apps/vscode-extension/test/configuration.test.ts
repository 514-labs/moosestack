import assert from "node:assert/strict";
import test from "node:test";

import { mergeExtensions, mergeSettings } from "../src/configuration";

test("mergeSettings keeps existing values and appends shared defaults", () => {
  const merged = mergeSettings(
    {
      "python.analysis.extraPaths": ["src"],
      "sqltools.connections": [{ name: "custom", server: "db.internal" }],
    },
    {
      "python.analysis.extraPaths": [".moose/versions"],
      "sqltools.connections": [
        { name: "moose clickhouse", server: "localhost" },
      ],
    },
  );

  assert.deepEqual(merged["python.analysis.extraPaths"], [
    ".moose/versions",
    "src",
  ]);
  assert.deepEqual(merged["sqltools.connections"], [
    { name: "custom", server: "db.internal" },
    { name: "moose clickhouse", server: "localhost" },
  ]);
});

test("mergeSettings preserves user values for non-special keys", () => {
  const merged = mergeSettings(
    { "editor.tabSize": 8 },
    { "editor.tabSize": 2, "editor.rulers": [80] },
  );

  assert.equal(merged["editor.tabSize"], 8);
  assert.deepEqual(merged["editor.rulers"], [80]);
});

test("mergeExtensions de-duplicates recommendations", () => {
  const merged = mergeExtensions(
    { recommendations: ["514-labs.moosestack-lsp"] },
    { recommendations: ["514-labs.moosestack-lsp", "mtxr.sqltools"] },
  );

  assert.deepEqual(merged.recommendations, [
    "514-labs.moosestack-lsp",
    "mtxr.sqltools",
  ]);
});
