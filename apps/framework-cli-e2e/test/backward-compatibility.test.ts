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
 * particularly changes like table ID prefixes with database names and upgrades
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
  cleanupDocker,
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

  try {
    // using npx for both languages as they are the same binary
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

        // Generate a test admin token for backward compatibility testing
        // Token format: 32_hex_chars.32_hex_chars (16 bytes each)
        // Hash computed using PBKDF2-HMAC-SHA256(token_hex, salt_hex, 1000 iterations, 20 bytes)
        const TEST_ADMIN_TOKEN =
          "deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef";
        const TEST_ADMIN_HASH = "445fd4696cfc5c49e28995c4aba05de44303a112";

        // Configure admin API key in moose.config.toml
        console.log("Configuring admin API key in moose.config.toml...");
        const mooseConfigPath = path.join(
          TEST_PROJECT_DIR,
          "moose.config.toml",
        );
        let mooseConfig = fs.readFileSync(mooseConfigPath, "utf-8");
        // Check if [authentication] section exists
        if (mooseConfig.includes("[authentication]")) {
          // Replace the empty [authentication] section with one that includes admin_api_key
          mooseConfig = mooseConfig.replace(
            /\[authentication\]\s*$/m,
            `[authentication]\nadmin_api_key = "${TEST_ADMIN_HASH}"`,
          );
        } else {
          // Append the [authentication] section if it doesn't exist
          mooseConfig += `\n[authentication]\nadmin_api_key = "${TEST_ADMIN_HASH}"\n`;
        }
        fs.writeFileSync(mooseConfigPath, mooseConfig);

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
        console.log("Server started with latest CLI, infrastructure is ready");
        // Brief wait to ensure everything is fully settled
        await setTimeoutAsync(5000);

        // Keep the server running so the new CLI can query its state
        console.log("Keeping dev server running for moose plan test...");
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

        // Run moose plan with NEW CLI (querying the running server)
        // Use the same admin token that was configured for the old dev server
        try {
          const TEST_ADMIN_TOKEN =
            "deadbeefdeadbeefdeadbeefdeadbeef.0123456789abcdef0123456789abcdef";

          const { stdout } = await execAsync(
            `"${CLI_PATH}" plan --url "http://localhost:4000" --token "${TEST_ADMIN_TOKEN}"`,
            {
              cwd: TEST_PROJECT_DIR,
              env:
                config.language === "python" ?
                  {
                    ...process.env,
                    VIRTUAL_ENV: path.join(TEST_PROJECT_DIR, ".venv"),
                    PATH: `${path.join(TEST_PROJECT_DIR, ".venv", "bin")}:${process.env.PATH}`,
                    TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
                    TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
                  }
                : {
                    ...process.env,
                    TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
                    TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
                  },
            },
          );

          // Strip ANSI color codes from the output for reliable parsing
          const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");
          const cleanOutput = stripAnsi(stdout);

          // The plan output uses the format:
          // "- <Type>: Name" for removals (red)
          // "+ <Type>: Name" for additions (green)
          // "~ <Type>: Name" for updates (yellow)
          // Where <Type> can be: Table, View, Topic, SQL Resource, Function, etc.

          // Check for any infrastructure being removed (- prefix)
          // This is a BREAKING CHANGE as existing infrastructure is being deleted
          const removedItems = cleanOutput.match(
            /^\s*-\s+(\w+(?:\s+\w+)*?):/gm,
          );
          if (removedItems) {
            throw new Error(
              `BREAKING CHANGE DETECTED: Infrastructure is being removed from the plan.\n` +
                `This means the new CLI does not recognize infrastructure created by CLI latest.\n` +
                `This is a backward incompatible change that would cause data loss.\n\n` +
                `Removed items:\n${removedItems.join("\n")}\n\n` +
                `Full plan output:\n${cleanOutput}`,
            );
          }

          // Check for any infrastructure being added (+ prefix)
          // This could mean the new CLI doesn't recognize existing infrastructure and wants to recreate it
          const addedItems = cleanOutput.match(/^\s*\+\s+(\w+(?:\s+\w+)*?):/gm);
          if (addedItems) {
            throw new Error(
              `BREAKING CHANGE DETECTED: Infrastructure is being added in the plan.\n` +
                `This likely means the new CLI does not recognize existing infrastructure from CLI latest\n` +
                `and wants to create it again, which is a backward incompatible change.\n\n` +
                `Added items:\n${addedItems.join("\n")}\n\n` +
                `Full plan output:\n${cleanOutput}`,
            );
          }

          // Check for "no changes" message
          const output = cleanOutput.toLowerCase();
          const hasNoChanges = output.includes("no changes detected");

          if (!hasNoChanges) {
            // If there are changes, they should only be updates (~ prefix), not additions/removals
            // Check if there are any updates
            const updatedItems = cleanOutput.match(
              /^\s*~\s+(\w+(?:\s+\w+)*?):/gm,
            );
            if (updatedItems) {
              console.warn(
                `Plan shows infrastructure updates (~ prefix). These may be acceptable if they're metadata-only changes.`,
              );
              console.log(`Updated items:\n${updatedItems.join("\n")}`);
              console.log(
                "⚠️  Infrastructure updates detected - review the changes to ensure they are backward compatible.",
              );
            } else {
              console.warn(`Plan output shows some changes:\n${cleanOutput}`);
            }
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
