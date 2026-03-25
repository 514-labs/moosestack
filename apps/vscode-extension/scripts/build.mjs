import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, "..");
const distDir = path.join(extensionRoot, "dist");

rmSync(distDir, { force: true, recursive: true });
execFileSync("tsc", ["-p", "tsconfig.json"], {
  cwd: extensionRoot,
  stdio: "inherit",
});
