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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartWidget } from "./chart-widget";
import type { TimeSeriesDataPoint } from "./types";

const defaultChartConfig = {
  value: {
    label: "Value",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

// =============================================================================
// Time Bucket Types & Options
// =============================================================================

export type TimeBucketOption = "auto" | "day" | "month";

const timeBucketOptions: { value: TimeBucketOption; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
];

// =============================================================================
// Props
// =============================================================================

export interface LineChartProps {
  data: TimeSeriesDataPoint[];
  title: string;
  description?: string;
  xKey?: string;
  yKey?: string;
  chartConfig?: ChartConfig;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
  height?: number;
  className?: string;
  formatXAxis?: (value: string) => string;
  showTimeBucket?: boolean;
  timeBucket?: TimeBucketOption;
  onTimeBucketChange?: (bucket: TimeBucketOption) => void;
}

// =============================================================================
// Component
// =============================================================================

export function LineChartComponent({
  data,
  title,
  description,
  xKey = "time",
  yKey = "count",
  chartConfig = defaultChartConfig,
  icon,
  headerRight,
  height = 350,
  className,
  formatXAxis = (value) => new Date(value).toLocaleDateString(),
  showTimeBucket = false,
  timeBucket,
  onTimeBucketChange,
}: LineChartProps) {
  const [internalBucket, setInternalBucket] =
    React.useState<TimeBucketOption>("auto");

  const currentBucket = timeBucket ?? internalBucket;
  const handleBucketChange = React.useCallback(
    (value: TimeBucketOption) => {
      if (onTimeBucketChange) {
        onTimeBucketChange(value);
      } else {
        setInternalBucket(value);
      }
    },
    [onTimeBucketChange],
  );

  const selectedLabel =
    timeBucketOptions.find((o) => o.value === currentBucket)?.label ?? "Auto";

  const headerContent = React.useMemo(() => {
    if (!showTimeBucket && !headerRight) return undefined;

    return (
      <>
        {showTimeBucket && (
          <Select
            value={currentBucket}
            onValueChange={(value) => {
              if (value) handleBucketChange(value as TimeBucketOption);
            }}
          >
            <SelectTrigger className="w-[100px] h-8 text-xs">
              <SelectValue>{selectedLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {timeBucketOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {headerRight}
      </>
    );
  }, [
    showTimeBucket,
    headerRight,
    currentBucket,
    selectedLabel,
    handleBucketChange,
  ]);

  return (
    <ChartWidget
      title={title}
      description={description}
      headerRight={headerContent}
      className={className}
    >
      <ChartContainer
        config={chartConfig}
        className="w-full"
        style={{ height }}
      >
        <LineChart
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
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Line
            dataKey={yKey}
            type="natural"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    </ChartWidget>
  );
}

export { LineChartComponent as LineChart };
