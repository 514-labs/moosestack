import { ReportBuilder, FieldMeta } from "@/components/report-builder";
import { executeStatsQuery } from "./actions";
import type { StatsDimension, StatsMetric } from "moose";

/**
 * Dimension definitions with UI metadata.
 */
export const STATS_DIMENSIONS: readonly FieldMeta<StatsDimension>[] = [
  { id: "status", label: "Status", description: "Event status" },
  { id: "timestamp", label: "Timestamp", description: "Event timestamp" },
  { id: "day", label: "Day", description: "Day (date)" },
  { id: "month", label: "Month", description: "Month start" },
] as const;

/**
 * Metric definitions with UI metadata.
 * dataKey maps the UI id to the snake_case key in query results.
 */
export const STATS_METRICS: readonly FieldMeta<StatsMetric>[] = [
  {
    id: "totalEvents",
    label: "Total Events",
    description: "Count of events",
    dataKey: "total_events",
  },
  {
    id: "totalAmount",
    label: "Total Amount",
    description: "Sum of amounts",
    dataKey: "total_amount",
  },
  {
    id: "avgAmount",
    label: "Avg Amount",
    description: "Average amount",
    dataKey: "avg_amount",
  },
  {
    id: "minAmount",
    label: "Min Amount",
    description: "Minimum amount",
    dataKey: "min_amount",
  },
  {
    id: "maxAmount",
    label: "Max Amount",
    description: "Maximum amount",
    dataKey: "max_amount",
  },
  {
    id: "highValueRatio",
    label: "High Value %",
    description: "Ratio of high-value events",
    dataKey: "high_value_ratio",
  },
] as const;

export default function StatsReportPage() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl">
        <ReportBuilder
          dimensions={STATS_DIMENSIONS}
          metrics={STATS_METRICS}
          execute={executeStatsQuery}
          title="04-Aggregations Report Builder"
          description="Build custom reports by selecting breakdown dimensions and metrics"
          defaultBreakdown={["status"]}
          defaultMetrics={["totalEvents", "totalAmount"]}
          showDateFilter={true}
        />
      </div>
    </div>
  );
}
