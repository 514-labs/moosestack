"use client";

import * as React from "react";
import { Pie, PieChart, ResponsiveContainer, Cell, Sector } from "recharts";
import { type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { ChartLine } from "lucide-react";
import { DashboardChartWidget } from "@/components/dashboard-chart-widget";
import { chartTypeConfigs } from "@/components/chart-type-configs";
import type { ChartDisplayOptions } from "./chart-types";

interface PieData {
  status: string;
  count: number;
}

type Status = "completed" | "active" | "inactive";

const chartConfig = {
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

const ALL_STATUSES: Status[] = ["completed", "active", "inactive"];

interface ChartDataItem {
  name: string;
  value: number;
  color: string;
}

interface PieChartVisualProps {
  chartData: ChartDataItem[];
  activeIndex: number | null;
  onPieEnter: (_: unknown, index: number) => void;
  onPieLeave: () => void;
  renderActiveShape: (props: unknown) => React.ReactElement;
}

function PieChartVisual({
  chartData,
  activeIndex,
  onPieEnter,
  onPieLeave,
  renderActiveShape,
}: PieChartVisualProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
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
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

interface ChartCenterLabelProps {
  totalEvents: number;
}

function ChartCenterLabel({ totalEvents }: ChartCenterLabelProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <span className="text-lg @[400px]:text-xl font-semibold">
        {totalEvents.toLocaleString()}
      </span>
      <span className="text-[10px] @[400px]:text-xs text-muted-foreground">
        Total Events
      </span>
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
            style={{ backgroundColor: item.color }}
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

export function DonutChart({
  data: eventStatusData,
  totalEvents,
  chartId = "events-by-status",
  gridSpan,
}: {
  data: PieData[];
  totalEvents: number;
  chartId?: string;
  gridSpan?: { sm?: number; md?: number; lg?: number; xl?: number };
}) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

  // Transform event status data into chart format
  const chartData: ChartDataItem[] = React.useMemo(
    () =>
      ALL_STATUSES.map((status) => {
        const dataItem = eventStatusData.find((item) => item.status === status);
        const count = dataItem?.count ?? 0;
        return {
          name: chartConfig[status].label,
          value: count,
          color: chartConfig[status].color,
        };
      }),
    [eventStatusData],
  );

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
      title="Events by Status"
      icon={
        <ChartLine className="size-4 sm:size-[18px] text-muted-foreground" />
      }
      gridSpan={gridSpan}
      chartConfig={chartTypeConfigs.donut}
      chartData={eventStatusData}
      className="@container flex flex-col gap-4 w-full xl:w-[410px]"
      triggerSize="sm"
    >
      {({ options }: { options: ChartDisplayOptions }) => (
        <div className="flex flex-col @[400px]:flex-row items-center gap-4 @[400px]:gap-6">
          <div className="relative shrink-0 size-[220px]">
            <PieChartVisual
              chartData={chartData}
              activeIndex={activeIndex}
              onPieEnter={handlePieEnter}
              onPieLeave={handlePieLeave}
              renderActiveShape={renderActiveShape}
            />
            <ChartCenterLabel totalEvents={totalEvents} />
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
