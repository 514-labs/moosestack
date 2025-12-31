"use client";

import * as React from "react";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import type { TimeSeriesData } from "@/app/actions/events";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DashboardChartWidget } from "@/components/dashboard-chart-widget";
import { chartTypeConfigs } from "@/components/chart-type-configs";
import type { ChartDisplayOptions } from "./chart-types";

const chartConfig = {
  count: {
    label: "Events",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function TimeSeriesChart({
  title,
  description,
  data,
  chartId = "events-over-time",
  gridSpan,
}: {
  title: string;
  description: string;
  data: TimeSeriesData;
  chartId?: string;
  gridSpan?: { sm?: number; md?: number; lg?: number; xl?: number };
}) {
  return (
    <DashboardChartWidget
      chartId={chartId}
      chartType="timeSeries"
      title={title}
      description={description}
      icon={
        <TrendingUp className="size-4 sm:size-[18px] text-muted-foreground" />
      }
      gridSpan={gridSpan}
      chartConfig={chartTypeConfigs.timeSeries}
    >
      {({ options }: { options: ChartDisplayOptions }) => (
        <LineChartContent
          data={data}
          showGrid={options.showGrid ?? true}
          showTooltip={options.showTooltip ?? true}
        />
      )}
    </DashboardChartWidget>
  );
}

function LineChartContent({
  data,
  height = 300,
  showGrid = true,
  showTooltip = true,
}: {
  data: TimeSeriesData;
  height?: number;
  showGrid?: boolean;
  showTooltip?: boolean;
}) {
  return (
    <ChartContainer config={chartConfig}>
      <LineChart
        accessibilityLayer
        data={data}
        height={height}
        margin={{
          left: 12,
          right: 12,
          top: 12,
          bottom: 12,
        }}
      >
        {showGrid && <CartesianGrid vertical={false} />}
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => new Date(value).toLocaleDateString()}
        />
        {showTooltip && (
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
        )}
        <Line
          dataKey="count"
          type="natural"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
