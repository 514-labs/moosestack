"use client";

import * as React from "react";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ChartWidget } from "./chart-widget";
import { chartConfigs } from "./chart-configs";
import type {
  ChartDisplayOptions,
  GridSpan,
  TimeSeriesDataPoint,
} from "./types";

const defaultChartConfig = {
  value: {
    label: "Value",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export interface LineChartProps {
  /** Chart data */
  data: TimeSeriesDataPoint[];
  /** Chart title */
  title: string;
  /** Chart description */
  description?: string;
  /** X-axis data key */
  xKey?: string;
  /** Y-axis data key */
  yKey?: string;
  /** Unique chart ID */
  chartId?: string;
  /** Grid span for layout */
  gridSpan?: GridSpan;
  /** Custom chart config for colors/labels */
  chartConfig?: ChartConfig;
  /** Custom icon */
  icon?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Format X-axis tick */
  formatXAxis?: (value: string) => string;
}

export function LineChartComponent({
  data,
  title,
  description,
  xKey = "time",
  yKey = "count",
  chartId = "line-chart",
  gridSpan,
  chartConfig = defaultChartConfig,
  icon,
  className,
  formatXAxis = (value) => new Date(value).toLocaleDateString(),
}: LineChartProps) {
  return (
    <ChartWidget
      chartId={chartId}
      chartType="timeSeries"
      title={title}
      description={description}
      icon={
        icon ?? (
          <TrendingUp className="size-4 sm:size-[18px] text-muted-foreground" />
        )
      }
      gridSpan={gridSpan}
      chartConfig={chartConfigs.timeSeries}
      className={className}
    >
      {({ options }: { options: ChartDisplayOptions }) => (
        <LineChartContent
          data={data}
          xKey={xKey}
          yKey={yKey}
          chartConfig={chartConfig}
          showGrid={options.showGrid ?? true}
          showTooltip={options.showTooltip ?? true}
          formatXAxis={formatXAxis}
        />
      )}
    </ChartWidget>
  );
}

interface LineChartContentProps {
  data: TimeSeriesDataPoint[];
  xKey: string;
  yKey: string;
  chartConfig: ChartConfig;
  height?: number;
  showGrid?: boolean;
  showTooltip?: boolean;
  formatXAxis?: (value: string) => string;
}

function LineChartContent({
  data,
  xKey,
  yKey,
  chartConfig,
  height = 300,
  showGrid = true,
  showTooltip = true,
  formatXAxis,
}: LineChartContentProps) {
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
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatXAxis}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
        {showTooltip && (
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
        )}
        <Line
          dataKey={yKey}
          type="natural"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

// Export with shorter name
export { LineChartComponent as LineChart };
