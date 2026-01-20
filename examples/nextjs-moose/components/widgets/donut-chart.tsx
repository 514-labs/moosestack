"use client";

import * as React from "react";
import { Pie, PieChart, Cell, Sector } from "recharts";
import { cn } from "@/lib/utils";
import { ChartWidget } from "./chart-widget";
import type { PieDataPoint } from "./types";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export interface DonutChartProps {
  data: PieDataPoint[];
  chartConfig: ChartConfig;
  title: string;
  centerValue: number | string;
  centerLabel?: string;
  className?: string;
}

export function DonutChart({
  data,
  chartConfig,
  title,
  centerValue,
  centerLabel,
  className = "@container",
}: DonutChartProps) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

  const handlePieEnter = React.useCallback((_: unknown, index: number) => {
    setActiveIndex(index);
  }, []);

  const handlePieLeave = React.useCallback(() => {
    setActiveIndex(null);
  }, []);

  const renderActiveShape = React.useCallback((props: unknown) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } =
      props as {
        cx: number;
        cy: number;
        innerRadius: number;
        outerRadius: number;
        startAngle: number;
        endAngle: number;
        fill: string;
      };
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 8}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    );
  }, []);

  return (
    <ChartWidget title={title} className={className}>
      <div className="flex flex-col @[400px]:flex-row items-center gap-4 @[400px]:gap-6">
        {/* Pie Chart */}
        <div className="relative shrink-0 size-[220px]">
          <ChartContainer
            config={chartConfig}
            className="aspect-square [&>div]:aspect-square"
          >
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="42%"
                outerRadius="70%"
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
                activeIndex={activeIndex !== null ? activeIndex : undefined}
                activeShape={renderActiveShape}
                onMouseEnter={handlePieEnter}
                onMouseLeave={handlePieLeave}
              >
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={`var(--chart-${(index % 5) + 1})`}
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          {/* Center Label */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg @[400px]:text-xl font-semibold">
              {typeof centerValue === "number" ?
                centerValue.toLocaleString()
              : centerValue}
            </span>
            {centerLabel && (
              <span className="text-[10px] @[400px]:text-xs text-muted-foreground">
                {centerLabel}
              </span>
            )}
          </div>
        </div>

        {/* Labels */}
        <div className="flex-1 w-full grid grid-cols-1 gap-2 @[400px]:gap-4">
          {data.map((item, index) => (
            <div
              key={item.name}
              className={cn(
                "flex items-center gap-2 @[400px]:gap-2.5 cursor-pointer transition-opacity",
                activeIndex !== null && activeIndex !== index ?
                  "opacity-50"
                : "",
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <div
                className="w-1 h-4 @[400px]:h-5 rounded-sm shrink-0"
                style={{ backgroundColor: `var(--chart-${(index % 5) + 1})` }}
              />
              <span className="flex-1 text-xs @[400px]:text-sm text-muted-foreground truncate">
                {item.name}
              </span>
              <span className="text-xs @[400px]:text-sm font-semibold tabular-nums">
                {item.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartWidget>
  );
}
