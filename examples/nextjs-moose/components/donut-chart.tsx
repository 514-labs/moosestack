"use client";

import * as React from "react";
import { Pie, PieChart, Cell, Sector } from "recharts";
import { cn } from "@/lib/utils";
import { DashboardChartWidget } from "@/components/dashboard-chart-widget";
import { chartTypeConfigs } from "@/components/chart-type-configs";
import type { ChartDisplayOptions } from "./chart-types";
import type { ReactNode } from "react";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export interface ChartDataItem {
  name: string;
  value: number;
}

interface PieChartVisualProps {
  chartData: ChartDataItem[];
  chartConfig: ChartConfig;
  activeIndex: number | null;
  onPieEnter: (_: unknown, index: number) => void;
  onPieLeave: () => void;
  renderActiveShape: (props: unknown) => React.ReactElement;
}

function PieChartVisual({
  chartData,
  chartConfig,
  activeIndex,
  onPieEnter,
  onPieLeave,
  renderActiveShape,
}: PieChartVisualProps) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-square [&>div]:aspect-square"
    >
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius="42%"
          outerRadius="70%"
          paddingAngle={2}
          dataKey="value"
          strokeWidth={0}
          activeIndex={activeIndex !== null ? activeIndex : undefined}
          activeShape={renderActiveShape}
          onMouseEnter={onPieEnter}
          onMouseLeave={onPieLeave}
        >
          {chartData.map((entry: ChartDataItem, index: number) => (
            <Cell
              key={`cell-${index}`}
              fill={`var(--chart-${(index % 5) + 1})`}
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

interface ChartCenterLabelProps {
  value: number | string;
  label?: string;
}

function ChartCenterLabel({ value, label }: ChartCenterLabelProps) {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none">
      <span className="text-lg @[400px]:text-xl font-semibold">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {label && (
        <span className="text-[10px] @[400px]:text-xs text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

interface ChartLabelsProps {
  chartData: ChartDataItem[];
  activeIndex: number | null;
  onItemHover: (index: number | null) => void;
  showLabels?: boolean;
}

function ChartLabels({
  chartData,
  activeIndex,
  onItemHover,
  showLabels = true,
}: ChartLabelsProps) {
  if (!showLabels) {
    return null;
  }
  return (
    <div className="flex-1 w-full grid grid-cols-1 gap-2 @[400px]:gap-4">
      {chartData.map((item: ChartDataItem, index: number) => (
        <div
          key={item.name}
          className={cn(
            "flex items-center gap-2 @[400px]:gap-2.5 cursor-pointer transition-opacity",
            activeIndex !== null && activeIndex !== index ? "opacity-50" : "",
          )}
          onMouseEnter={() => onItemHover(index)}
          onMouseLeave={() => onItemHover(null)}
        >
          <div
            className="w-1 h-4 @[400px]:h-5 rounded-sm shrink-0"
            style={{
              backgroundColor: `var(--chart-${(index % 5) + 1})`,
            }}
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
  );
}

export interface DonutChartProps {
  data: ChartDataItem[];
  chartConfig: ChartConfig;
  title: string;
  icon?: ReactNode;
  centerValue: number | string;
  centerLabel?: string;
  chartId?: string;
  gridSpan?: { sm?: number; md?: number; lg?: number; xl?: number };
  className?: string;
  triggerSize?: "sm" | "md" | "lg";
}

export function DonutChart({
  data: chartData,
  chartConfig,
  title,
  icon,
  centerValue,
  centerLabel,
  chartId = "donut-chart",
  gridSpan,
  className = "@container flex flex-col gap-4 w-full xl:w-[410px]",
  triggerSize = "sm",
}: DonutChartProps) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

  const handlePieEnter = React.useCallback((_: unknown, index: number) => {
    setActiveIndex(index);
  }, []);

  const handlePieLeave = React.useCallback(() => {
    setActiveIndex(null);
  }, []);

  const handleItemHover = React.useCallback((index: number | null) => {
    setActiveIndex(index);
  }, []);

  const renderActiveShape = React.useCallback((props: unknown) => {
    const typedProps = props as {
      cx: number;
      cy: number;
      innerRadius: number;
      outerRadius: number;
      startAngle: number;
      endAngle: number;
      fill: string;
    };
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } =
      typedProps;
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
    <DashboardChartWidget
      chartId={chartId}
      chartType="donut"
      title={title}
      icon={icon}
      gridSpan={gridSpan}
      chartConfig={chartTypeConfigs.donut}
      className={className}
      triggerSize={triggerSize}
    >
      {({ options }: { options: ChartDisplayOptions }) => (
        <div className="flex flex-col @[400px]:flex-row items-center gap-4 @[400px]:gap-6">
          <div className="relative shrink-0 size-[220px]">
            <PieChartVisual
              chartData={chartData}
              chartConfig={chartConfig}
              activeIndex={activeIndex}
              onPieEnter={handlePieEnter}
              onPieLeave={handlePieLeave}
              renderActiveShape={renderActiveShape}
            />
            <ChartCenterLabel value={centerValue} label={centerLabel} />
          </div>

          <ChartLabels
            chartData={chartData}
            activeIndex={activeIndex}
            onItemHover={handleItemHover}
            showLabels={options.showLabels ?? true}
          />
        </div>
      )}
    </DashboardChartWidget>
  );
}
