/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/**
 * Row-Level Security (RLS) E2E Tests
 *
 * Tests the SelectRowPolicy primitive end-to-end using a dedicated template
 * (typescript-rls-test) that includes:
 * - A TenantEvent IngestPipeline with a table and ingest API
 * - Two SelectRowPolicies: tenant_isolation (org_id) and data_filter (data)
 * - A View (TenantEventView) over the TenantEvent table
 * - APIs querying both the table directly and through the view
 * - JWT configuration with a test RSA keypair
 *
 * Verifies:
 * 1. Row policies are created in ClickHouse as RESTRICTIVE with getSetting()
 * 2. JWT with matching claims returns only matching rows
 * 3. No JWT returns 401 Unauthorized
 * 4. Multiple RESTRICTIVE policies enforce AND semantics (not OR)
 * 5. Row policies on base tables propagate through regular Views
 *
 */

import { spawn, ChildProcess } from "child_process";
import { expect } from "chai";
import * as path from "path";
import { createClient } from "@clickhouse/client";
import { SignJWT, importPKCS8 } from "jose";

import {
  TIMEOUTS,
  SERVER_CONFIG,
  CLICKHOUSE_CONFIG,
  RETRY_CONFIG,
} from "./constants";
import {
  waitForServerStart,
  createTempTestDirectory,
  setupTypeScriptProject,
  cleanupTestSuite,
  waitForInfrastructureReady,
  withRetries,
  logger,
} from "./utils";

const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
const MOOSE_LIB_PATH = path.resolve(
  __dirname,
  "../../../packages/ts-moose-lib",
);

const TEST_SUITE = "row-level-security";
const APP_NAME = "moose-ts-rls-app";

// RSA private key matching the public key in the template's moose.config.toml.
// Used to sign JWTs in test assertions.
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

const JWT_ISSUER = "rls-test";
const JWT_AUDIENCE = "rls-test";

const testLogger = logger.scope(TEST_SUITE);

async function signJwt(claims: Record<string, string>): Promise<string> {
  const privateKey = await importPKCS8(TEST_RSA_PRIVATE_KEY, "RS256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime("1h")
    .sign(privateKey);
}

describe("Row-Level Security E2E Tests", function () {
  this.timeout(TIMEOUTS.TEST_SETUP_MS);

  let testDir: string;
  let projectDir: string;
  let devProcess: ChildProcess | null = null;

  before(async function () {
    this.timeout(TIMEOUTS.TEST_SETUP_MS);
    testLogger.info("Starting RLS test suite");

    testDir = createTempTestDirectory(TEST_SUITE);
    projectDir = path.join(testDir, APP_NAME);

    testLogger.info("Setting up TypeScript project from typescript-rls-test", {
      projectDir,
    });
    await setupTypeScriptProject(
      projectDir,
      "typescript-rls-test",
      CLI_PATH,
      MOOSE_LIB_PATH,
      APP_NAME,
      "npm",
      { logger: testLogger },
    );

    // Start moose dev
    testLogger.info("Starting moose dev");
    devProcess = spawn(CLI_PATH, ["dev"], {
      cwd: projectDir,
      env: {
        ...process.env,
        MOOSE_DEV__SUPPRESS_DEV_SETUP_PROMPT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    devProcess.stdout?.on("data", (data) => {
      testLogger.info(`moose stdout: ${data.toString().trim()}`);
    });

    devProcess.stderr?.on("data", (data) => {
      testLogger.warn(`moose stderr: ${data.toString().trim()}`);
    });

    devProcess.on("error", (err) => {
      testLogger.error(`Failed to spawn moose process: ${err.message}`, err);
    });

    await waitForServerStart(
      devProcess,
      TIMEOUTS.SERVER_STARTUP_MS,
      SERVER_CONFIG.startupMessage,
      SERVER_CONFIG.url,
      { logger: testLogger },
    );

    await waitForInfrastructureReady(TIMEOUTS.SERVER_STARTUP_MS, {
      logger: testLogger,
    });

    // Ingest PublicEvent data (no RLS policies)
    testLogger.info("Ingesting PublicEvent data");
    const publicIngestUrl = `${SERVER_CONFIG.url}/ingest/PublicEvent`;
    const publicData = [
      {
        eventId: "p1",
        timestamp: "2026-03-10T00:00:00Z",
        message: "hello",
      },
      {
        eventId: "p2",
        timestamp: "2026-03-10T00:00:00Z",
        message: "world",
      },
    ];
    const publicResponse = await fetch(publicIngestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(publicData),
    });
    expect(publicResponse.status).to.equal(200);

    // Ingest test data: 3 acme rows, 2 other rows
    testLogger.info("Ingesting test data");
    const ingestUrl = `${SERVER_CONFIG.url}/ingest/TenantEvent`;
    const testData = [
      {
        eventId: "e1",
        timestamp: "2026-03-10T00:00:00Z",
        org_id: "acme",
        data: "acme-1",
      },
      {
        eventId: "e2",
        timestamp: "2026-03-10T00:00:00Z",
        org_id: "acme",
        data: "acme-2",
      },
      {
        eventId: "e3",
        timestamp: "2026-03-10T00:00:00Z",
        org_id: "acme",
        data: "acme-3",
      },
      {
        eventId: "e4",
        timestamp: "2026-03-10T00:00:00Z",
        org_id: "other",
        data: "other-1",
      },
      {
        eventId: "e5",
        timestamp: "2026-03-10T00:00:00Z",
        org_id: "other",
        data: "other-2",
      },
    ];

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testData),
    });
    expect(response.status).to.equal(200);

    // Wait for data to land in ClickHouse.
    // Query system.parts instead of the table directly because the row policy
    // on TenantEvent requires SQL_moose_rls_org_id to be set in the session.
    testLogger.info("Waiting for data to land in ClickHouse");
    await withRetries(
      async () => {
        const client = createClient(CLICKHOUSE_CONFIG);
        try {
          const result = await client.query({
            query:
              "SELECT sum(rows) as cnt FROM system.parts WHERE table = 'TenantEvent' AND database = 'local' AND active = 1",
            format: "JSONEachRow",
          });
          const rows: any[] = await result.json();
          const count = parseInt(rows[0].cnt);
          if (count < 5) {
            throw new Error(`Expected 5 rows, found ${count}`);
          }
          testLogger.info(`Data landed: ${count} rows in TenantEvent`);
        } finally {
          await client.close();
        }
      },
      {
        attempts: RETRY_CONFIG.DB_WRITE_ATTEMPTS,
        delayMs: RETRY_CONFIG.DB_WRITE_DELAY_MS,
        backoffFactor: 1,
        logger: testLogger,
        operationName: "Wait for TenantEvent data",
      },
    );

    testLogger.info("Test setup complete");
  });

  after(async function () {
    this.timeout(TIMEOUTS.CLEANUP_MS);
    testLogger.info("Cleaning up RLS test suite");
    await cleanupTestSuite(devProcess, projectDir, APP_NAME, {
      logger: testLogger,
    });
  });

  it("should create restrictive row policies in ClickHouse", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    const client = createClient(CLICKHOUSE_CONFIG);
    try {
      const result = await client.query({
        query:
          "SELECT name, select_filter, is_restrictive FROM system.row_policies WHERE database = 'local' ORDER BY name",
        format: "JSONEachRow",
      });
      const policies: any[] = await result.json();

      testLogger.info("Row policies found", { policies });

      expect(policies.length).to.equal(
        2,
        "Expected exactly 2 row policies (tenant_isolation + data_filter)",
      );

      for (const policy of policies) {
        expect(policy.select_filter).to.include("getSetting");
        expect(policy.select_filter).to.include("SQL_moose_rls_");
        expect(policy.is_restrictive).to.equal(
          1,
          `Row policy '${policy.name}' should be RESTRICTIVE`,
        );
      }
    } finally {
      await client.close();
    }
  });

  it("should return only acme rows when both claims match acme", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    // Both policies must be satisfied: org_id AND data
    // "acme-1" matches org_id="acme" AND data="acme-1" -> 1 row
    const token = await signJwt({ org_id: "acme", data: "acme-1" });
    const response = await fetch(`${SERVER_CONFIG.url}/api/tenantEvents`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).to.equal(200);
    const rows = (await response.json()) as any[];

    testLogger.info("Acme + data=acme-1 query result", {
      count: rows.length,
      rows,
    });

    expect(rows.length).to.equal(1);
    expect(rows[0].org_id).to.equal("acme");
    expect(rows[0].data).to.equal("acme-1");
  });

  it("should enforce AND semantics across multiple policies", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    // org_id="acme" matches 3 rows, data="other-1" matches 1 row
    // With RESTRICTIVE (AND): org_id="acme" AND data="other-1" -> 0 rows
    // With PERMISSIVE (OR): org_id="acme" OR data="other-1" -> 4 rows
    const token = await signJwt({ org_id: "acme", data: "other-1" });
    const response = await fetch(`${SERVER_CONFIG.url}/api/tenantEvents`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).to.equal(200);
    const rows = (await response.json()) as any[];

    testLogger.info("Cross-tenant AND test result", {
      count: rows.length,
      rows,
    });

    expect(rows.length).to.equal(
      0,
      "RESTRICTIVE policies should return 0 rows when claims don't intersect (AND semantics)",
    );
  });

  it("should return only other rows when both claims match other", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    const token = await signJwt({ org_id: "other", data: "other-1" });
    const response = await fetch(`${SERVER_CONFIG.url}/api/tenantEvents`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).to.equal(200);
    const rows = (await response.json()) as any[];

    testLogger.info("Other + data=other-1 query result", {
      count: rows.length,
      rows,
    });

    expect(rows.length).to.equal(1);
    expect(rows[0].org_id).to.equal("other");
    expect(rows[0].data).to.equal("other-1");
  });

  it("should return 401 without a JWT", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    const response = await fetch(`${SERVER_CONFIG.url}/api/tenantEvents`);

    testLogger.info("No-JWT response", { status: response.status });

    expect(response.status).to.equal(401);
  });

  it("should propagate row policies through a View", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    // Query the tenantEventsView API which reads from TenantEventView
    // (a regular View over TenantEvent). The row policies are on the
    // base table, but should filter results when queried through the view.
    const token = await signJwt({ org_id: "acme", data: "acme-2" });
    const response = await fetch(`${SERVER_CONFIG.url}/api/tenantEventsView`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).to.equal(200);
    const rows = (await response.json()) as any[];

    testLogger.info("View query result", { count: rows.length, rows });

    expect(rows.length).to.equal(1);
    expect(rows[0].org_id).to.equal("acme");
    expect(rows[0].data).to.equal("acme-2");
  });

  it("should enforce AND semantics through a View", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    // Same cross-tenant test as above but through the view — should also
    // return 0 rows because RESTRICTIVE policies on the base table apply.
    const token = await signJwt({ org_id: "acme", data: "other-1" });
    const response = await fetch(`${SERVER_CONFIG.url}/api/tenantEventsView`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).to.equal(200);
    const rows = (await response.json()) as any[];

    testLogger.info("View cross-tenant AND test result", {
      count: rows.length,
      rows,
    });

    expect(rows.length).to.equal(
      0,
      "RESTRICTIVE policies should propagate through views (AND semantics)",
    );
  });

  it("should return all rows from a non-RLS table with JWT", async function () {
    this.timeout(TIMEOUTS.SCHEMA_VALIDATION_MS);

    // PublicEvent has no row policies. Even though the request carries a JWT
    // with RLS claims, the moose_rls_user should be able to query it and
    // return all rows without filtering.
    const token = await signJwt({ org_id: "acme", data: "acme-1" });
    const response = await fetch(`${SERVER_CONFIG.url}/api/publicEvents`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).to.equal(200);
    const rows = (await response.json()) as any[];

    testLogger.info("Non-RLS table query result", {
      count: rows.length,
      rows,
    });

    expect(rows.length).to.equal(
      2,
      "Non-RLS table should return all rows regardless of JWT claims",
    );
  });
});
