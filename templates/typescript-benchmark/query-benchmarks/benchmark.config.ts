import { buildQuery } from "@514labs/moose-lib";
import { defineBenchmark } from "./benchmark/core";

// TODO: Import your query model from your compiled Moose entry.
//
// Common examples:
//   import { myQueryModel } from "../dist/src/index.js";
//   import { myQueryModel } from "../dist/app/index.js";
//   import { myQueryModel } from "../.moose/compiled/src/index.js";
//   import { myQueryModel } from "../.moose/compiled/app/index.js";
//
// Replace `benchmarkModel` with the query model you want to benchmark.
const benchmarkModel = undefined as any;

const baseQuery = () =>
  buildQuery(benchmarkModel)
    .dimensions(Object.keys(benchmarkModel.dimensions ?? {}))
    .metrics(Object.keys(benchmarkModel.metrics ?? {}));

export const benchmark = defineBenchmark({
  baseQuery,
  scenarios: [
    // TODO: Add your benchmark scenarios here.
    // {
    //   name: "category=A3",
    //   query: () => baseQuery().filter("category", "eq", "A3"),
    // },
  ],
  thresholds: {
    baselineP95Ms: 500,
    scenarioRegressionRatio: 2.5,
  },
  sampling: {
    baselineRuns: 12,
    scenarioRuns: 6,
  },
});
