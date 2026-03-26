import { getMooseUtils, toQueryPreview } from "@514labs/moose-lib";
import { baseQuery, filterVariants } from "./benchmark-cases";

declare const afterAll: (fn: () => void | Promise<void>) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const expect: any;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

const targetDb = process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local";
let benchmarkClient: Promise<any> | undefined;
let reporter: Promise<any> | undefined;
let testingHelpers: Promise<any> | undefined;

function getBenchmarkClient() {
  benchmarkClient ??= getMooseUtils().then(({ client }) => client);
  return benchmarkClient;
}

function getTestingHelpers() {
  testingHelpers ??= import(
    "@514labs/moose-lib/dist/testing/" + "index.js"
  ) as Promise<any>;
  return testingHelpers;
}

function getReporter() {
  reporter ??= getTestingHelpers().then(({ createTestReporter }) =>
    createTestReporter({
      prefix: `benchmark-${targetDb}`,
      outputDir: "./reports",
    }),
  );
  return reporter;
}

let baselineP95: number;

describe("Query benchmarks", () => {
  afterAll(async () => {
    const { flush } = await getReporter();
    await flush();
  });

  it("baseline p95 under threshold", async () => {
    const client = await getBenchmarkClient();
    const { profileBenchmark } = await getTestingHelpers();
    const { results } = await getReporter();
    const query = baseQuery();
    const { profiles, p50, p95 } = await profileBenchmark(
      client.query,
      query.toSql(),
      12,
    );

    baselineP95 = p95;

    results.tests["baseline"] = {
      sql: toQueryPreview(query.toSql()),
      profiles,
      p50,
      p95,
    };

    expect(p95).toBeLessThanOrEqual(500);
  });

  it("filter variants do not regress", async () => {
    expect(baselineP95, "Baseline must run first").toBeDefined();

    if (filterVariants.length === 0) return;

    const client = await getBenchmarkClient();
    const { profileBenchmark } = await getTestingHelpers();
    const { results } = await getReporter();
    const variantResults: Record<string, unknown> = {};

    for (const variant of filterVariants) {
      const query = variant.build();
      const { p50, p95 } = await profileBenchmark(
        client.query,
        query.toSql(),
        6,
      );

      variantResults[variant.name] = {
        sql: toQueryPreview(query.toSql()),
        p50,
        p95,
        baselineP95,
        ratio: p95 / baselineP95,
      };

      expect(
        p95,
        `${variant.name} p95 ${p95}ms > 2.5x baseline ${baselineP95}ms`,
      ).toBeLessThanOrEqual(baselineP95 * 2.5);
    }

    results.tests["filterRegression"] = variantResults;
  });

  it("EXPLAIN shows index usage", async () => {
    const client = await getBenchmarkClient();
    const { explain } = await getTestingHelpers();
    const { results } = await getReporter();
    const query = baseQuery().toSql();
    const plan = await explain(client.query, query);

    results.tests["explain"] = {
      sql: toQueryPreview(query),
      explain: plan,
    };

    expect(plan.indexCondition).not.toBe("true");
  });
});
