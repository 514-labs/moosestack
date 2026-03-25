import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type * as vscode from "vscode";

import { configureWorkspace } from "../src/workspaceConfig";

function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-vscode-test-"));
  return run(tempDir).finally(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });
}

function writeBundledAssets(extensionPath: string): void {
  const assetsDir = path.join(extensionPath, "dist", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(
    path.join(assetsDir, "settings.json"),
    JSON.stringify(
      {
        "editor.tabSize": 2,
        "python.analysis.extraPaths": [".moose/versions"],
        "sqltools.connections": [
          { name: "moose clickhouse", server: "localhost" },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(assetsDir, "extensions.json"),
    JSON.stringify(
      {
        recommendations: ["514-labs.moosestack-lsp"],
        unwantedRecommendations: ["bad.extension"],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(assetsDir, "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          "moose-dev": {
            type: "http",
            url: "http://localhost:4000/mcp",
          },
        },
      },
      null,
      2,
    ),
  );
}

test("configureWorkspace writes merged workspace config and is idempotent", async () => {
  await withTempDir(async (tempDir) => {
    const extensionPath = path.join(tempDir, "extension");
    const workspaceRoot = path.join(tempDir, "workspace");
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const outputLines: string[] = [];

    fs.mkdirSync(vscodeDir, { recursive: true });
    writeBundledAssets(extensionPath);

    fs.writeFileSync(
      path.join(vscodeDir, "settings.json"),
      JSON.stringify(
        {
          "editor.tabSize": 8,
          "sqltools.connections": [{ name: "custom", server: "db.internal" }],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(vscodeDir, "extensions.json"),
      JSON.stringify(
        {
          recommendations: ["eamodio.gitlens"],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(vscodeDir, "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            custom: {
              command: "custom-mcp",
              type: "stdio",
            },
          },
        },
        null,
        2,
      ),
    );

    const context = { extensionPath } as unknown as vscode.ExtensionContext;
    const outputChannel = {
      appendLine(line: string) {
        outputLines.push(line);
      },
    } as unknown as vscode.OutputChannel;

    const firstResult = await configureWorkspace(
      context,
      workspaceRoot,
      outputChannel,
    );

    assert.deepEqual(firstResult, {
      extensionsChanged: true,
      mcpChanged: true,
      settingsChanged: true,
    });

    const settings = JSON.parse(
      fs.readFileSync(path.join(vscodeDir, "settings.json"), "utf8"),
    );
    const extensions = JSON.parse(
      fs.readFileSync(path.join(vscodeDir, "extensions.json"), "utf8"),
    );
    const mcp = JSON.parse(
      fs.readFileSync(path.join(vscodeDir, "mcp.json"), "utf8"),
    );

    assert.equal(settings["editor.tabSize"], 8);
    assert.deepEqual(settings["python.analysis.extraPaths"], [
      ".moose/versions",
    ]);
    assert.deepEqual(settings["sqltools.connections"], [
      { name: "custom", server: "db.internal" },
      { name: "moose clickhouse", server: "localhost" },
    ]);
    assert.deepEqual(extensions.recommendations, [
      "514-labs.moosestack-lsp",
      "eamodio.gitlens",
    ]);
    assert.deepEqual(extensions.unwantedRecommendations, ["bad.extension"]);
    assert.deepEqual(mcp, {
      mcpServers: {
        custom: {
          command: "custom-mcp",
          type: "stdio",
        },
        "moose-dev": {
          type: "http",
          url: "http://localhost:4000/mcp",
        },
      },
    });
    assert.match(outputLines[0] ?? "", /Workspace config sync complete/);

    const secondResult = await configureWorkspace(
      context,
      workspaceRoot,
      outputChannel,
    );

    assert.deepEqual(secondResult, {
      extensionsChanged: false,
      mcpChanged: false,
      settingsChanged: false,
    });
  });
});
