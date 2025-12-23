"use client";

import * as React from "react";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { ChartPieDonutText } from "@/components/donut-chart";
import { useDateFilter } from "@/lib/hooks";
import { useMetrics, useEventsOverTime } from "@/lib/hooks";
import type { EventsOverTimeBucket } from "@/app/actions/events";

function calculateBucket(
  startDate: string,
  endDate: string,
): EventsOverTimeBucket {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil(
    Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  return (
    diffDays <= 2 ? "hour"
    : diffDays <= 60 ? "day"
    : "day"
  );
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

  const pieData = metrics?.eventsByStatus ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Time Series Chart */}
      <div className="lg:col-span-2">
        <TimeSeriesChart
          title="Events over time"
          description="COUNT(events) grouped by time bucket"
          data={timeSeriesData}
        />
      </div>

      {/* Events by Status Pie Chart */}
      <ChartPieDonutText
        data={pieData}
        totalEvents={metrics?.totalEvents ?? 0}
      />
    </div>
  );
}
