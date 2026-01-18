"use server";

import { getOverallStats } from "moose";
import type { StatsParams } from "moose";

export type ReportResult = Awaited<ReturnType<typeof getOverallStats>>;

export async function getReport(params: StatsParams): Promise<ReportResult> {
  return getOverallStats(params);
}

const validExample: StatsParams = {
  status: "completed",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  metrics: ["highValueRatio", "totalEvents"],
  dimensions: ["day", "month"],
};
