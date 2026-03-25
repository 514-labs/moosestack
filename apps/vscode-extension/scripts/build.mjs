import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");
const extensionRoot = path.resolve(__dirname, "..");
const distDir = path.join(extensionRoot, "dist");
const assetsDir = path.join(distDir, "assets");

rmSync(distDir, { force: true, recursive: true });
execFileSync("tsc", ["-p", "tsconfig.json"], {
  cwd: extensionRoot,
  stdio: "inherit",
});
mkdirSync(assetsDir, { recursive: true });

const sharedRoot = path.join(workspaceRoot, "templates", "_shared");
const sharedSettingsPath = path.join(sharedRoot, ".vscode", "settings.json");
const sharedExtensionsPath = path.join(sharedRoot, ".vscode", "extensions.json");
const sharedMcpPath = path.join(sharedRoot, ".mcp.json");

for (const [sourcePath, targetName] of [
  [sharedSettingsPath, "settings.json"],
  [sharedExtensionsPath, "extensions.json"],
  [sharedMcpPath, "mcp.json"],
]) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing shared asset: ${sourcePath}`);
  }

  writeFileSync(path.join(assetsDir, targetName), readFileSync(sourcePath));
}
