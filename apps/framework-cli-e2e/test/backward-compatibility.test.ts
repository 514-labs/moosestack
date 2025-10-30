/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Backward Compatibility E2E Test
 *
 * Tests that upgrading from version n-1 (latest npm/pypi) to version n (current build)
 * does not break existing deployments.
 *
 * The test:
 * 1. Initializes projects using the LATEST published CLI version from npm/pypi
 * 2. Starts the project with `moose dev` to create infrastructure
 * 3. Stops the project
 * 4. Runs `moose plan` with the NEW CLI from this branch
 * 5. Asserts that no (or minimal expected) changes are detected
 *
 * This is critical for catching breaking changes in infrastructure map format,
 * particularly changes like table ID prefixes with database names.
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

// Import constants and utilities
import {
  TIMEOUTS,
  SERVER_CONFIG,
  TEMPLATE_NAMES,
  APP_NAMES,
} from "./constants";

import {
  stopDevProcess,
  waitForServerStart,
  waitForKafkaReady,
  cleanupDocker,
  cleanupClickhouseData,
  removeTestProject,
  createTempTestDirectory,
} from "./utils";

const execAsync = promisify(require("child_process").exec);
const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => global.setTimeout(resolve, ms));

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);
const MOOSE_PY_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/py-moose-lib",
);

/**
 * Check the latest published version of moose-cli
 */
async function checkLatestPublishedCLI(): Promise<void> {
  console.log("Checking latest published moose-cli from npm...");

  // Check if npx moose-cli is available (this downloads the latest version)
  try {
    const { stdout } = await execAsync(
      "npx -y @514labs/moose-cli@latest --version",
    );
    console.log("Latest published CLI version:", stdout.trim());
  } catch (error: any) {
    console.error("Failed to get latest CLI from npm:", error.message);
    throw new Error(
      "Cannot check latest published CLI for backward compatibility test",
    );
  }
}

/**
 * Setup TypeScript project with latest npm moose-lib
 */
async function setupTypeScriptProjectWithLatestNpm(
  projectDir: string,
  templateName: string,
  appName: string,
): Promise<void> {
  console.log(`Initializing TypeScript project with latest npm moose-cli...`);

  // Initialize project with latest CLI via npx
  try {
    const result = await execAsync(
      `npx -y @514labs/moose-cli@latest init ${appName} ${templateName} --location "${projectDir}"`,
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

  // Install dependencies with latest moose-lib from npm
  console.log(
    "Installing dependencies with npm (using latest @514labs/moose-lib)...",
  );
  await new Promise<void>((resolve, reject) => {
    const installCmd = spawn("npm", ["install"], {
      stdio: "inherit",
      cwd: projectDir,
    });
    installCmd.on("close", (code) => {
      console.log(`npm install exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });
  });
}

/**
 * Setup Python project with latest pypi moose-lib
 */
async function setupPythonProjectWithLatestPypi(
  projectDir: string,
  templateName: string,
  appName: string,
): Promise<void> {
  console.log(`Initializing Python project with latest pypi moose-cli...`);

  // Initialize project with latest CLI via npx
  try {
    const result = await execAsync(
      `npx -y @514labs/moose-cli@latest init ${appName} ${templateName} --location "${projectDir}"`,
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

  // Set up Python environment and install dependencies with latest moose-lib from pypi
  console.log(
    "Setting up Python virtual environment and installing dependencies (using latest moose-lib)...",
  );
  await new Promise<void>((resolve, reject) => {
    // Use python3.13 specifically to avoid Python 3.14 compatibility issues
    const setupCmd = process.platform === "win32" ? "python" : "python3.13";
    const venvCmd = spawn(setupCmd, ["-m", "venv", ".venv"], {
      stdio: "inherit",
      cwd: projectDir,
    });
    venvCmd.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`venv creation failed with code ${code}`));
        return;
      }

      // Install project dependencies from requirements.txt
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
        resolve();
      });
    });
  });
}

interface BackwardCompatibilityTestConfig {
  templateName: string;
  displayName: string;
  projectDirSuffix: string;
  appName: string;
  language: "typescript" | "python";
}

const BACKWARD_COMPAT_CONFIGS: BackwardCompatibilityTestConfig[] = [
  {
    templateName: TEMPLATE_NAMES.TYPESCRIPT_TESTS,
    displayName: "TypeScript Tests Template",
    projectDirSuffix: "ts-tests-backward-compat",
    appName: APP_NAMES.TYPESCRIPT_TESTS,
    language: "typescript",
  },
  {
    templateName: TEMPLATE_NAMES.PYTHON_TESTS,
    displayName: "Python Tests Template",
    projectDirSuffix: "py-tests-backward-compat",
    appName: APP_NAMES.PYTHON_TESTS,
    language: "python",
  },
];

describe("Backward Compatibility Tests", function () {
  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Check latest published CLI is available
    await checkLatestPublishedCLI();

    // Verify new CLI is built
    try {
      await fs.promises.access(CLI_PATH, fs.constants.F_OK);
    } catch (err) {
      console.error(
        `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
      );
      throw err;
    }
  });

  for (const config of BACKWARD_COMPAT_CONFIGS) {
    describe(`${config.displayName} - Upgrade from n-1 to n`, function () {
      let devProcess: ChildProcess | null = null;
      let TEST_PROJECT_DIR: string;

      before(async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS * 2); // Double timeout for setup

        // Create temporary directory for this test
        TEST_PROJECT_DIR = createTempTestDirectory(config.projectDirSuffix);

        // Setup project with LATEST published version
        if (config.language === "typescript") {
          await setupTypeScriptProjectWithLatestNpm(
            TEST_PROJECT_DIR,
            config.templateName,
            config.appName,
          );
        } else {
          await setupPythonProjectWithLatestPypi(
            TEST_PROJECT_DIR,
            config.templateName,
            config.appName,
          );
        }

        // Start dev server with LATEST published CLI via npx
        console.log(
          "Starting dev server with LATEST published CLI (via npx)...",
        );
        const devEnv =
          config.language === "python" ?
            {
              ...process.env,
              VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
              PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
              // Add test credentials for S3Queue tests
              TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
              TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
            }
          : {
              ...process.env,
              // Add test credentials for S3Queue tests
              TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
              TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
            };

        // Use npx to run the latest published moose-cli
        devProcess = spawn("npx", ["-y", "@514labs/moose-cli@latest", "dev"], {
          stdio: "pipe",
          cwd: TEST_PROJECT_DIR,
          env: devEnv,
        });

        await waitForServerStart(
          devProcess,
          TIMEOUTS.SERVER_STARTUP_MS,
          SERVER_CONFIG.startupMessage,
          SERVER_CONFIG.url,
        );
        console.log(
          "Server started with latest CLI, waiting for Kafka broker to be ready...",
        );
        await waitForKafkaReady(TIMEOUTS.KAFKA_READY_MS);
        console.log("Kafka ready, waiting for infrastructure to stabilize...");
        await setTimeoutAsync(TIMEOUTS.PRE_TEST_WAIT_MS);

        // Stop the dev server
        console.log("Stopping dev server with latest CLI...");
        await stopDevProcess(devProcess);
        devProcess = null;

        // Wait a bit for cleanup
        await setTimeoutAsync(5000);
      });

      after(async function () {
        this.timeout(TIMEOUTS.CLEANUP_MS);
        try {
          console.log(`Starting cleanup for ${config.displayName} test...`);
          if (devProcess) {
            await stopDevProcess(devProcess);
          }
          await cleanupDocker(TEST_PROJECT_DIR, config.appName);
          removeTestProject(TEST_PROJECT_DIR);
          console.log(`Cleanup completed for ${config.displayName} test`);
        } catch (error) {
          console.error("Error during cleanup:", error);
          // Force cleanup even if some steps fail
          try {
            if (devProcess && !devProcess.killed) {
              devProcess.kill("SIGKILL");
            }
          } catch (killError) {
            console.error("Error killing process:", killError);
          }
          removeTestProject(TEST_PROJECT_DIR);
        }
      });

      it("should show no changes when running moose plan with new CLI", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        console.log(
          `\nRunning 'moose plan' with NEW CLI (${CLI_PATH}) on project initialized with latest published CLI...`,
        );

        // Update dependencies to use local moose-lib for the new CLI to work
        if (config.language === "typescript") {
          const packageJsonPath = path.join(TEST_PROJECT_DIR, "package.json");
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf-8"),
          );
          packageJson.dependencies["@514labs/moose-lib"] =
            `file:${MOOSE_LIB_PATH}`;
          fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(packageJson, null, 2),
          );

          console.log("Reinstalling dependencies with local moose-lib...");
          await execAsync("npm install", { cwd: TEST_PROJECT_DIR });
        } else {
          console.log("Installing local moose-lib...");
          await execAsync(`.venv/bin/pip install -e "${MOOSE_PY_LIB_PATH}"`, {
            cwd: TEST_PROJECT_DIR,
          });
        }

        // Run moose plan with NEW CLI
        try {
          const { stdout, stderr } = await execAsync(`"${CLI_PATH}" plan`, {
            cwd: TEST_PROJECT_DIR,
            env:
              config.language === "python" ?
                {
                  ...process.env,
                  VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
                  PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
                }
              : process.env,
          });

          console.log("moose plan stdout:", stdout);
          if (stderr) {
            console.log("moose plan stderr:", stderr);
          }

          // The plan should show no changes (or only minimal expected changes)
          // Key assertion: we should NOT see table recreations or major schema changes
          const output = stdout.toLowerCase();

          // These would indicate breaking changes:
          if (output.includes("drop table") || output.includes("droptable")) {
            throw new Error(
              `Unexpected table drop detected in plan output. This indicates a backward incompatible change:\n${stdout}`,
            );
          }

          if (
            output.includes("create table") ||
            output.includes("createtable")
          ) {
            throw new Error(
              `Unexpected table creation detected in plan output. This indicates tables weren't recognized:\n${stdout}`,
            );
          }

          // Check for "no changes" message or empty operations
          const hasNoChanges =
            output.includes("no changes") ||
            output.includes("operations: []") ||
            output.includes("0 changes") ||
            output.match(/operations:\s*\[\s*\]/);

          if (!hasNoChanges) {
            console.warn(
              `Plan output shows some changes. Reviewing for acceptability:\n${stdout}`,
            );

            // Some changes might be acceptable (e.g., metadata updates)
            // But we should not see structural changes
            const hasStructuralChanges =
              output.includes("alter table") ||
              output.includes("add column") ||
              output.includes("drop column") ||
              output.includes("modify column");

            if (hasStructuralChanges) {
              throw new Error(
                `Unexpected structural changes detected in plan output:\n${stdout}`,
              );
            }

            console.log(
              "Plan shows minor changes only, which may be acceptable.",
            );
          } else {
            console.log(
              "✅ No changes detected - backward compatibility verified!",
            );
          }
        } catch (error: any) {
          console.error("moose plan failed:", error.message);
          if (error.stdout) console.error("stdout:", error.stdout);
          if (error.stderr) console.error("stderr:", error.stderr);
          throw error;
        }
      });
    });
  }
});
