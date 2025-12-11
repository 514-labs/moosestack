/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Test for Docker build with lockfile verification.
 *
 * This test ensures that `moose build --docker` respects the pnpm-lock.yaml
 * file and installs the exact version specified in the lockfile, not a newer
 * version from the registry.
 */

import { spawn } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { TIMEOUTS, TEMPLATE_NAMES } from "./constants";
import { createTempTestDirectory, removeTestProject } from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const APP_NAME = "moose-lockfile-test";
const PINNED_VERSION = "0.6.271"; // Stable published version for testing
// Docker image name used by moose build --docker (architecture-specific)
const DOCKER_IMAGE_AMD64 =
  "moose-df-deployment-x86_64-unknown-linux-gnu:latest";
const DOCKER_IMAGE_ARM64 =
  "moose-df-deployment-aarch64-unknown-linux-gnu:latest";
// Determine which image to use based on platform
const DOCKER_IMAGE =
  process.arch === "arm64" ? DOCKER_IMAGE_ARM64 : DOCKER_IMAGE_AMD64;

describe("Docker Build Lockfile Verification", () => {
  let TEST_PROJECT_DIR: string;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    // Create temporary directory
    TEST_PROJECT_DIR = createTempTestDirectory("docker-lockfile-test");
    console.log(`Created test directory: ${TEST_PROJECT_DIR}`);

    // Initialize project with moose init
    console.log("Initializing TypeScript project...");
    await execAsync(
      `"${CLI_PATH}" init ${APP_NAME} ${TEMPLATE_NAMES.TYPESCRIPT_DEFAULT} --location "${TEST_PROJECT_DIR}"`,
    );

    // Modify package.json to pin specific version (NOT local file: protocol)
    console.log(`Pinning @514labs/moose-lib to version ${PINNED_VERSION}...`);
    const packageJsonPath = path.join(TEST_PROJECT_DIR, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    packageJson.dependencies["@514labs/moose-lib"] = PINNED_VERSION;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Install with pnpm to generate real lockfile
    console.log("Installing dependencies with pnpm...");
    await new Promise<void>((resolve, reject) => {
      const pnpmInstall = spawn("pnpm", ["install"], {
        cwd: TEST_PROJECT_DIR,
        stdio: "inherit",
      });
      pnpmInstall.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pnpm install failed with code ${code}`));
        }
      });
    });

    // Verify lockfile was created with correct version
    const lockfilePath = path.join(TEST_PROJECT_DIR, "pnpm-lock.yaml");
    expect(fs.existsSync(lockfilePath), "pnpm-lock.yaml must exist").to.be.true;

    const lockfileContent = fs.readFileSync(lockfilePath, "utf-8");
    expect(lockfileContent).to.include(
      `@514labs/moose-lib@${PINNED_VERSION}`,
      "Lockfile must reference pinned version",
    );

    console.log("Setup complete - lockfile generated with pinned version");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);

    // Cleanup Docker resources
    try {
      console.log("Cleaning up Docker image...");
      await execAsync(`docker rmi -f ${DOCKER_IMAGE} || true`);
    } catch (error) {
      console.warn("Docker cleanup warning:", error);
    }

    // Cleanup test directory
    removeTestProject(TEST_PROJECT_DIR);
  });

  it("should build Docker image and respect lockfile version", async function () {
    this.timeout(TIMEOUTS.DOCKER_BUILD_MS);

    // Step 1: Build Docker image
    console.log("Running moose build --docker...");
    await new Promise<void>((resolve, reject) => {
      const buildProcess = spawn(CLI_PATH, ["build", "--docker"], {
        cwd: TEST_PROJECT_DIR,
        stdio: "inherit", // Stream output directly to console
      });

      buildProcess.on("exit", (code, signal) => {
        console.log(`Process exited with code ${code}, signal ${signal}`);
      });

      buildProcess.on("close", (code, signal) => {
        console.log(`Process closed with code ${code}, signal ${signal}`);

        // Check if Docker image was created even if exit code is non-zero
        // (Docker buildx sometimes reports success via image creation, not exit code)
        const checkImage = spawn("docker", [
          "images",
          "--format",
          "{{.Repository}}:{{.Tag}}",
          "--filter",
          `reference=${DOCKER_IMAGE}`,
        ]);

        let imageOutput = "";
        checkImage.stdout?.on("data", (data) => {
          imageOutput += data.toString();
        });

        checkImage.on("close", () => {
          if (imageOutput.trim().includes(DOCKER_IMAGE)) {
            console.log("Build completed successfully (image created)");
            resolve();
          } else if (code === 0) {
            console.log("Build completed successfully (exit code 0)");
            resolve();
          } else {
            reject(
              new Error(
                `Docker build failed with code ${code}, signal ${signal}`,
              ),
            );
          }
        });
      });

      buildProcess.on("error", (error) => {
        reject(error);
      });
    });

    // Verify image exists
    const { stdout: imagesOutput } = await execAsync(
      `docker images --format "{{.Repository}}:{{.Tag}}" | grep "moose-df-deployment"`,
    );
    console.log(`Docker images found: ${imagesOutput}`);
    expect(imagesOutput.trim()).to.include(
      DOCKER_IMAGE,
      "Docker image should be created",
    );

    // Step 2: Verify exact lockfile version via npm list
    console.log("Checking version via npm list...");
    const { stdout: npmListOutput } = await execAsync(
      `docker run --rm ${DOCKER_IMAGE} npm list @514labs/moose-lib --depth=0 --json`,
    );
    const npmListData = JSON.parse(npmListOutput);
    const resolvedVersion =
      npmListData.dependencies["@514labs/moose-lib"].version;
    console.log(`Version resolved by npm list: ${resolvedVersion}`);
    expect(resolvedVersion).to.equal(
      PINNED_VERSION,
      "Container must have exact lockfile version",
    );

    // Step 3: Verify actual package.json in node_modules
    console.log("Checking actual installed package...");
    const { stdout: installedPkgJson } = await execAsync(
      `docker run --rm ${DOCKER_IMAGE} cat /application/node_modules/@514labs/moose-lib/package.json`,
    );
    const actualPackage = JSON.parse(installedPkgJson);
    console.log(
      `Actual package version in node_modules: ${actualPackage.version}`,
    );
    expect(actualPackage.version).to.equal(
      PINNED_VERSION,
      "Installed package version must match lockfile",
    );

    // Step 4: Verify lockfile was copied to image
    console.log("Checking Docker image build history...");
    const { stdout: historyOutput } = await execAsync(
      `docker history ${DOCKER_IMAGE} --no-trunc --format="{{.CreatedBy}}"`,
    );
    expect(historyOutput).to.include(
      "pnpm-lock.yaml",
      "Docker build should copy pnpm-lock.yaml",
    );

    // Step 5: Verify lockfile exists in container
    const { stdout: lockfileCheck } = await execAsync(
      `docker run --rm ${DOCKER_IMAGE} test -f /application/pnpm-lock.yaml && echo "exists" || echo "missing"`,
    );
    expect(lockfileCheck.trim()).to.equal(
      "exists",
      "pnpm-lock.yaml must exist in container",
    );
  });
});
