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
  TEST_ADMIN_BEARER_TOKEN,
  TEST_ADMIN_API_KEY_HASH,
} from "./constants";

import {
  stopDevProcess,
  waitForServerStart,
  cleanupDocker,
  removeTestProject,
  createTempTestDirectory,
  logger,
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

// Path to npm-installed CLI (will be set by checkLatestPublishedCLI)
let LATEST_CLI_PATH: string;
let CLI_INSTALL_DIR: string;
let LATEST_MATCHING_NPM_VERSION: string;

const testLogger = logger.scope("backward-compatibility-test");
const NPM_PROPAGATION_MAX_ATTEMPTS = 5;
const NPM_PROPAGATION_RETRY_DELAY_MS = 15_000;
const LEGACY_TEMPORAL_DYNAMIC_CONFIG = `limit.maxIDLength:
  - value: 255
    constraints: {}
system.forceSearchAttributesCacheRefreshOnRead:
  - value: true # Dev setup only. Please don't turn this on in production.
    constraints: {}
`;

function parseNpmVersions(stdout: string): string[] {
  const parsed = JSON.parse(stdout.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function compareStableVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);

  for (let i = 0; i < 3; i += 1) {
    const diff = aParts[i] - bParts[i];
    if (diff !== 0) return diff;
  }

  return 0;
}

async function getLatestMatchingNpmVersion(): Promise<string> {
  const [cliVersionsResult, libVersionsResult] = await Promise.all([
    execAsync("npm view @514labs/moose-cli versions --json"),
    execAsync("npm view @514labs/moose-lib versions --json"),
  ]);

  const cliVersions = new Set(
    parseNpmVersions(cliVersionsResult.stdout).filter(isStableVersion),
  );
  const matchingVersions = parseNpmVersions(libVersionsResult.stdout)
    .filter(isStableVersion)
    .filter((version) => cliVersions.has(version))
    .sort(compareStableVersions);

  const latestMatchingVersion = matchingVersions[matchingVersions.length - 1];
  if (!latestMatchingVersion) {
    throw new Error(
      "Cannot find a stable npm version published for both @514labs/moose-cli and @514labs/moose-lib",
    );
  }

  return latestMatchingVersion;
}

/**
 * Install and check the latest matching published version of moose-cli
 * Uses pnpm for consistency with the monorepo
 */
async function checkLatestPublishedCLI(): Promise<void> {
  testLogger.info("Installing latest matching published moose-cli from npm...");

  try {
    if (CLI_INSTALL_DIR) {
      fs.rmSync(CLI_INSTALL_DIR, { recursive: true, force: true });
    }

    // Create a temp directory for CLI install
    const os = require("os");
    CLI_INSTALL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "moose-cli-"));
    testLogger.info(`Installing CLI to temp directory: ${CLI_INSTALL_DIR}`);

    LATEST_MATCHING_NPM_VERSION = await getLatestMatchingNpmVersion();
    testLogger.info(
      `Latest stable version published for both CLI and lib: ${LATEST_MATCHING_NPM_VERSION}`,
    );

    // Install CLI using pnpm (consistent with monorepo)
    const installResult = await execAsync(
      `pnpm add @514labs/moose-cli@${LATEST_MATCHING_NPM_VERSION}`,
      { cwd: CLI_INSTALL_DIR },
    );
    testLogger.info("pnpm install output:", installResult.stdout);

    // Find the installed CLI binary in pnpm's structure
    LATEST_CLI_PATH = path.join(
      CLI_INSTALL_DIR,
      "node_modules",
      ".bin",
      "moose-cli",
    );

    // Verify it exists and works
    if (!fs.existsSync(LATEST_CLI_PATH)) {
      throw new Error(`CLI binary not found at ${LATEST_CLI_PATH}`);
    }

    const { stdout: version } = await execAsync(
      `"${LATEST_CLI_PATH}" --version`,
    );
    testLogger.info("Latest matching published CLI version:", version.trim());
  } catch (error: any) {
    testLogger.error("Failed to install latest CLI:", error.message);
    if (error.stdout) testLogger.error("stdout:", error.stdout);
    if (error.stderr) testLogger.error("stderr:", error.stderr);
    throw new Error(
      "Cannot install latest matching published CLI for backward compatibility test",
    );
  }
}

async function getCliVersion(cliPath: string): Promise<string> {
  const { stdout } = await execAsync(`"${cliPath}" --version`);
  return stdout.trim().replace(/^moose-cli\s+/, "");
}

async function getInstalledTypeScriptLibVersion(
  projectDir: string,
): Promise<string> {
  const runnerPath = path.join(
    projectDir,
    "node_modules",
    ".bin",
    "moose-runner",
  );
  const { stdout } = await execAsync(`"${runnerPath}" print-version`, {
    cwd: projectDir,
    env: {
      ...process.env,
      PATH: `${path.join(projectDir, "node_modules", ".bin")}:${process.env.PATH}`,
      NODE_NO_WARNINGS: "1",
    },
  });

  return stdout.trim();
}

function isNpmPropagationVersionMismatch(error: unknown): boolean {
  const details = [
    error instanceof Error ? error.message : "",
    typeof error === "string" ? error : "",
    typeof error === "object" && error && "stdout" in error ?
      String((error as { stdout?: unknown }).stdout ?? "")
    : "",
    typeof error === "object" && error && "stderr" in error ?
      String((error as { stderr?: unknown }).stderr ?? "")
    : "",
  ].join("\n");

  return (
    details.includes("Version mismatch: installed @514labs/moose-lib") ||
    details.includes(
      "installed @514labs/moose-lib does not support version checking",
    )
  );
}

async function verifyTypeScriptVersionsMatch(
  projectDir: string,
): Promise<void> {
  const [cliVersion, libVersion] = await Promise.all([
    getCliVersion(LATEST_CLI_PATH),
    getInstalledTypeScriptLibVersion(projectDir),
  ]);

  if (cliVersion !== libVersion) {
    throw new Error(
      `Version mismatch: installed @514labs/moose-lib is ${libVersion}, but the Moose CLI is ${cliVersion}.`,
    );
  }

  testLogger.info(
    `Verified matching published versions: moose-cli=${cliVersion}, @514labs/moose-lib=${libVersion}`,
  );
}

/**
 * Ensure generated TypeScript project uses the latest matching published Moose packages.
 */
function enforceLatestTypeScriptDependencies(projectDir: string): void {
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  const dependencies = (packageJson.dependencies ??= {});
  const devDependencies = (packageJson.devDependencies ??= {});

  // Enforce the latest coherent release pair for backward compatibility
  // initialization. A partially failed release can skew npm latest tags.
  dependencies["@514labs/moose-lib"] = LATEST_MATCHING_NPM_VERSION;
  devDependencies["@514labs/moose-cli"] = LATEST_MATCHING_NPM_VERSION;

  // Keep compatibility alias used across e2e tests.
  if (dependencies["@confluentinc/kafka-javascript"]) {
    dependencies["@514labs/kafka-javascript"] =
      dependencies["@confluentinc/kafka-javascript"];
    delete dependencies["@confluentinc/kafka-javascript"];
  }

  fs.writeFileSync(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

/**
 * Ensure generated Python project uses latest published Moose packages.
 */
function enforceLatestPythonRequirements(projectDir: string): void {
  const requirementsPath = path.join(projectDir, "requirements.txt");
  const lines = fs.readFileSync(requirementsPath, "utf-8").split(/\r?\n/);

  let hasMooseCli = false;
  let hasMooseLib = false;

  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower.startsWith("moose-cli")) {
      hasMooseCli = true;
      return "moose-cli";
    }

    if (lower.startsWith("moose-lib")) {
      hasMooseLib = true;
      return "moose-lib";
    }

    return line;
  });

  if (!hasMooseCli) {
    normalizedLines.push("moose-cli");
  }
  if (!hasMooseLib) {
    normalizedLines.push("moose-lib");
  }

  fs.writeFileSync(
    requirementsPath,
    `${normalizedLines.join("\n").trimEnd()}\n`,
  );
}

function ensureLegacyTemporalDynamicConfig(projectDir: string): void {
  const mooseInternalDir = path.join(projectDir, ".moose");
  const temporalConfigPath = path.join(
    mooseInternalDir,
    "temporal-dynamic-config.yaml",
  );

  if (fs.existsSync(temporalConfigPath)) {
    return;
  }

  fs.mkdirSync(mooseInternalDir, { recursive: true });
  fs.writeFileSync(temporalConfigPath, LEGACY_TEMPORAL_DYNAMIC_CONFIG);
}

function startLegacyTemporalConfigWriter(projectDir: string): () => void {
  const interval = global.setInterval(() => {
    try {
      ensureLegacyTemporalDynamicConfig(projectDir);
    } catch {
      // Ignore transient filesystem races while the legacy CLI recreates .moose.
    }
  }, 100);

  return () => global.clearInterval(interval);
}

/**
 * Setup TypeScript project with latest matching npm moose-lib
 */
async function setupTypeScriptProjectWithLatestNpm(
  projectDir: string,
  templateName: string,
  appName: string,
): Promise<void> {
  for (let attempt = 1; attempt <= NPM_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    testLogger.info(
      `Initializing TypeScript project with latest matching npm moose-cli (attempt ${attempt}/${NPM_PROPAGATION_MAX_ATTEMPTS})...`,
    );

    try {
      if (attempt > 1) {
        await checkLatestPublishedCLI();
      }

      fs.rmSync(projectDir, { recursive: true, force: true });

      // Use npm-installed CLI instead of npx for consistent registry behavior
      const result = await execAsync(
        `"${LATEST_CLI_PATH}" init ${appName} ${templateName} --location "${projectDir}"`,
      );
      testLogger.info("CLI init stdout:", result.stdout);
      if (result.stderr) {
        testLogger.info("CLI init stderr:", result.stderr);
      }

      testLogger.info(
        "Installing dependencies with pnpm (using latest matching @514labs/moose-lib)...",
      );

      enforceLatestTypeScriptDependencies(projectDir);

      await new Promise<void>((resolve, reject) => {
        const installCmd = spawn("pnpm", ["install"], {
          stdio: "inherit",
          cwd: projectDir,
        });
        installCmd.once("error", reject);
        installCmd.on("close", (code) => {
          testLogger.info(`pnpm install exited with code ${code}`);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`pnpm install failed with code ${code}`));
          }
        });
      });

      await verifyTypeScriptVersionsMatch(projectDir);
      return;
    } catch (error: any) {
      testLogger.error(
        "TypeScript backward-compat setup failed:",
        error.message,
      );
      if (error.stdout) testLogger.error("stdout:", error.stdout);
      if (error.stderr) testLogger.error("stderr:", error.stderr);

      if (
        attempt < NPM_PROPAGATION_MAX_ATTEMPTS &&
        isNpmPropagationVersionMismatch(error)
      ) {
        testLogger.warn(
          `Detected npm propagation version mismatch. Retrying in ${NPM_PROPAGATION_RETRY_DELAY_MS / 1000}s...`,
        );
        await setTimeoutAsync(NPM_PROPAGATION_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }
}

/**
 * Setup Python project with latest pypi moose-lib
 */
async function setupPythonProjectWithLatestPypi(
  projectDir: string,
  templateName: string,
  appName: string,
): Promise<void> {
  testLogger.info(`Initializing Python project with latest pypi moose-cli...`);

  // Initialize project with latest CLI (npm-installed, not npx)
  try {
    const result = await execAsync(
      `"${LATEST_CLI_PATH}" init ${appName} ${templateName} --location "${projectDir}"`,
    );
    testLogger.info("CLI init stdout:", result.stdout);
    if (result.stderr) {
      testLogger.info("CLI init stderr:", result.stderr);
    }
  } catch (error: any) {
    testLogger.error("CLI init failed:", error.message);
    if (error.stdout) testLogger.error("stdout:", error.stdout);
    if (error.stderr) testLogger.error("stderr:", error.stderr);
    throw error;
  }

  // Set up Python environment and install dependencies with latest moose-lib from pypi
  testLogger.info(
    "Setting up Python virtual environment and installing dependencies (using latest moose-lib)...",
  );
  enforceLatestPythonRequirements(projectDir);
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

    // Check latest matching published CLI is available
    await checkLatestPublishedCLI();

    // Verify new CLI is built
    try {
      await fs.promises.access(CLI_PATH, fs.constants.F_OK);
    } catch (err) {
      testLogger.error(
        `CLI not found at ${CLI_PATH}. It should be built in the pretest step.`,
      );
      throw err;
    }
  });

  after(function () {
    // Clean up temporary CLI install directory
    if (CLI_INSTALL_DIR) {
      try {
        testLogger.info(
          `Cleaning up temporary CLI install directory: ${CLI_INSTALL_DIR}`,
        );
        fs.rmSync(CLI_INSTALL_DIR, { recursive: true, force: true });
      } catch (error) {
        testLogger.error(`Failed to clean up CLI install directory: ${error}`);
      }
    }
  });

  for (const config of BACKWARD_COMPAT_CONFIGS) {
    describe(`${config.displayName} - Upgrade from n-1 to n`, function () {
      let devProcess: ChildProcess | null = null;
      let TEST_PROJECT_DIR: string;

      before(async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS * 2); // Double timeout for setup
        let stopTemporalConfigWriter = () => {};

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

        // Configure admin API key in moose.config.toml
        testLogger.info("Configuring admin API key in moose.config.toml...");
        const mooseConfigPath = path.join(
          TEST_PROJECT_DIR,
          "moose.config.toml",
        );
        let mooseConfig = fs.readFileSync(mooseConfigPath, "utf-8");
        // Check if [authentication] section exists
        if (!mooseConfig.includes("[authentication]")) {
          // Append the [authentication] section if it doesn't exist
          mooseConfig += `\n[authentication]\nadmin_api_key = "${TEST_ADMIN_API_KEY_HASH}"\n`;
        } else if (!mooseConfig.includes("admin_api_key =")) {
          // Replace the empty [authentication] section with one that includes admin_api_key
          mooseConfig = mooseConfig.replace(
            /\[authentication\]\s*$/m,
            `[authentication]\nadmin_api_key = "${TEST_ADMIN_API_KEY_HASH}"`,
          );
        }
        fs.writeFileSync(mooseConfigPath, mooseConfig);

        // Older published CLIs mount this file into the Temporal container in
        // Docker mode. Precreate it so backward-compat startup exercises the
        // old runtime path instead of failing on a missing bind source.
        ensureLegacyTemporalDynamicConfig(TEST_PROJECT_DIR);

        // Start dev server with LATEST published CLI (npm-installed)
        testLogger.info(
          "Starting dev server with LATEST published CLI (npm-installed)...",
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
              MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
              MOOSE_FEATURES__WORKFLOWS: "false",
            }
          : {
              ...process.env,
              // Add test credentials for S3Queue tests
              TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
              TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
              MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
              MOOSE_FEATURES__WORKFLOWS: "false",
            };

        stopTemporalConfigWriter =
          startLegacyTemporalConfigWriter(TEST_PROJECT_DIR);
        devProcess = spawn(LATEST_CLI_PATH, ["dev"], {
          stdio: "pipe",
          cwd: TEST_PROJECT_DIR,
          env: devEnv,
        });

        try {
          await waitForServerStart(
            devProcess,
            TIMEOUTS.SERVER_STARTUP_MS,
            SERVER_CONFIG.startupMessage,
            SERVER_CONFIG.url,
          );
          testLogger.info(
            "Server started with latest CLI, infrastructure is ready",
          );
          // Brief wait to ensure everything is fully settled
          await setTimeoutAsync(5000);

          // Keep the server running so the new CLI can query its state
          testLogger.info("Keeping dev server running for moose plan test...");
        } finally {
          stopTemporalConfigWriter();
        }
      });

      after(async function () {
        this.timeout(TIMEOUTS.CLEANUP_MS);
        try {
          testLogger.info(`Starting cleanup for ${config.displayName} test...`);
          if (devProcess) {
            await stopDevProcess(devProcess);
          }
          await cleanupDocker(TEST_PROJECT_DIR, config.appName);
          removeTestProject(TEST_PROJECT_DIR);
          testLogger.info(`Cleanup completed for ${config.displayName} test`);
        } catch (error) {
          testLogger.error("Error during cleanup:", error);
          // Force cleanup even if some steps fail
          try {
            if (devProcess && !devProcess.killed) {
              devProcess.kill("SIGKILL");
            }
          } catch (killError) {
            testLogger.error("Error killing process:", killError);
          }
          removeTestProject(TEST_PROJECT_DIR);
        }
      });

      it("should show no changes when running moose plan with new CLI", async function () {
        this.timeout(TIMEOUTS.TEST_SETUP_MS);

        // Run moose plan with NEW CLI (querying the running server)
        // Use the same admin token that was configured for the old dev server
        try {
          const { stdout } = await execAsync(
            `"${CLI_PATH}" plan --url "http://localhost:4000" --token "${TEST_ADMIN_BEARER_TOKEN}"`,
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
              testLogger.warn(
                `Plan shows infrastructure updates (~ prefix). These may be acceptable if they're metadata-only changes.`,
              );
              testLogger.info(`Updated items:\n${updatedItems.join("\n")}`);
              testLogger.info(
                "⚠️  Infrastructure updates detected - review the changes to ensure they are backward compatible.",
              );
            } else {
              testLogger.warn(
                `Plan output shows some changes:\n${cleanOutput}`,
              );
            }
          } else {
            testLogger.info(
              "✅ No changes detected - backward compatibility verified!",
            );
          }
        } catch (error: any) {
          testLogger.error("moose plan failed:", error.message);
          if (error.stdout) testLogger.error("stdout:", error.stdout);
          if (error.stderr) testLogger.error("stderr:", error.stderr);
          throw error;
        }
      });
    });
  }
});
