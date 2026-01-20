"use client";

import * as React from "react";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { DonutChart } from "@/components/donut-chart";
import { useDateFilter } from "@/lib/hooks";
import { useMetrics, useEventsOverTime } from "@/lib/hooks";
import type { EventsOverTimeBucket } from "@/app/actions/events";
import { ChartLine } from "lucide-react";
import { type ChartConfig } from "@/components/ui/chart";

// Chart config maps status names (lowercase) to colors
const statusChartConfig = {
  completed: {
    label: "Completed",
    color: "var(--chart-1)",
  },
  active: {
    label: "Active",
    color: "var(--chart-2)",
  },
  inactive: {
    label: "Inactive",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

function calculateBucket(
  startDate: string,
  endDate: string,
): EventsOverTimeBucket {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil(
    Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diffDays <= 2 ? "hour" : "day";
}

export function DashboardCharts() {
  const { startDate, endDate } = useDateFilter();

  const bucket = React.useMemo(() => {
    if (!startDate || !endDate) return "day";
    return calculateBucket(startDate, endDate);
  }, [startDate, endDate]);

  const { data: timeSeriesData = [] } = useEventsOverTime(
    startDate,
    endDate,
    bucket,
  );

  const { data: metrics } = useMetrics(startDate, endDate);

  // Data is already in the right format from the query (name and value)
  // Colors are handled via chartConfig
  const chartData = metrics?.eventsByStatus ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Time Series Chart */}
      <TimeSeriesChart
        title="Events over time"
        description="COUNT(events) grouped by time bucket"
        data={timeSeriesData}
        chartId="events-over-time"
        gridSpan={{ lg: 2 }}
      />

      {/* Events by Status Chart */}
      <DonutChart
        data={chartData}
        chartConfig={statusChartConfig}
        title="Events by Status"
        icon={
          <ChartLine className="size-4 sm:size-[18px] text-muted-foreground" />
        }
        centerValue={metrics?.totalEvents ?? 0}
        centerLabel="Total Events"
        chartId="events-by-status"
        gridSpan={{ lg: 1 }}
      />
    </div>
  );
}
