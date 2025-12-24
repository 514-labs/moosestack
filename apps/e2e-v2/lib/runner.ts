/**
 * Test runner utilities for e2e-v2
 */

import { spawn, ChildProcess, execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import type { TestContext, Template, FixtureFile } from "./types.js";
import { getTestPort } from "./manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MOOSE_BINARY =
  process.env.MOOSE_BINARY ||
  path.join(__dirname, "../../../target/debug/moose-cli");

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  pollIntervalMs = 500,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await sleep(pollIntervalMs);
  }

  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if Moose is ready on a given port
 */
export async function waitForMooseReady(
  port: number,
  timeoutMs = 60000,
): Promise<boolean> {
  return waitFor(async () => {
    try {
      const response = await fetch(
        `http://localhost:${port}/ready?detailed=true&wait=true&timeout=5000`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }, timeoutMs);
}

/**
 * Start Moose dev server for a template
 */
export async function startMooseDev(
  templatePath: string,
  port: number,
): Promise<ChildProcess> {
  const proc = spawn(MOOSE_BINARY, ["dev"], {
    cwd: templatePath,
    env: {
      ...process.env,
      MOOSE_HTTP_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Log output for debugging
  proc.stdout?.on("data", (data) => {
    if (process.env.MOOSE_DEBUG) {
      console.log(`[moose:${port}] ${data}`);
    }
  });

  proc.stderr?.on("data", (data) => {
    if (process.env.MOOSE_DEBUG) {
      console.error(`[moose:${port}] ${data}`);
    }
  });

  return proc;
}

/**
 * Stop a Moose process
 */
export function stopMoose(proc: ChildProcess): void {
  if (proc.pid) {
    try {
      // Send SIGTERM first
      proc.kill("SIGTERM");

      // Give it a moment to clean up
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    } catch (error) {
      // Process may already be dead
    }
  }
}

/**
 * Create a test context for a template
 */
export function createTestContext(template: Template): TestContext {
  const port = getTestPort(template);

  return {
    template,
    port,
    baseUrl: `http://localhost:${port}`,
    mooseBinary: MOOSE_BINARY,
  };
}

/**
 * Load fixtures via HTTP endpoint
 */
export async function loadFixtures(
  baseUrl: string,
  fixture: FixtureFile,
): Promise<void> {
  const response = await fetch(`${baseUrl}/moose/fixtures/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: fixture.data,
      wait: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to load fixtures: ${response.status} - ${body}`);
  }
}

/**
 * Load a fixture file from disk
 */
export function readFixtureFile(fixturePath: string): FixtureFile {
  const content = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as FixtureFile;
}

/**
 * Query ClickHouse and return results
 */
export async function queryClickHouse(
  _baseUrl: string,
  sql: string,
  clickhouseUrl: string = process.env.CLICKHOUSE_URL ||
    "http://localhost:18123",
): Promise<unknown[]> {
  // Use direct HTTP to ClickHouse
  // The _baseUrl parameter is kept for API compatibility but currently unused
  // since we need the ClickHouse URL, not the Moose server URL

  const response = await fetch(
    `${clickhouseUrl}/?default_format=JSONEachRow&query=${encodeURIComponent(sql)}`,
  );

  if (!response.ok) {
    throw new Error(`ClickHouse query failed: ${await response.text()}`);
  }

  const text = await response.text();
  if (!text.trim()) return [];

  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/**
 * Ingest a single record to a model
 */
export async function ingestRecord(
  baseUrl: string,
  model: string,
  record: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${baseUrl}/ingest/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ingest failed: ${response.status} - ${body}`);
  }
}

/**
 * Batch ingest multiple records to a model
 */
export async function ingestBatch(
  baseUrl: string,
  model: string,
  records: Record<string, unknown>[],
): Promise<void> {
  for (const record of records) {
    await ingestRecord(baseUrl, model, record);
  }
}
