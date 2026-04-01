import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  exports?: {
    ".": {
      types?: string;
      import?: string;
      default?: string;
    };
  };
}

const PACKAGE_MANIFESTS = [
  "../package.json",
  "../../agent-runtime/package.json",
  "../../agent-observability-langfuse/package.json",
] as const;

function readManifest(
  relativePath: (typeof PACKAGE_MANIFESTS)[number],
): PackageManifest {
  const manifestPath = path.resolve(import.meta.dirname, relativePath);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

describe("internal package exports", () => {
  it("publish import-style entry points with a default fallback", () => {
    for (const manifestPath of PACKAGE_MANIFESTS) {
      const manifest = readManifest(manifestPath);
      expect(manifest.exports?.["."]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      });
    }
  });
});
