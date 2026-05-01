import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { logger, ScopedLogger } from "./logger";

const projectSetupLogger = logger.scope("utils:project-setup");

export interface ProjectSetupOptions {
  env?: NodeJS.ProcessEnv;
  logger?: ScopedLogger;
  onInitComplete?: (result: { stdout: string; stderr: string }) => void;
}

const execAsync = promisify(require("child_process").exec);

interface PackageJsonWithMooseLibDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(filePath: string): PackageJsonWithMooseLibDeps {
  const packageJsonSource = fs.readFileSync(filePath, "utf-8");

  try {
    return JSON.parse(packageJsonSource) as PackageJsonWithMooseLibDeps;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${filePath} as JSON: ${details}`);
  }
}

function updateMooseLibDependencyRecursively(
  dir: string,
  mooseLibPath: string,
  log: ScopedLogger,
) {
  const updatedFiles: string[] = [];

  const visit = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".next"
      ) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (entry.name !== "package.json") {
        continue;
      }

      const packageJson = readPackageJson(fullPath);
      let changed = false;

      for (const depKey of ["dependencies", "devDependencies"] as const) {
        if (packageJson[depKey]?.["@514labs/moose-lib"]) {
          packageJson[depKey]["@514labs/moose-lib"] = `file:${mooseLibPath}`;
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(fullPath, `${JSON.stringify(packageJson, null, 2)}\n`);
        updatedFiles.push(fullPath);
      }
    }
  };

  visit(dir);
  log.debug("Updated package.json files to use local moose-lib", {
    updatedFiles,
  });
}

/**
 * Sets up a TypeScript project with the specified template
 */
export const setupTypeScriptProject = async (
  projectDir: string,
  templateName: string,
  cliPath: string,
  mooseLibPath: string,
  appName: string,
  packageManager: "npm" | "pnpm" = "npm",
  options: ProjectSetupOptions = {},
): Promise<void> => {
  const log = options.logger ?? projectSetupLogger;
  const env = {
    ...process.env,
    ...options.env,
  };

  // Initialize project
  log.info(`Initializing TypeScript project with ${templateName} template`);
  try {
    const result = await execAsync(
      `"${cliPath}" init --name ${appName} --template ${templateName} --location "${projectDir}"`,
      { env },
    );
    log.debug("CLI init stdout", { stdout: result.stdout });
    if (result.stderr) {
      log.debug("CLI init stderr", { stderr: result.stderr });
    }
    options.onInitComplete?.({
      stdout: result.stdout,
      stderr: result.stderr ?? "",
    });
  } catch (error: any) {
    log.error("CLI init failed", error);
    throw error;
  }

  // Update package.json files to use local moose-lib.
  // Monorepo templates such as typescript-agent depend on moose-lib from
  // multiple workspace packages.
  log.debug("Updating package.json files to use local moose-lib", {
    mooseLibPath,
  });
  updateMooseLibDependencyRecursively(projectDir, mooseLibPath, log);

  // Install dependencies
  log.info(`Installing dependencies with ${packageManager}`);
  await new Promise<void>((resolve, reject) => {
    const installCmd = spawn(packageManager, ["install"], {
      stdio: "inherit",
      cwd: projectDir,
      env,
    });
    installCmd.on("close", (code) => {
      log.debug(`${packageManager} install completed`, { exitCode: code });
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${packageManager} install failed with code ${code}`));
      }
    });
  });
};

/**
 * Sets up a Python project with the specified template
 */
export const setupPythonProject = async (
  projectDir: string,
  templateName: string,
  cliPath: string,
  moosePyLibPath: string,
  appName: string,
  options: ProjectSetupOptions = {},
): Promise<void> => {
  const log = options.logger ?? projectSetupLogger;
  const env = {
    ...process.env,
    ...options.env,
  };

  // Initialize project
  log.info(`Initializing Python project with ${templateName} template`);
  try {
    const result = await execAsync(
      `"${cliPath}" init --name ${appName} --template ${templateName} --location "${projectDir}"`,
      { env },
    );
    log.debug("CLI init stdout", { stdout: result.stdout });
    if (result.stderr) {
      log.debug("CLI init stderr", { stderr: result.stderr });
    }
  } catch (error: any) {
    log.error("CLI init failed", error);
    throw error;
  }

  // Set up Python environment and install dependencies
  log.info("Setting up Python virtual environment and installing dependencies");
  await new Promise<void>((resolve, reject) => {
    const setupCmd = process.platform === "win32" ? "python" : "python3";

    const venvCmd = spawn(setupCmd, ["-m", "venv", ".venv"], {
      stdio: "inherit",
      cwd: projectDir,
      env,
    });
    venvCmd.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`venv creation failed with code ${code}`));
        return;
      }

      const withVenv = {
        ...env,
        VIRTUAL_ENV: path.join(projectDir, ".venv"),
        PATH: `${path.join(projectDir, ".venv", "bin")}:${env.PATH}`,
      };

      // First install project dependencies from requirements.txt
      const pipReqCmd = spawn(
        process.platform === "win32" ? ".venv\\Scripts\\pip" : ".venv/bin/pip",
        ["install", "-r", "requirements.txt"],
        {
          env: withVenv,
          stdio: "inherit",
          cwd: projectDir,
        },
      );

      pipReqCmd.on("close", (reqPipCode) => {
        if (reqPipCode !== 0) {
          reject(
            new Error(
              `requirements.txt pip install failed with code ${reqPipCode}`,
            ),
          );
          return;
        }

        // Then install the local moose lib
        const pipLocalMooseCmd = spawn(
          process.platform === "win32" ?
            ".venv\\Scripts\\pip"
          : ".venv/bin/pip",
          ["install", "-e", moosePyLibPath],
          {
            env: withVenv,
            stdio: "inherit",
            cwd: projectDir,
          },
        );

        pipLocalMooseCmd.on("close", (moosePipCode) => {
          if (moosePipCode !== 0) {
            reject(
              new Error(
                `moose lib pip install failed with code ${moosePipCode}`,
              ),
            );
            return;
          }
          resolve();
        });
      });
    });
  });
};
