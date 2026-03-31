import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

interface ExtensionManifest {
  activationEvents?: unknown;
  bugs?: {
    url?: unknown;
  };
  categories?: unknown;
  contributes?: {
    commands?: Array<{ command: string; title: string }>;
  };
  description?: unknown;
  displayName?: unknown;
  extensionPack?: unknown;
  galleryBanner?: {
    color?: unknown;
    theme?: unknown;
  };
  homepage?: unknown;
  icon?: unknown;
  keywords?: unknown;
  license?: unknown;
  markdown?: unknown;
  name?: unknown;
  publisher?: unknown;
  qna?: unknown;
}

const extensionRoot = path.resolve(__dirname, "../..");
const packageJsonPath = path.join(extensionRoot, "package.json");
const readmePath = path.join(extensionRoot, "README.md");

function readManifest(): ExtensionManifest {
  return JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as ExtensionManifest;
}

test("package manifest matches the installer-only extension scope", () => {
  const manifest = readManifest();
  const activationEvents = manifest.activationEvents as string[];
  const commandContributions = manifest.contributes?.commands ?? [];

  assert.equal(manifest.name, "fiveonefour");
  assert.equal(manifest.displayName, "Fiveonefour");
  assert.equal(typeof manifest.publisher, "string");
  assert.equal(
    manifest.description,
    "Install the Moose and 514 CLIs, keep them current, and show Moose Harness getting-started guidance for VS Code-family editors.",
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

test("extension manifest includes marketplace presentation metadata", () => {
  const manifest = readManifest();

  assert.equal(manifest.homepage, "https://docs.fiveonefour.com/moosestack");
  assert.deepEqual(manifest.bugs, {
    url: "https://github.com/514-labs/moosestack/issues",
  });
  assert.equal(manifest.qna, "http://slack.moosestack.com/");

  assert.ok(Array.isArray(manifest.categories));
  assert.ok((manifest.categories as string[]).includes("Other"));

  assert.ok(Array.isArray(manifest.keywords));
  assert.ok((manifest.keywords as string[]).includes("moosestack"));
  assert.ok((manifest.keywords as string[]).includes("harness"));

  assert.equal(manifest.license, "SEE LICENSE IN LICENSE");
  assert.ok(fs.existsSync(path.join(extensionRoot, "LICENSE")));

  assert.equal(manifest.markdown, "github");
  assert.equal(manifest.icon, "icon.png");
  assert.ok(fs.existsSync(path.join(extensionRoot, "icon.png")));

  assert.deepEqual(manifest.galleryBanner, {
    color: "#000000",
    theme: "dark",
  });
});

test("README describes the installer-only harness workflow", () => {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(
    readme,
    /Runs the official Fiveonefour installer on every activation/,
  );
  assert.match(readme, /moose init/);
  assert.match(
    readme,
    /On Windows, Fiveonefour does not attempt to run the installer/,
  );
});
