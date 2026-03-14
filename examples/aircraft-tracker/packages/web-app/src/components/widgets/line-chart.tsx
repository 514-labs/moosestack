"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ChartWidget } from "./chart-widget";

export interface LineDef {
  dataKey: string;
  label: string;
  color: string;
  yAxisId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface LineChartProps {
  data: any[];
  title: string;
  description?: string;
  xKey?: string;
  lines: LineDef[];
  dualAxis?: boolean;
  height?: number;
  className?: string;
  formatXAxis?: (value: string) => string;
}

export function LineChartComponent({
  data,
  title,
  description,
  xKey = "time",
  lines,
  dualAxis = false,
  height = 350,
  className,
  formatXAxis = (value) =>
    new Date(value).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
}: LineChartProps) {
  const chartConfig = Object.fromEntries(
    lines.map((l) => [l.dataKey, { label: l.label, color: l.color }]),
  ) satisfies ChartConfig;

  return (
    <ChartWidget title={title} description={description} className={className}>
      <ChartContainer
        config={chartConfig}
        className="w-full"
        style={{ height }}
      >
        <RechartsLineChart
          accessibilityLayer
          data={data}
          margin={{ left: 12, right: 12, top: 12, bottom: 12 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={formatXAxis}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={50}
            label={
              lines[0] ?
                {
                  value: lines[0].label,
                  angle: -90,
                  position: "insideLeft",
                  offset: -5,
                  style: { fontSize: 11, fill: "var(--muted-foreground)" },
                }
              : undefined
            }
          />
          {dualAxis && lines[1] && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={50}
              label={{
                value: lines[1].label,
                angle: 90,
                position: "insideRight",
                offset: -5,
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
          )}
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          {lines.map((line, i) => (
            <Line
              key={line.dataKey}
              dataKey={line.dataKey}
              name={line.label}
              yAxisId={
                dualAxis ?
                  i === 0 ?
                    "left"
                  : "right"
                : "left"
              }
              type="monotone"
              stroke={line.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </RechartsLineChart>
      </ChartContainer>
    </ChartWidget>
  );
}

export { LineChartComponent as LineChart };
