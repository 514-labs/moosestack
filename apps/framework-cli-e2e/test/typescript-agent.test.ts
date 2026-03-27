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

async function signTenantJwt(
  claims: Record<string, string>,
  expirationTime: string | number = "1h",
): Promise<string> {
  const privateKey = await importPKCS8(TEST_RSA_PRIVATE_KEY, "RS256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(`local-${claims.tenant_id ?? "missing-tenant"}`)
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

async function signInLocalTenant(tenantId: string) {
  const jar = new Map<string, string>();

  const csrfResponse = await fetch(`${webAppUrl}/api/auth/csrf`, {
    redirect: "manual",
  });
  expect(csrfResponse.status).to.equal(200);
  updateCookieJar(jar, csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const callbackResponse = await fetch(
    `${webAppUrl}/api/auth/callback/local-tenant`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(jar),
      },
      body: new URLSearchParams({
        csrfToken,
        tenantId,
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
  let serviceEnvPath: string;
  let webAppEnvPath: string;
  let webAppPort: number;
  let webProcess: ChildProcess | null = null;
  let mooseProcess: ChildProcess | null = null;

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
      { logger: testLogger },
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
    const seedResult = await execAsync(
      "pnpm --filter moosestack-service seed",
      {
        cwd: projectDir,
      },
    );
    expect(seedResult.stdout).to.contain(
      "Inserted 4 records into tenant_knowledge",
    );
    expect(seedResult.stdout).to.contain("acme: 2");
    expect(seedResult.stdout).to.contain("globex: 2");

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
    await cleanupTestSuite(mooseProcess, projectDir, APP_NAME, {
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

  it("should render the unauthenticated landing page and provider status", async function () {
    const pageResponse = await fetch(webAppUrl);
    expect(pageResponse.status).to.equal(200);

    const html = await pageResponse.text();
    expect(html).to.include("typescript-agent");
    expect(html).to.include("Choose a tenant");
    expect(html).to.include("Production-shaped agent starter");

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

  it("should scope MCP tools to the caller tenant", async function () {
    const acmeAuth = await signInLocalTenant("acme");
    const globexAuth = await signInLocalTenant("globex");
    const acmeToken = acmeAuth.session.idToken;
    const globexToken = globexAuth.session.idToken;

    expect(acmeToken).to.be.a("string");
    expect(globexToken).to.be.a("string");

    const listResponse = await callMcp(acmeToken, {
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

    expect(toolNames).to.include("query_clickhouse");
    expect(toolNames).to.include("get_data_catalog");

    const acmeRows = await callMcpTool<{
      rows: Array<{ tenant_id: string; headline: string }>;
      rowCount: number;
    }>(acmeToken, "query_clickhouse", {
      query:
        "SELECT tenant_id, headline FROM tenant_knowledge ORDER BY timestamp DESC",
      limit: 10,
    });

    expect(acmeRows.rowCount).to.equal(2);
    expect(acmeRows.rows.every((row) => row.tenant_id === "acme")).to.equal(
      true,
    );
    expect(acmeRows.rows.map((row) => row.headline).join(" ")).to.include(
      "Brake alerts increased by 14% this week",
    );

    const preLimitedRows = await callMcpTool<{
      rows: Array<{ tenant_id: string; headline: string }>;
      rowCount: number;
    }>(acmeToken, "query_clickhouse", {
      query:
        "SELECT tenant_id, headline FROM tenant_knowledge ORDER BY timestamp DESC LIMIT 1",
      limit: 100,
    });

    expect(preLimitedRows.rowCount).to.equal(1);
    expect(preLimitedRows.rows[0]?.tenant_id).to.equal("acme");

    const globexRows = await callMcpTool<{
      rows: Array<{ tenant_id: string; headline: string }>;
      rowCount: number;
    }>(globexToken, "query_clickhouse", {
      query:
        "SELECT tenant_id, headline FROM tenant_knowledge ORDER BY timestamp DESC",
      limit: 10,
    });

    expect(globexRows.rowCount).to.equal(2);
    expect(globexRows.rows.every((row) => row.tenant_id === "globex")).to.equal(
      true,
    );
    expect(globexRows.rows.map((row) => row.headline).join(" ")).to.include(
      "Seattle hub utilization breached 92%",
    );

    const catalog = await callMcpTool<{
      tables?: Record<string, unknown>;
      materialized_views?: Record<string, unknown>;
    }>(acmeToken, "get_data_catalog", {
      format: "detailed",
      component_type: "tables",
    });

    expect(catalog.tables).to.have.property("tenant_knowledge");
    expect(Object.keys(catalog.tables ?? {})).to.deep.equal([
      "tenant_knowledge",
    ]);

    const filteredCatalog = await callMcpToolText(
      acmeToken,
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

    const describeRows = await callMcpTool<{
      rows: Array<{ name: string; type: string }>;
      rowCount: number;
    }>(acmeToken, "query_clickhouse", {
      query: "DESCRIBE TABLE tenant_knowledge",
      limit: 50,
    });
    expect(describeRows.rowCount).to.be.greaterThan(0);
    expect(describeRows.rows.some((row) => row.name === "tenant_id")).to.equal(
      true,
    );

    const blockedSystemQuery = await callMcpToolText(
      acmeToken,
      "query_clickhouse",
      {
        query: "SELECT name FROM system.tables ORDER BY name",
        limit: 10,
      },
    );
    expect(blockedSystemQuery.isError).to.equal(true);
    expect(blockedSystemQuery.text).to.include(
      "System metadata is not exposed by default",
    );
  });

  it("should create local tenant sessions and render tenant-scoped dashboards", async function () {
    const acmeAuth = await signInLocalTenant("acme");
    expect(acmeAuth.session.user.tenantId).to.equal("acme");
    expect(acmeAuth.session.idToken).to.be.a("string");

    const acmeSnapshotResponse = await fetch(
      `${SERVER_CONFIG.url}${DASHBOARD_SNAPSHOT_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${acmeAuth.session.idToken}`,
        },
      },
    );
    expect(acmeSnapshotResponse.status).to.equal(200);
    const acmeSnapshot = await acmeSnapshotResponse.json();
    expect(acmeSnapshot.knowledgeMetrics.totalRecords).to.equal(2);
    expect(
      acmeSnapshot.recentKnowledge.some((row: { headline: string }) =>
        row.headline.includes("Brake alerts increased by 14% this week"),
      ),
    ).to.equal(true);

    const acmeDashboardResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: acmeAuth.cookie,
      },
    });
    expect(acmeDashboardResponse.status).to.equal(200);

    const acmeHtml = await acmeDashboardResponse.text();
    expect(acmeHtml).to.include("Tenant-scoped agent dashboard");
    expect(acmeHtml).to.include("ACME Fleet");
    expect(acmeHtml).to.include("Brake alerts increased by 14% this week");
    expect(acmeHtml).to.include("Multi-agent reference flow");
    expect(acmeHtml).to.include("supervisor");
    expect(acmeHtml).to.include("specialist");
    expect(acmeHtml).to.include("narrator");
    expect(acmeHtml).to.include("[AGENT:...]");
    expect(acmeHtml).to.not.include("Seattle hub utilization breached 92%");

    const globexAuth = await signInLocalTenant("globex");
    expect(globexAuth.session.user.tenantId).to.equal("globex");
    expect(globexAuth.session.idToken).to.be.a("string");

    const globexSnapshotResponse = await fetch(
      `${SERVER_CONFIG.url}${DASHBOARD_SNAPSHOT_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${globexAuth.session.idToken}`,
        },
      },
    );
    expect(globexSnapshotResponse.status).to.equal(200);
    const globexSnapshot = await globexSnapshotResponse.json();
    expect(globexSnapshot.knowledgeMetrics.totalRecords).to.equal(2);
    expect(
      globexSnapshot.recentKnowledge.some((row: { headline: string }) =>
        row.headline.includes("Seattle hub utilization breached 92%"),
      ),
    ).to.equal(true);

    const globexDashboardResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: globexAuth.cookie,
      },
    });
    expect(globexDashboardResponse.status).to.equal(200);

    const globexHtml = await globexDashboardResponse.text();
    expect(globexHtml).to.include("Tenant-scoped agent dashboard");
    expect(globexHtml).to.include("Globex Mobility");
    expect(globexHtml).to.include("Seattle hub utilization breached 92%");
    expect(globexHtml).to.include(
      "Use the multi-agent flow to inspect the data catalog, route",
    );
    expect(globexHtml).to.not.include(
      "Brake alerts increased by 14% this week",
    );
  });

  it("should clear stale dashboard sessions instead of crashing the page", async function () {
    const acmeAuth = await signInLocalTenant("acme");
    const expiredToken = await signTenantJwt(
      {
        tenant_id: "acme",
        email: "ops@acme.example",
        name: "ACME Fleet",
        scope: "agent:query",
      },
      Math.floor(Date.now() / 1000) - 10,
    );

    const staleSessionCookie = await encodeSessionCookie(
      projectDir,
      acmeAuth.sessionCookieName,
      {
        sub: "local-acme",
        userId: "local-acme",
        tenantId: "acme",
        tenantName: "ACME Fleet",
        providerName: "local",
        name: "ACME Fleet",
        email: "ops@acme.example",
        idToken: expiredToken,
      },
    );

    replaceSessionCookie(
      acmeAuth.cookieJar,
      acmeAuth.sessionCookieName,
      staleSessionCookie,
    );

    const redirectResponse = await fetch(webAppUrl, {
      headers: {
        Cookie: cookieHeader(acmeAuth.cookieJar),
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
          Cookie: cookieHeader(acmeAuth.cookieJar),
        },
        redirect: "manual",
      },
    );

    expect([302, 303, 307]).to.include(clearSessionResponse.status);
    expect(clearSessionResponse.headers.get("location")).to.include(
      "session=expired",
    );

    updateCookieJar(acmeAuth.cookieJar, clearSessionResponse);
    expect(acmeAuth.cookieJar.has(acmeAuth.sessionCookieName)).to.equal(false);

    const landingResponse = await fetch(`${webAppUrl}/?session=expired`, {
      headers: {
        Cookie: cookieHeader(acmeAuth.cookieJar),
      },
    });

    expect(landingResponse.status).to.equal(200);

    const landingHtml = await landingResponse.text();
    expect(landingHtml).to.include("Choose a tenant");
    expect(landingHtml).to.include("previous session expired");
  });

  it("should reject JWTs that omit tenant_id", async function () {
    const invalidToken = await signTenantJwt({
      email: "ops@example.com",
      name: "Missing Tenant",
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
    const acmeAuth = await signInLocalTenant("acme");

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
        Cookie: acmeAuth.cookie,
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
