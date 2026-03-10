"use client";

import * as React from "react";
import { Pie, PieChart, Cell, Sector } from "recharts";
import { ChartWidget } from "./chart-widget";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export interface DonutChartProps {
  data: { name: string; value: number }[];
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

  const activeItem = activeIndex !== null ? data[activeIndex] : null;

  return (
    <ChartWidget title={title} className={className}>
      <div className="relative shrink-0 mx-auto size-[220px]">
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
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none">
          {activeItem ?
            <>
              <span className="text-lg font-semibold">
                {activeItem.value.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {activeItem.name}
              </span>
            </>
          : <>
              <span className="text-lg font-semibold">
                {typeof centerValue === "number" ?
                  centerValue.toLocaleString()
                : centerValue}
              </span>
              {centerLabel && (
                <span className="text-[10px] text-muted-foreground">
                  {centerLabel}
                </span>
              )}
            </>
          }
        </div>
      </div>
    </ChartWidget>
  );
}
