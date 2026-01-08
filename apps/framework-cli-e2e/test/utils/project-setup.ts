import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { logger, ScopedLogger } from "./logger";

const projectSetupLogger = logger.scope("utils:project-setup");

export interface ProjectSetupOptions {
  logger?: ScopedLogger;
}

const execAsync = promisify(require("child_process").exec);

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

  // Initialize project
  log.info(`Initializing TypeScript project with ${templateName} template`);
  try {
    const result = await execAsync(
      `"${cliPath}" init ${appName} ${templateName} --location "${projectDir}"`,
    );
    log.debug("CLI init stdout", { stdout: result.stdout });
    if (result.stderr) {
      log.debug("CLI init stderr", { stderr: result.stderr });
    }
  } catch (error: any) {
    log.error("CLI init failed", error);
    throw error;
  }

  // Update package.json to use local moose-lib
  log.debug("Updating package.json to use local moose-lib", { mooseLibPath });
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  packageJson.dependencies["@514labs/moose-lib"] = `file:${mooseLibPath}`;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Install dependencies
  log.info(`Installing dependencies with ${packageManager}`);
  await new Promise<void>((resolve, reject) => {
    const installCmd = spawn(packageManager, ["install"], {
      stdio: "inherit",
      cwd: projectDir,
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

  // Initialize project
  log.info(`Initializing Python project with ${templateName} template`);
  try {
    const result = await execAsync(
      `"${cliPath}" init ${appName} ${templateName} --location "${projectDir}"`,
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
      env: {
        ...process.env,
      },
    });
    venvCmd.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`venv creation failed with code ${code}`));
        return;
      }

      const withVenv = {
        ...process.env,
        VIRTUAL_ENV: path.join(projectDir, ".venv"),
        PATH: `${path.join(projectDir, ".venv", "bin")}:${process.env.PATH}`,
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
