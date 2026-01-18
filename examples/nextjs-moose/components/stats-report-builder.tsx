"use client";

/**
 * Stats Report Builder - Pre-configured ReportBuilder for statsModel.
 *
 * This is a Client Component wrapper that configures ReportBuilder
 * with the stats model dimensions, metrics, and server action.
 */

import { ReportBuilder } from "@/components/report-builder";
import {
  executeStatsQuery,
  type StatsResultRow,
} from "@/app/actions/stats-report";
import type { FieldMeta } from "@/components/report-builder";
import type { StatsDimension, StatsMetric } from "moose";

/**
 * Dimension definitions with UI metadata.
 */
const STATS_DIMENSIONS: readonly FieldMeta<StatsDimension>[] = [
  { id: "status", label: "Status", description: "Event status" },
  { id: "timestamp", label: "Timestamp", description: "Event timestamp" },
  { id: "day", label: "Day", description: "Day (date)" },
  { id: "month", label: "Month", description: "Month start" },
] as const;

/**
 * Metric definitions with UI metadata.
 */
const STATS_METRICS: readonly FieldMeta<StatsMetric>[] = [
  { id: "totalEvents", label: "Total Events", description: "Count of events" },
  { id: "totalAmount", label: "Total Amount", description: "Sum of amounts" },
  { id: "avgAmount", label: "Avg Amount", description: "Average amount" },
  { id: "minAmount", label: "Min Amount", description: "Minimum amount" },
  { id: "maxAmount", label: "Max Amount", description: "Maximum amount" },
  {
    id: "highValueRatio",
    label: "High Value %",
    description: "Ratio of high-value events",
  },
] as const;

export interface StatsReportBuilderProps {
  title?: string;
  description?: string;
  defaultDimensions?: StatsDimension[];
  defaultMetrics?: StatsMetric[];
  defaultGroupBy?: StatsDimension;
  showDateFilter?: boolean;
  showGroupBy?: boolean;
}

export function StatsReportBuilder({
  title = "Events Report Builder",
  description = "Build custom reports by selecting dimensions and metrics",
  defaultDimensions = ["status"],
  defaultMetrics = ["totalEvents", "totalAmount"],
  defaultGroupBy = "status",
  showDateFilter = true,
  showGroupBy = true,
}: StatsReportBuilderProps) {
  return (
    <ReportBuilder<StatsDimension, StatsMetric, StatsResultRow>
      dimensions={STATS_DIMENSIONS}
      metrics={STATS_METRICS}
      execute={executeStatsQuery}
      title={title}
      description={description}
      defaultDimensions={defaultDimensions}
      defaultMetrics={defaultMetrics}
      defaultGroupBy={defaultGroupBy}
      showDateFilter={showDateFilter}
      showGroupBy={showGroupBy}
    />
  );
}
