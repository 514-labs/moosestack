/**
 * Test report accumulator — collects results from test cases
 * and writes a timestamped JSON detail file.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface TestReportTarget {
  readonly host: string;
  readonly database: string;
}

export interface TestReport {
  readonly timestamp: string;
  readonly target: TestReportTarget;
  tests: Record<string, unknown>;
}

export interface TestReporterOptions {
  /** Prefix for the output filename (e.g. "benchmark-details") */
  prefix: string;
  /** Directory to write report files into */
  outputDir: string;
  /** ClickHouse target info. If omitted, reads from MOOSE_CLICKHOUSE_CONFIG__* env vars. */
  target?: TestReportTarget;
}

export function createTestReporter(options: TestReporterOptions): {
  results: TestReport;
  flush: () => Promise<string>;
} {
  const target = options.target ?? {
    host: process.env.MOOSE_CLICKHOUSE_CONFIG__HOST ?? "localhost",
    database: process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local",
  };

  const results: TestReport = {
    timestamp: new Date().toISOString(),
    target,
    tests: {},
  };

  const flush = async (): Promise<string> => {
    await mkdir(options.outputDir, { recursive: true });
    const filename = `${options.prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const filepath = join(options.outputDir, filename);
    await writeFile(filepath, JSON.stringify(results, null, 2));
    return filepath;
  };

  return { results, flush };
}
