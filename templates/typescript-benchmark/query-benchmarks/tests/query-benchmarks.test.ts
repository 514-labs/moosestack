import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toQueryPreview } from "@514labs/moose-lib";
import { explain, profileBenchmark } from "@514labs/moose-lib/testing";
import {
  type BenchmarkContext,
  createBenchmarkContext,
} from "../benchmark/core";
import { benchmark } from "../benchmark.config";

let ctx: BenchmarkContext;
let baselineResult: {
  sql: string;
  profiles: readonly unknown[];
  p50: number;
  p95: number;
};

describe("Query benchmarks", () => {
  beforeAll(async () => {
    ctx = await createBenchmarkContext();
    const sql = benchmark.baseQuery().toSql();
    const { profiles, p50, p95 } = await profileBenchmark(
      ctx.client.query,
      sql,
      benchmark.sampling.baselineRuns,
    );

    baselineResult = {
      sql: toQueryPreview(sql),
      profiles,
      p50,
      p95,
    };

    ctx.reporter.results.tests["baseline"] = baselineResult;
  });

  afterAll(async () => {
    await ctx.reporter.flush();
  });

  it("baseline p95 under threshold", async () => {
    expect(
      baselineResult.p95,
      `baseline p95 ${baselineResult.p95}ms > configured limit ${benchmark.thresholds.baselineP95Ms}ms`,
    ).toBeLessThanOrEqual(benchmark.thresholds.baselineP95Ms);
  });

  (benchmark.scenarios.length > 0 ? it : it.skip)(
    "scenarios do not regress",
    async () => {
      const scenarioResults: Record<
        string,
        {
          sql: string;
          p50: number;
          p95: number;
          baselineP95: number;
          ratio: number;
        }
      > = {};

      for (const scenario of benchmark.scenarios) {
        const sql = scenario.query().toSql();
        const { p50, p95 } = await profileBenchmark(
          ctx.client.query,
          sql,
          benchmark.sampling.scenarioRuns,
        );

        scenarioResults[scenario.name] = {
          sql: toQueryPreview(sql),
          p50,
          p95,
          baselineP95: baselineResult.p95,
          ratio: p95 / baselineResult.p95,
        };
      }

      ctx.reporter.results.tests["scenarioRegression"] = scenarioResults;

      for (const [name, result] of Object.entries(scenarioResults)) {
        expect(
          result.p95,
          `${name} p95 ${result.p95}ms > configured multiplier ${benchmark.thresholds.scenarioRegressionRatio}x baseline ${baselineResult.p95}ms`,
        ).toBeLessThanOrEqual(
          baselineResult.p95 * benchmark.thresholds.scenarioRegressionRatio,
        );
      }
    },
  );

  it("EXPLAIN shows index usage", async () => {
    const sql = benchmark.baseQuery().toSql();
    const explainResult = await explain(ctx.client.query, sql);
    const result = {
      sql: toQueryPreview(sql),
      explain: explainResult,
    };

    ctx.reporter.results.tests["explain"] = result;

    expect(result.explain.indexCondition).not.toBe("true");
  });
});
