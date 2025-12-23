"use client";

import * as React from "react";
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useDateFilter } from "@/components/dashboard-date-context";
import {
  getEventsOverTimeAction,
  type EventsOverTimeBucket,
} from "@/app/actions/events";

const chartConfig = {
  events: {
    label: "Events",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function LineChartContent({
  chartData,
}: {
  chartData: Array<{ time: string; events: number }>;
}) {
  return (
    <LineChart
      accessibilityLayer
      data={chartData}
      margin={{ top: 5, right: 10, left: 10, bottom: 40 }}
    >
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="time"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        angle={-45}
        textAnchor="end"
        height={60}
        interval="preserveStartEnd"
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        tickFormatter={(value: number) => value.toString()}
      />
      <ChartTooltip content={<ChartTooltipContent />} />
      <Line
        type="monotone"
        dataKey="events"
        stroke="var(--color-events)"
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
      />
    </LineChart>
  );
}

export function TimeSeriesChart() {
  const {
    startDate,
    endDate,
    chartData: contextData,
    setChartData,
  } = useDateFilter();
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!startDate || !endDate) {
      setIsLoading(false);
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.ceil(
      Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );

    const bucket: EventsOverTimeBucket =
      diffDays <= 2 ? "hour"
      : diffDays <= 60 ? "day"
      : "day";

    setIsLoading(true);
    getEventsOverTimeAction(startDate, endDate, bucket)
      .then((points) => {
        setChartData(points);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching events over time:", error);
        setChartData([]);
        setIsLoading(false);
      });
  }, [startDate, endDate, setChartData]);

  // Transform data for Recharts (time -> time, value -> events)
  const transformedData = React.useMemo(() => {
    if (!contextData || contextData.length === 0) return [];
    return contextData.map((d) => ({
      time: d.time,
      events: d.value,
    }));
  }, [contextData]);

  const description =
    isLoading ? "Loading event activity…"
    : startDate && endDate ?
      `Event activity from ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
    : "Event activity in the selected date range";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Over Time</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ?
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            Loading...
          </div>
        : transformedData.length === 0 ?
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No data available
          </div>
        : <ChartContainer
            config={chartConfig}
            className="h-[300px] w-full [&>div]:aspect-auto"
          >
            <LineChartContent chartData={transformedData} />
          </ChartContainer>
        }
      </CardContent>
    </Card>
  );
}
