"use server";

import { getStatsSimple, StatsDimension, StatsMetric } from "moose";
import type { ReportQueryParams } from "@/components/report-builder";

/** Result row type */
export type StatsResultRow = Awaited<ReturnType<typeof getStatsSimple>>[number];

/**
 * Server Action: Execute stats query.
 */
export async function executeStatsQuery(
  params: ReportQueryParams<StatsDimension, StatsMetric>,
): Promise<StatsResultRow[]> {
  return await getStatsSimple({
    dimensions: params.breakdown,
    metrics: params.metrics,
    startDate: params.startDate,
    endDate: params.endDate,
  });
}
