"use server";

import { getStatsSimple } from "moose";
import type { ReportQueryParams } from "@/components/report-builder";
import type { StatsDimension, StatsMetric } from "moose";

/** Result row type - element type of the array returned by getStatsSimple */
export type StatsResultRow = Awaited<ReturnType<typeof getStatsSimple>>[number];

/**
 * Server Action: Execute stats query.
 * Maps ReportQueryParams to StatsParams format.
 */
export async function executeStatsQuery(
  params: ReportQueryParams<StatsDimension, StatsMetric>,
): Promise<StatsResultRow[]> {
  return await getStatsSimple({
    dimensions: params.dimensions,
    metrics: params.metrics,
    startDate: params.startDate,
    endDate: params.endDate,
  });
}
