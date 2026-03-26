import { buildQuery } from "@514labs/moose-lib";
import { benchmarkModel } from "./benchmark-model";

const model = benchmarkModel;

const ALL_METRICS = Object.keys(model.metrics ?? {});
const ALL_DIMENSIONS = Object.keys(model.dimensions ?? {});

export function baseQuery() {
  return buildQuery(model).dimensions(ALL_DIMENSIONS).metrics(ALL_METRICS);
}

export const filterVariants: Array<{
  name: string;
  build: () => ReturnType<typeof baseQuery>;
}> = [
  // TODO: Add your filter variants here.
];
