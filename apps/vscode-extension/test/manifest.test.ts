import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const extensionRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(extensionRoot, "package.json");
const readmePath = path.join(extensionRoot, "README.md");

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
}

test("package manifest matches the installer-only extension scope", () => {
  const manifest = readManifest();
  const activationEvents = manifest.activationEvents as string[];
  const commandContributions = (
    manifest.contributes as {
      commands: Array<{ command: string; title: string }>;
    }
  ).commands;

  assert.equal(manifest.name, "fiveonefour");
  assert.equal(manifest.displayName, "Fiveonefour");
  assert.match(
    String(manifest.description),
    /Install the Moose and 514 CLIs, keep them current/,
  );
  assert.deepEqual(activationEvents, [
    "onStartupFinished",
    "onCommand:fiveonefour.checkInstallState",
  ]);
  assert.equal(Array.isArray(manifest.extensionPack), false);
  assert.deepEqual(commandContributions, [
    {
      command: "fiveonefour.checkInstallState",
      title: "Fiveonefour: Check Install State",
    },
  ]);
});

test("README describes the installer-only harness workflow", () => {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(readme, /Runs the Fiveonefour installer on every activation/);
  assert.match(readme, /moose init/);
  assert.match(
    readme,
    /On Windows, Fiveonefour does not attempt to run the installer/,
  );
});
