import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

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
): Promise<void> => {
  // Initialize project
  console.log(
    `Initializing TypeScript project with ${templateName} template...`,
  );
  try {
    const result = await execAsync(
      `"${cliPath}" init ${appName} ${templateName} --location "${projectDir}"`,
    );
    console.log("CLI init stdout:", result.stdout);
    if (result.stderr) {
      console.log("CLI init stderr:", result.stderr);
    }
  } catch (error: any) {
    console.error("CLI init failed:", error.message);
    if (error.stdout) console.error("stdout:", error.stdout);
    if (error.stderr) console.error("stderr:", error.stderr);
    throw error;
  }

  // Update package.json to use local moose-lib
  console.log("Updating package.json to use local moose-lib...");
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  packageJson.dependencies["@514labs/moose-lib"] = `file:${mooseLibPath}`;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Install dependencies
  console.log("Installing dependencies...");
  await new Promise<void>((resolve, reject) => {
    const npmInstall = spawn("npm", ["install"], {
      stdio: "inherit",
      cwd: projectDir,
    });
    npmInstall.on("close", (code) => {
      console.log(`npm install exited with code ${code}`);
      code === 0 ? resolve() : (
        reject(new Error(`npm install failed with code ${code}`))
      );
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
): Promise<void> => {
  // Initialize project
  console.log(`Initializing Python project with ${templateName} template...`);
  try {
    const result = await execAsync(
      `"${cliPath}" init ${appName} ${templateName} --location "${projectDir}"`,
    );
    console.log("CLI init stdout:", result.stdout);
    if (result.stderr) {
      console.log("CLI init stderr:", result.stderr);
    }
  } catch (error: any) {
    console.error("CLI init failed:", error.message);
    if (error.stdout) console.error("stdout:", error.stdout);
    if (error.stderr) console.error("stderr:", error.stderr);
    throw error;
  }

  // Set up Python environment and install dependencies
  console.log(
    "Setting up Python virtual environment and installing dependencies...",
  );
  await new Promise<void>((resolve, reject) => {
    const setupCmd = process.platform === "win32" ? "python" : "python3";
    const venvCmd = spawn(setupCmd, ["-m", "venv", ".venv"], {
      stdio: "inherit",
      cwd: projectDir,
    });
    venvCmd.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`venv creation failed with code ${code}`));
        return;
      }

      // First install project dependencies from requirements.txt
      const pipReqCmd = spawn(
        process.platform === "win32" ? ".venv\\Scripts\\pip" : ".venv/bin/pip",
        ["install", "-r", "requirements.txt"],
        {
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
        const pipMooseCmd = spawn(
          process.platform === "win32" ?
            ".venv\\Scripts\\pip"
          : ".venv/bin/pip",
          ["install", "-e", moosePyLibPath],
          {
            stdio: "inherit",
            cwd: projectDir,
          },
        );

        pipMooseCmd.on("close", (moosePipCode) => {
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
