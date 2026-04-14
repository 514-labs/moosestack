import * as path from "path";

export interface PythonVenvPaths {
  virtualEnv: string;
  binPath: string;
}

export function buildPythonVenvPaths(projectDir: string): PythonVenvPaths {
  return {
    virtualEnv: path.join(projectDir, ".venv"),
    binPath: path.join(projectDir, ".venv", "bin"),
  };
}
