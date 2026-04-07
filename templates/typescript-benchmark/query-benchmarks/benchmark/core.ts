import { getMooseUtils } from "@514labs/moose-lib";
import { createTestReporter } from "@514labs/moose-lib/testing";

export interface BenchmarkDefinition<
  TQuery extends { toSql(): unknown } = { toSql(): unknown },
> {
  baseQuery: () => TQuery;
  scenarios: Array<{
    name: string;
    query: () => TQuery;
  }>;
  thresholds: {
    baselineP95Ms: number;
    scenarioRegressionRatio: number;
  };
  sampling: {
    baselineRuns: number;
    scenarioRuns: number;
  };
}

export function defineBenchmark<TQuery extends { toSql(): unknown }>(
  benchmark: BenchmarkDefinition<TQuery>,
): BenchmarkDefinition<TQuery> {
  return benchmark;
}

export interface BenchmarkContext {
  client: Awaited<ReturnType<typeof getMooseUtils>>["client"];
  targetDb: string;
  reporter: ReturnType<typeof createTestReporter>;
}

export async function createBenchmarkContext(): Promise<BenchmarkContext> {
  const { client } = await getMooseUtils({ readonly: true });
  const targetDb = process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local";
  return {
    client,
    targetDb,
    reporter: createTestReporter({
      prefix: `benchmark-${targetDb}`,
      outputDir: "./reports",
    }),
  };
}
