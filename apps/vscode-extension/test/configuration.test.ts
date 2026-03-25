import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mergeExtensions,
  mergeMcpConfig,
  mergeSettings,
  readJson,
} from "../src/configuration";

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

test("mergeSettings keeps existing SQLTools connections on name collisions", () => {
  const merged = mergeSettings(
    {
      "sqltools.connections": [
        { name: "moose clickhouse", server: "db.internal", port: 9440 },
      ],
    },
    {
      "sqltools.connections": [
        { name: "moose clickhouse", server: "localhost", port: 8123 },
      ],
    },
  );

  assert.deepEqual(merged["sqltools.connections"], [
    { name: "moose clickhouse", server: "db.internal", port: 9440 },
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

test("mergeMcpConfig preserves existing MCP servers and shared defaults", () => {
  const merged = mergeMcpConfig(
    {
      mcpServers: {
        custom: {
          command: "custom-mcp",
          type: "stdio",
        },
      },
    },
    {
      mcpServers: {
        "moose-dev": {
          type: "http",
          url: "http://localhost:4000/mcp",
        },
      },
    },
  );

  assert.deepEqual(merged.mcpServers, {
    custom: {
      command: "custom-mcp",
      type: "stdio",
    },
    "moose-dev": {
      type: "http",
      url: "http://localhost:4000/mcp",
    },
  });
});

test("readJson returns null when a config file contains malformed JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-vscode-test-"));

  try {
    const filePath = path.join(tempDir, "settings.json");
    fs.writeFileSync(filePath, "{invalid json");

    assert.equal(readJson(filePath), null);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
