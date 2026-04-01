/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

import { ChildProcess, spawn } from "child_process";
import { expect } from "chai";
import * as fs from "fs";
import { createRequire } from "module";
import { AddressInfo, createServer } from "net";
import * as path from "path";
import { promisify } from "util";
import { SignJWT, importPKCS8 } from "jose";

import { SERVER_CONFIG, TIMEOUTS } from "./constants";
import {
  cleanupClickhouseData,
  cleanupTestSuite,
  createTempTestDirectory,
  logger,
  performGlobalCleanup,
  setupTypeScriptProject,
  waitForDBWrite,
  waitForInfrastructureReady,
  waitForServerStart,
  waitForStreamingFunctions,
  withRetries,
} from "./utils";

const execAsync = promisify(require("child_process").exec);

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const TEST_SUITE = "typescript-agent";
const APP_NAME = "moose-ts-agent-app";
let webAppUrl = "http://localhost:3000";
const DASHBOARD_SNAPSHOT_PATH = "/app/dashboard/snapshot";
const JWT_ISSUER = "typescript-agent-local";
const JWT_AUDIENCE = "typescript-agent";

const TEST_RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCz1giCZPtooM/5
5jY5iQQZDzdwyIWx9zllksKLlN4MajxN4WvLMEz61+HaXjBC+XOfHif8zEn3288+
Ou67joV/g1y0zG9p34majIv1yNp4FiMLAK6CHmWeQalrNzm7JGi2nMoRh+X/NqY5
npN5ERrxT2qc/VFCvhOYKJANuuMP2+qc7Z23v4k6qVLwcS/4ySeB1Zm54qvD8mao
vacjsQ51iPfJQsyKhe7HKSuT0M+hgDvyyvJMWohijX/2ySTM2edTjXqlL4u3hpor
gRE96KFXzWv6HaenuPV6UAk3VlN0kmr5+eYa+1ZaCIfZfcmZfT8AcYWCGsJ7vQbT
lNV7mVmBAgMBAAECggEAGUOtaFw1cap97VapMYYNPFQF7uNM3QalWp62lBNy6n2W
QT60/ROpDOh9Q0dOMmqHEsiSx5IPpjGMOOrglRrdqF9VC9VYpaAQ3dR26S2xe4No
ougSnBcXIZeJ7JUSmDbyOw1l2fakmikcSyX7A9wiU9pbWPjBjMXVTOAN9M/XjGeV
IW0GmrfySYGOXp5KQT6gOGvePlyPtNfK1bwcI0eRkXt7t1sGM67OO8ZQR7pKb52M
g6kcihUxID/6I8bBDaEGKFK6FVoe2tiq1qFjLFSuOBJN6BlQ8BFrLbBq/9w7rEHY
wOlXB/iTDKna3iuQ/Cqw+/iEaGVErIdtptwrUewq0QKBgQDyDHMzMSkY4lg7OPbc
ndGowGv9xzkSm5lK7S5aK8auKiDJpvSf2PbmH6vLpCmIninYOTm9+PrlTHtawoDw
6gH3DC/IScFwpZzyGbt9jJ2BStld4cJ3mwsaNCQCjeLUVvA2a4dEfOJMF/wZ45QD
zJ5LWpMZxj1nz9p1cJHXE063HQKBgQC+M5r5j7hcVzV8XZ8rsM3NeE+X043f9yzS
89am0rh/kt07w02aXUgiMNvTmn+02Fn5CBIoebI9XQ3TIYREHRCcaNGMbdTPuDMR
/3hI4Jf9lFIs5EyWzk2BbvH6XUl37a73q5zQIGcWg2usqPcA5Kcy26EvEN+Tnx6m
O4GATznKtQKBgQDppXb2bXf8W1FMKZqyL22Y9dXIrSy8d5KrrvPVevhYWrY3sX/l
ZSw/y0asVpT5GaPO4r6IUPTvrrpMTADnjRvEe/EL55ZgxJ0RXiGL+dZ4XeYhJ7Hu
fq1i5/3ysT/KNPm/rmBujhZr2aMy4mmYmUYb+xyP/rp7oTqBrt44vJx5SQKBgHhR
yO2qXyP6/xjHWNOYqvgZ7a/L4moVwMNKATXTA2egjlcp+0N1UxZd9hHsIHFUk8YX
tvTn1zs+TGqNP1CfWky3eiftqrwkeBoglAT2HvAJDdrcKR8VLq58cpLAxKMbNp3y
b+axOMVjKZA16tsjyilACrztXaHS/N6Hsipq89IpAoGAKND+C3aMOtlGkXRkL6wU
H2a1XmfPmZSsTStvoDvsEyLQz5LVQfqvobQSaAT5SLpjG8HpcznyBBJPbKkhURBm
23M4LQaz76TSdINCALfq3sYUG4Cn5er9R4EGT+SepSY7qEHbDB7g94XOW96LWf2w
DtgtOtWLI162YXWv/oHbs7M=
-----END PRIVATE KEY-----`;

const testLogger = logger.scope(TEST_SUITE);

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const header = response.headers.get("set-cookie");
  if (!header) {
    return [];
  }

  return header.split(/,(?=[^;,\s]+=)/g);
}

function updateCookieJar(jar: Map<string, string>, response: Response) {
  for (const cookie of getSetCookies(response)) {
    const [nameValue, ...attributes] = cookie.split(";");
    const separatorIndex = nameValue.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const name = nameValue.slice(0, separatorIndex).trim();
    const value = nameValue.slice(separatorIndex + 1).trim();
    const shouldDelete = attributes.some((attribute) => {
      const [rawKey, rawAttributeValue = ""] = attribute.split("=");
      const key = rawKey.trim().toLowerCase();
      const attributeValue = rawAttributeValue.trim();

      if (key === "max-age" && attributeValue === "0") {
        return true;
      }

      if (key === "expires") {
        const expiresAt = Date.parse(attributeValue);
        return Number.isFinite(expiresAt) && expiresAt <= Date.now();
      }

      return false;
    });

    if (shouldDelete) {
      jar.delete(name);
      continue;
    }

    jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function signOrgJwt(
  claims: Record<string, string>,
  expirationTime: string | number = "1h",
): Promise<string> {
  const privateKey = await importPKCS8(TEST_RSA_PRIVATE_KEY, "RS256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(`local-${claims.org_id ?? "missing-org"}`)
    .setExpirationTime(expirationTime)
    .sign(privateKey);
}

function getSessionCookieName(jar: Map<string, string>): string {
  const sessionCookieName = Array.from(jar.keys()).find((name) => {
    return name.includes("session-token");
  });

  if (!sessionCookieName) {
    throw new Error("Expected auth session cookie to be present after sign-in");
  }

  return sessionCookieName.replace(/\.\d+$/, "");
}

function replaceSessionCookie(
  jar: Map<string, string>,
  sessionCookieName: string,
  value: string,
) {
  for (const cookieName of Array.from(jar.keys())) {
    if (
      cookieName === sessionCookieName ||
      cookieName.startsWith(`${sessionCookieName}.`)
    ) {
      jar.delete(cookieName);
    }
  }

  jar.set(sessionCookieName, value);
}

function readEnvValue(filePath: string, variableName: string): string {
  const contents = fs.readFileSync(filePath, "utf8");
  const line = contents
    .split("\n")
    .find((entry) => entry.startsWith(`${variableName}=`));

  if (!line) {
    throw new Error(`Missing ${variableName} in ${filePath}`);
  }

  return line
    .slice(variableName.length + 1)
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

function replaceEnvValue(
  filePath: string,
  variableName: string,
  nextValue?: string,
) {
  const contents = fs.readFileSync(filePath, "utf8");
  const linePattern = new RegExp(`^${variableName}=.*(?:\\r?\\n)?`, "m");

  let nextContents = contents;
  if (linePattern.test(nextContents)) {
    nextContents = nextContents.replace(linePattern, "");
  }

  nextContents = nextContents.replace(/\n{3,}/g, "\n\n").trimEnd();

  if (nextValue !== undefined) {
    nextContents = `${nextContents}\n${variableName}=${nextValue}\n`;
  } else {
    nextContents = `${nextContents}\n`;
  }

  fs.writeFileSync(filePath, nextContents, "utf8");
}

async function encodeSessionCookie(
  projectDir: string,
  sessionCookieName: string,
  token: Record<string, unknown>,
): Promise<string> {
  const authSecret = readEnvValue(
    path.join(projectDir, "packages", "web-app", ".env.local"),
    "AUTH_SECRET",
  );
  const requireFromProject = createRequire(
    path.join(projectDir, "packages", "web-app", "package.json"),
  );
  const { encode } = requireFromProject("next-auth/jwt") as {
    encode: (params: {
      token: Record<string, unknown>;
      secret: string;
      salt: string;
    }) => Promise<string>;
  };

  return await encode({
    token,
    secret: authSecret,
    salt: sessionCookieName,
  });
}

async function reserveWebAppPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to reserve a web app port"));
        });
        return;
      }

      const { port } = address as AddressInfo;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function updatePackageName(filePath: string, nextName: string): void {
  const packageJson = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
    name?: string;
  };

  packageJson.name = nextName;
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
}

function createUniqueServicePackageName(projectDir: string): string {
  const suffix = path
    .basename(projectDir)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(-12);

  return `moosestack-service-${suffix}`;
}

async function waitForWebAppReady() {
  await withRetries(
    async () => {
      const response = await fetch(`${webAppUrl}/api/chat/status`);
      if (!response.ok) {
        throw new Error(`Web app not ready yet: ${response.status}`);
      }
    },
    {
      attempts: 60,
      delayMs: 1000,
      backoffFactor: 1,
      logger: testLogger,
      operationName: "web app readiness check",
    },
  );
}

async function stopChildProcess(
  child: ChildProcess | null,
  label: string,
): Promise<void> {
  if (!child || child.killed) {
    return;
  }

  testLogger.info(`Stopping ${label}`);
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });

  child.kill("SIGINT");
  await Promise.race([
    exitPromise,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
        resolve();
      }, TIMEOUTS.PROCESS_TERMINATION_MS);
    }),
  ]);
}

async function callMcp(
  token: string | undefined,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${SERVER_CONFIG.url}/tools`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return response;
}

async function callMcpTool<T>(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await callMcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });

  expect(response.status).to.equal(200);
  const payload = await response.json();
  const textContent = payload.result?.content?.find(
    (item: { type?: string; text?: string }) => item.type === "text",
  )?.text;

  if (!textContent) {
    throw new Error(`MCP tool ${name} did not return text content`);
  }

  return JSON.parse(textContent) as T;
}

async function callMcpToolText(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const response = await callMcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });

  expect(response.status).to.equal(200);
  const payload = await response.json();
  const textContent = payload.result?.content?.find(
    (item: { type?: string; text?: string }) => item.type === "text",
  )?.text;

  if (!textContent) {
    throw new Error(`MCP tool ${name} did not return text content`);
  }

  return {
    isError: payload.result?.isError === true,
    text: textContent,
  };
}

function getLocalPasswordEnvVar(email: string) {
  switch (email) {
    case "user1@orgA.com":
      return "LOCAL_MOCK_PASSWORD_ORG_A_USER";
    case "user2@orgB.com":
      return "LOCAL_MOCK_PASSWORD_ORG_B_USER";
    case "admin@template.com":
      return "LOCAL_MOCK_PASSWORD_ADMIN";
    default:
      throw new Error(`No mock password env var is defined for ${email}`);
  }
}

async function signInLocalAccess(projectDir: string, email: string) {
  const jar = new Map<string, string>();

  const csrfResponse = await fetch(`${webAppUrl}/api/auth/csrf`, {
    redirect: "manual",
  });
  expect(csrfResponse.status).to.equal(200);
  updateCookieJar(jar, csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const callbackResponse = await fetch(
    `${webAppUrl}/api/auth/callback/local-access`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(jar),
      },
      body: new URLSearchParams({
        csrfToken,
        email,
        password: readEnvValue(
          path.join(projectDir, "packages", "web-app", ".env.local"),
          getLocalPasswordEnvVar(email),
        ),
        callbackUrl: `${webAppUrl}/`,
        json: "true",
      }),
    },
  );

  expect([200, 302]).to.include(callbackResponse.status);
  updateCookieJar(jar, callbackResponse);

  const sessionResponse = await fetch(`${webAppUrl}/api/auth/session`, {
    headers: {
      Cookie: cookieHeader(jar),
    },
  });
  expect(sessionResponse.status).to.equal(200);
  const session = await sessionResponse.json();

  return {
    cookie: cookieHeader(jar),
    cookieJar: jar,
    session,
    sessionCookieName: getSessionCookieName(jar),
  };
}

describe("TypeScript Agent Template E2E", function () {
  this.timeout(TIMEOUTS.TEST_SETUP_MS);

  let projectDir: string;
  let serviceDir: string;
  let serviceProjectName = "moosestack-service";
  let serviceEnvPath: string;
  let webAppEnvPath: string;
  let webAppPort: number;
  let initOutput = "";
  let webProcess: ChildProcess | null = null;
  let mooseProcess: ChildProcess | null = null;

  before(async function () {
    this.timeout(TIMEOUTS.GLOBAL_CLEANUP_MS);
    await performGlobalCleanup(
      "Running global cleanup before TypeScript Agent Template E2E",
    );
  });

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);

    projectDir = createTempTestDirectory(TEST_SUITE);
    serviceDir = path.join(projectDir, "packages", "moosestack-service");
    serviceEnvPath = path.join(serviceDir, ".env.local");
    webAppEnvPath = path.join(projectDir, "packages", "web-app", ".env.local");
    webAppPort = await reserveWebAppPort();
    webAppUrl = `http://127.0.0.1:${webAppPort}`;

    await setupTypeScriptProject(
      projectDir,
      "typescript-agent",
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAME,
      "pnpm",
      {
        logger: testLogger,
        onInitComplete: ({ stdout }) => {
          initOutput = stdout;
        },
      },
    );

    testLogger.info("Preparing local env files with root pnpm env:prepare");
    await execAsync("pnpm env:prepare", {
      cwd: projectDir,
    });

    expect(fs.existsSync(serviceEnvPath)).to.equal(true);
    expect(fs.existsSync(webAppEnvPath)).to.equal(true);
    expect(readEnvValue(webAppEnvPath, "AUTH_SECRET")).to.not.equal(
      "replace-me-with-a-random-secret",
    );

    replaceEnvValue(webAppEnvPath, "MOOSE_SERVICE_URL");
    replaceEnvValue(
      webAppEnvPath,
      "MCP_SERVER_URL",
      "http://localhost:4000/tools",
    );

    testLogger.info("Verifying generated app lint with root pnpm lint");
    await execAsync("pnpm lint", {
      cwd: projectDir,
    });

    testLogger.info(
      "Verifying dependency-ordered workspace build with root pnpm build",
    );
    await execAsync("pnpm build", {
      cwd: projectDir,
    });

    testLogger.info(
      "Verifying unit and integration test scaffolding with root pnpm test",
    );
    await execAsync("pnpm test", {
      cwd: projectDir,
    });

    serviceProjectName = createUniqueServicePackageName(projectDir);
    updatePackageName(
      path.join(serviceDir, "package.json"),
      serviceProjectName,
    );

    mooseProcess = spawn(CLI_PATH, ["dev"], {
      cwd: serviceDir,
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    mooseProcess.stdout?.on("data", (data) => {
      testLogger.debug("Moose stdout", { output: data.toString().trim() });
    });
    mooseProcess.stderr?.on("data", (data) => {
      testLogger.warn("Moose stderr", { output: data.toString().trim() });
    });

    await waitForServerStart(
      mooseProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
      { logger: testLogger },
    );
    await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
      logger: testLogger,
    });
    await waitForStreamingFunctions(TIMEOUTS.SERVER_STARTUP_MS, {
      logger: testLogger,
    });

    await cleanupClickhouseData({ logger: testLogger });
    const seedResult = await execAsync("pnpm seed", {
      cwd: serviceDir,
    });
    expect(seedResult.stdout).to.contain(
      "Inserted 4 records into tenant_knowledge",
    );
    expect(seedResult.stdout).to.contain("org_a: 2");
    expect(seedResult.stdout).to.contain("org_b: 2");

    await waitForDBWrite(
      mooseProcess,
      "tenant_knowledge",
      4,
      TIMEOUTS.SERVER_STARTUP_MS,
      undefined,
      undefined,
      { logger: testLogger },
    );

    webProcess = spawn("pnpm", ["--filter", "web-app", "dev"], {
      cwd: projectDir,
      env: {
        ...process.env,
        AI_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-anthropic-key",
        PORT: String(webAppPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    webProcess.stdout?.on("data", (data) => {
      testLogger.debug("Web stdout", { output: data.toString().trim() });
    });
    webProcess.stderr?.on("data", (data) => {
      testLogger.warn("Web stderr", { output: data.toString().trim() });
    });
    webProcess.on("error", (error) => {
      testLogger.error("Failed to spawn web process", error);
    });

    await waitForWebAppReady();
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);

    await stopChildProcess(webProcess, "web app");
    await cleanupTestSuite(mooseProcess, projectDir, serviceProjectName, {
      dockerProjectDir: serviceDir,
      logger: testLogger,
    });
  });

  it("should bootstrap local env files with pnpm env:prepare", async function () {
    expect(fs.existsSync(serviceEnvPath)).to.equal(true);
    expect(fs.existsSync(webAppEnvPath)).to.equal(true);
    expect(readEnvValue(webAppEnvPath, "AUTH_SECRET")).to.not.equal(
      "replace-me-with-a-random-secret",
    );
  });

  it("should print start instructions before seed instructions during init", function () {
    expect(initOutput).to.include("pnpm dev:start");
    expect(initOutput).to.include("pnpm seed");
    expect(initOutput.indexOf("pnpm dev:start")).to.be.lessThan(
      initOutput.indexOf("pnpm seed"),
    );
  });

  it("should prebuild the workspace before dev entrypoints", function () {
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackageJson.scripts?.predev).to.equal("pnpm build");
    expect(rootPackageJson.scripts?.["predev:start"]).to.equal("pnpm build");
  });

  it("should render the unauthenticated landing page and provider status", async function () {
    const pageResponse = await fetch(webAppUrl);
    expect(pageResponse.status).to.equal(200);

    const html = await pageResponse.text();
    expect(html).to.include("typescript-agent");
    expect(html).to.include("Sign in");
    expect(html).to.include("Mock accounts");
    expect(html).to.include("user1@orgA.com");
    expect(html).to.include("admin@template.com");

    const statusResponse = await fetch(`${webAppUrl}/api/chat/status`);
    expect(statusResponse.status).to.equal(200);

    const status = await statusResponse.json();
    expect(status.provider).to.equal("anthropic");
    expect(status.status).to.equal("ready");
    expect(status.guardrailsConfigured).to.equal(false);
    expect(status.mcpReady).to.equal(true);
    expect(status.mcpStatus).to.equal("ready");
  });

  it("should reject unauthenticated tool and chat requests", async function () {
    const toolsResponse = await callMcp(undefined, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(toolsResponse.status).to.equal(401);

    const dashboardResponse = await fetch(
      `${SERVER_CONFIG.url}${DASHBOARD_SNAPSHOT_PATH}`,
    );
    expect(dashboardResponse.status).to.equal(401);

    const chatResponse = await fetch(`${webAppUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [] }),
    });

    expect(chatResponse.status).to.equal(401);
  });

  it("should scope MCP tools to the caller organization", async function () {
    const orgAAuth = await signInLocalAccess(projectDir, "user1@orgA.com");
    const orgBAuth = await signInLocalAccess(projectDir, "user2@orgB.com");
    const orgAToken = orgAAuth.session.idToken;
    const orgBToken = orgBAuth.session.idToken;

    expect(orgAToken).to.be.a("string");
    expect(orgBToken).to.be.a("string");

    const listResponse = await callMcp(orgAToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(listResponse.status).to.equal(200);
    const listPayload = await listResponse.json();
    const toolNames = listPayload.result.tools.map((tool: { name: string }) => {
      return tool.name;
    });

    expect(toolNames).to.include("query_tenant_knowledge_metrics");
    expect(toolNames).to.include("list_tenant_knowledge_records");
    expect(toolNames).to.include("get_data_catalog");
    expect(toolNames).to.not.include("query_clickhouse");

    const orgAMetrics = await callMcpTool<{
      rows: Array<{ totalRecords: number; highPriorityRecords: number }>;
      rowCount: number;
    }>(orgAToken, "query_tenant_knowledge_metrics", {
      metrics: ["totalRecords", "highPriorityRecords"],
      limit: 10,
    });

    expect(orgAMetrics.rowCount).to.equal(1);
    expect(orgAMetrics.rows[0]?.totalRecords).to.equal(2);
    expect(orgAMetrics.rows[0]?.highPriorityRecords).to.equal(1);

    const orgARecords = await callMcpTool<{
      rows: Array<{ headline: string; priority: string }>;
      rowCount: number;
    }>(orgAToken, "list_tenant_knowledge_records", {
      columns: ["headline", "priority"],
      limit: 10,
    });

    expect(orgARecords.rowCount).to.equal(2);
    expect(orgARecords.rows.map((row) => row.headline).join(" ")).to.include(
      "Brake alerts increased by 14% this week",
    );
    expect(
      orgARecords.rows.some((row) =>
        row.headline.includes("Seattle hub utilization breached 92%"),
      ),
    ).to.equal(false);

    const orgAHighPriorityRecords = await callMcpTool<{
      rows: Array<{ headline: string; priority: string }>;
      rowCount: number;
    }>(orgAToken, "list_tenant_knowledge_records", {
      columns: ["headline", "priority"],
      priority_in: ["high"],
      limit: 10,
    });

    expect(orgAHighPriorityRecords.rowCount).to.equal(1);
    expect(orgAHighPriorityRecords.rows[0]?.headline).to.include(
      "Brake alerts",
    );

    const orgBRecords = await callMcpTool<{
      rows: Array<{ headline: string; priority: string }>;
      rowCount: number;
    }>(orgBToken, "list_tenant_knowledge_records", {
      columns: ["headline", "priority"],
      limit: 10,
    });

    expect(orgBRecords.rowCount).to.equal(2);
    expect(orgBRecords.rows.map((row) => row.headline).join(" ")).to.include(
      "Seattle hub utilization breached 92%",
    );
    expect(
      orgBRecords.rows.some((row) =>
        row.headline.includes("Brake alerts increased by 14% this week"),
      ),
    ).to.equal(false);

    const catalog = await callMcpTool<{
      tables?: Record<string, unknown>;
      materialized_views?: Record<string, unknown>;
    }>(orgAToken, "get_data_catalog", {
      format: "detailed",
      component_type: "tables",
    });

    expect(catalog.tables).to.have.property("tenant_knowledge");
    expect(Object.keys(catalog.tables ?? {})).to.deep.equal([
      "tenant_knowledge",
    ]);

    const filteredCatalog = await callMcpToolText(
      orgAToken,
      "get_data_catalog",
      {
        format: "summary",
        search: "system",
      },
    );
    expect(filteredCatalog.isError).to.equal(false);
    expect(filteredCatalog.text).to.include(
      "No data components found matching the specified filters.",
    );
  });

  it("should create local org sessions and render organization-scoped dashboards", async function () {
    const orgAAuth = await signInLocalAccess(projectDir, "user1@orgA.com");
    expect(orgAAuth.session.user.orgId).to.equal("org_a");
    expect(orgAAuth.session.user.accessRole).to.equal("tenant");
    expect(orgAAuth.session.idToken).to.be.a("string");

    const orgASnapshotResponse = await fetch(
      `${SERVER_CONFIG.url}${DASHBOARD_SNAPSHOT_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${orgAAuth.session.idToken}`,
        },
      },
    );
    expect(orgASnapshotResponse.status).to.equal(200);
    const orgASnapshot = await orgASnapshotResponse.json();
    expect(orgASnapshot.knowledgeMetrics.totalRecords).to.equal(2);
    expect(
      orgASnapshot.recentKnowledge.map((row: { orgId: string }) => row.orgId),
    ).to.deep.equal(["org_a", "org_a"]);
    expect(
      orgASnapshot.recentKnowledge.some((row: { headline: string }) =>
        row.headline.includes("Brake alerts increased by 14% this week"),
      ),
    ).to.equal(true);
    expect(
      orgASnapshot.recentKnowledge.some(
        (row: { orgId: string }) => row.orgId === "org_b",
      ),
    ).to.equal(false);

    const orgADashboardResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: orgAAuth.cookie,
      },
    });
    expect(orgADashboardResponse.status).to.equal(200);

    const orgAHtml = await orgADashboardResponse.text();
    expect(orgAHtml).to.include("Org A knowledge dashboard");
    expect(orgAHtml).to.include("Signed in as user1@orgA.com");
    expect(orgAHtml).to.include("Brake alerts increased by 14% this week");
    expect(orgAHtml).to.include("Org A only");
    expect(orgAHtml).to.include(
      "Which knowledge categories changed most recently?",
    );
    expect(orgAHtml).to.not.include("Multi-agent reference flow");
    expect(orgAHtml).to.not.include("Seattle hub utilization breached 92%");

    const orgBAuth = await signInLocalAccess(projectDir, "user2@orgB.com");
    expect(orgBAuth.session.user.orgId).to.equal("org_b");
    expect(orgBAuth.session.user.accessRole).to.equal("tenant");
    expect(orgBAuth.session.idToken).to.be.a("string");

    const orgBSnapshotResponse = await fetch(
      `${SERVER_CONFIG.url}${DASHBOARD_SNAPSHOT_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${orgBAuth.session.idToken}`,
        },
      },
    );
    expect(orgBSnapshotResponse.status).to.equal(200);
    const orgBSnapshot = await orgBSnapshotResponse.json();
    expect(orgBSnapshot.knowledgeMetrics.totalRecords).to.equal(2);
    expect(
      orgBSnapshot.recentKnowledge.map((row: { orgId: string }) => row.orgId),
    ).to.deep.equal(["org_b", "org_b"]);
    expect(
      orgBSnapshot.recentKnowledge.some((row: { headline: string }) =>
        row.headline.includes("Seattle hub utilization breached 92%"),
      ),
    ).to.equal(true);
    expect(
      orgBSnapshot.recentKnowledge.some(
        (row: { orgId: string }) => row.orgId === "org_a",
      ),
    ).to.equal(false);

    const orgBDashboardResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: orgBAuth.cookie,
      },
    });
    expect(orgBDashboardResponse.status).to.equal(200);

    const orgBHtml = await orgBDashboardResponse.text();
    expect(orgBHtml).to.include("Org B knowledge dashboard");
    expect(orgBHtml).to.include("Signed in as user2@orgB.com");
    expect(orgBHtml).to.include("Seattle hub utilization breached 92%");
    expect(orgBHtml).to.include("Org B only");
    expect(orgBHtml).to.include(
      "Which knowledge categories changed most recently?",
    );
    expect(orgBHtml).to.not.include("Multi-agent reference flow");
    expect(orgBHtml).to.not.include("Brake alerts increased by 14% this week");
  });

  it("should allow Admin Debug to inspect cross-organization data", async function () {
    const adminAuth = await signInLocalAccess(projectDir, "admin@template.com");
    expect(adminAuth.session.user.accessRole).to.equal("admin_debug");
    expect(adminAuth.session.user.orgId).to.equal(undefined);
    expect(adminAuth.session.idToken).to.be.a("string");

    const adminMetrics = await callMcpTool<{
      rows: Array<{ totalRecords: number; highPriorityRecords: number }>;
      rowCount: number;
    }>(adminAuth.session.idToken, "query_tenant_knowledge_metrics", {
      metrics: ["totalRecords", "highPriorityRecords"],
      limit: 10,
    });

    expect(adminMetrics.rowCount).to.equal(1);
    expect(adminMetrics.rows[0]?.totalRecords).to.equal(4);

    const adminRecords = await callMcpTool<{
      rows: Array<{ headline: string }>;
      rowCount: number;
    }>(adminAuth.session.idToken, "list_tenant_knowledge_records", {
      columns: ["headline"],
      limit: 10,
    });

    expect(adminRecords.rowCount).to.equal(4);
    expect(adminRecords.rows.map((row) => row.headline).join(" ")).to.include(
      "Brake alerts increased by 14% this week",
    );
    expect(adminRecords.rows.map((row) => row.headline).join(" ")).to.include(
      "Seattle hub utilization breached 92%",
    );

    const adminSnapshotResponse = await fetch(
      `${SERVER_CONFIG.url}${DASHBOARD_SNAPSHOT_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${adminAuth.session.idToken}`,
        },
      },
    );
    expect(adminSnapshotResponse.status).to.equal(200);
    const adminSnapshot = await adminSnapshotResponse.json();
    expect(adminSnapshot.knowledgeMetrics.totalRecords).to.equal(4);
    expect(
      adminSnapshot.recentKnowledge.every(
        (row: { orgId: string }) => typeof row.orgId === "string",
      ),
    ).to.equal(true);

    const adminDashboardResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: adminAuth.cookie,
      },
    });
    expect(adminDashboardResponse.status).to.equal(200);

    const adminHtml = await adminDashboardResponse.text();
    expect(adminHtml).to.include("Debug dashboard across all seeded data");
    expect(adminHtml).to.include("Signed in as admin@template.com");
    expect(adminHtml).to.include("org_a");
    expect(adminHtml).to.include("org_b");
    expect(adminHtml).to.include("Brake alerts increased by 14% this week");
    expect(adminHtml).to.include("Seattle hub utilization breached 92%");
  });

  it("should clear stale dashboard sessions instead of crashing the page", async function () {
    const orgAAuth = await signInLocalAccess(projectDir, "user1@orgA.com");
    const expiredToken = await signOrgJwt(
      {
        org_id: "org_a",
        email: "user1@orgA.com",
        name: "user1@orgA.com",
        access_role: "tenant",
        scope: "agent:query",
      },
      Math.floor(Date.now() / 1000) - 10,
    );

    const staleSessionCookie = await encodeSessionCookie(
      projectDir,
      orgAAuth.sessionCookieName,
      {
        sub: "local-org-a-user-1",
        userId: "local-org-a-user-1",
        accessRole: "tenant",
        orgId: "org_a",
        orgName: "Org A",
        provider: "local",
        name: "user1@orgA.com",
        email: "user1@orgA.com",
        idToken: expiredToken,
      },
    );

    replaceSessionCookie(
      orgAAuth.cookieJar,
      orgAAuth.sessionCookieName,
      staleSessionCookie,
    );

    const redirectResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: cookieHeader(orgAAuth.cookieJar),
      },
      redirect: "manual",
    });

    expect([302, 303, 307]).to.include(redirectResponse.status);
    expect(redirectResponse.headers.get("location")).to.include(
      "/auth/session-expired",
    );

    const clearSessionResponse = await fetch(
      new URL(redirectResponse.headers.get("location") ?? "", webAppUrl),
      {
        headers: {
          Cookie: cookieHeader(orgAAuth.cookieJar),
        },
        redirect: "manual",
      },
    );

    expect([302, 303, 307]).to.include(clearSessionResponse.status);
    expect(clearSessionResponse.headers.get("location")).to.include(
      "session=expired",
    );

    updateCookieJar(orgAAuth.cookieJar, clearSessionResponse);
    expect(orgAAuth.cookieJar.has(orgAAuth.sessionCookieName)).to.equal(false);

    const landingResponse = await fetch(`${webAppUrl}/?session=expired`, {
      headers: {
        Cookie: cookieHeader(orgAAuth.cookieJar),
      },
    });

    expect(landingResponse.status).to.equal(200);

    const landingHtml = await landingResponse.text();
    expect(landingHtml).to.include("Sign in");
    expect(landingHtml).to.include("previous session expired");
  });

  it("should reject JWTs that omit org_id", async function () {
    const invalidToken = await signOrgJwt({
      email: "ops@example.com",
      name: "Missing Org",
      scope: "agent:query",
    });

    const response = await callMcp(invalidToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response.status).to.equal(401);
  });

  it("should surface MCP outages through status and chat errors", async function () {
    const orgAAuth = await signInLocalAccess(projectDir, "user1@orgA.com");

    await stopChildProcess(mooseProcess, "moose service");
    mooseProcess = null;

    const statusResponse = await fetch(`${webAppUrl}/api/chat/status`);
    expect(statusResponse.status).to.equal(200);

    const status = await statusResponse.json();
    expect(status.mcpReady).to.equal(false);
    expect(status.mcpStatus).to.equal("unavailable");
    expect(status.mcpDetails).to.include("http://localhost:4000/tools");
    expect(status.mcpDetails).to.include("pnpm dev:moose");

    const chatResponse = await fetch(`${webAppUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: orgAAuth.cookie,
      },
      body: JSON.stringify({
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [
              { type: "text", text: "Summarize the latest tenant notes." },
            ],
          },
        ],
      }),
    });

    expect(chatResponse.status).to.equal(503);

    const payload = await chatResponse.json();
    expect(payload.error).to.equal("MCP server unavailable");
    expect(payload.details).to.include("http://localhost:4000/tools");
    expect(payload.details).to.include("pnpm dev:moose");
  });
});
