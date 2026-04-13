import * as path from "path";

export function buildPythonVenvPaths(projectDir: string) {
  return {
    virtualEnv: path.join(projectDir, ".venv"),
    binPath: path.join(projectDir, ".venv", "bin"),
  };
}
