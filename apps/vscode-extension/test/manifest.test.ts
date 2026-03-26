import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

interface ExtensionManifest {
  bugs?: {
    url?: unknown;
  };
  categories?: unknown;
  description?: unknown;
  displayName?: unknown;
  galleryBanner?: {
    color?: unknown;
    theme?: unknown;
  };
  homepage?: unknown;
  icon?: unknown;
  keywords?: unknown;
  license?: unknown;
  name?: unknown;
  publisher?: unknown;
  qna?: unknown;
}

const extensionRoot = path.resolve(__dirname, "..", "..");
const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");

test("extension manifest uses a VS Code-compatible name", () => {
  const manifest = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as ExtensionManifest;

  assert.equal(typeof manifest.name, "string");
  const extensionName = manifest.name;

  if (typeof extensionName !== "string") {
    throw new Error("Extension manifest name must be a string.");
  }

  assert.match(
    extensionName,
    /^[a-z0-9][a-z0-9-]*$/,
    "VS Code extension names must be unscoped and use lowercase letters, numbers, or hyphens.",
  );
});

test("extension manifest declares a publisher", () => {
  const manifest = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as ExtensionManifest;

  assert.equal(typeof manifest.publisher, "string");
  const publisher = manifest.publisher;

  if (typeof publisher !== "string") {
    throw new Error("Extension manifest publisher must be a string.");
  }

  assert.notEqual(publisher.trim(), "");
});

test("extension manifest includes marketplace presentation metadata", () => {
  const manifest = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as ExtensionManifest;

  assert.equal(typeof manifest.displayName, "string");
  const displayName = manifest.displayName;

  if (typeof displayName !== "string") {
    throw new Error("Extension manifest displayName must be a string.");
  }

  assert.notEqual(displayName.trim(), "");

  assert.equal(typeof manifest.description, "string");
  const description = manifest.description;

  if (typeof description !== "string") {
    throw new Error("Extension manifest description must be a string.");
  }

  assert.notEqual(description.trim(), "");

  assert.equal(typeof manifest.homepage, "string");
  assert.equal(manifest.homepage, "https://docs.fiveonefour.com/moosestack");

  assert.ok(Array.isArray(manifest.categories));
  assert.ok(manifest.categories.includes("Other"));
  assert.ok(manifest.categories.includes("Extension Packs"));

  assert.ok(Array.isArray(manifest.keywords));
  assert.ok(manifest.keywords.length > 0);
  assert.ok(manifest.keywords.includes("moosestack"));

  assert.equal(manifest.license, "SEE LICENSE IN LICENSE");
  assert.ok(fs.existsSync(path.join(extensionRoot, "LICENSE")));

  assert.equal(manifest.icon, "icon.png");
  assert.ok(fs.existsSync(path.join(extensionRoot, "icon.png")));

  assert.deepEqual(manifest.galleryBanner, {
    color: "#000000",
    theme: "dark",
  });

  assert.deepEqual(manifest.bugs, {
    url: "https://github.com/514-labs/moosestack/issues",
  });
  assert.equal(manifest.qna, "http://slack.moosestack.com/");
});
