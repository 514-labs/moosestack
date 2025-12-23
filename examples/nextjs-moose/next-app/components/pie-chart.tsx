"use client";

import * as React from "react";
import { Pie, PieChart as RechartsPieChart, Cell } from "recharts";
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
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useDateFilter } from "@/components/dashboard-date-context";
import { getMetrics } from "@/app/actions/metrics";

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

interface PieData {
  status: string;
  count: number;
}

function PieChartContent({
  data,
}: {
  data: Array<{ status: string; count: number; fill: string }>;
}) {
  return (
    <RechartsPieChart>
      <ChartTooltip content={<ChartTooltipContent />} />
      <Pie
        data={data}
        dataKey="count"
        nameKey="status"
        cx="50%"
        cy="50%"
        outerRadius={80}
        label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
      >
        {data.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.fill} />
        ))}
      </Pie>
      <ChartLegend content={<ChartLegendContent nameKey="status" />} />
    </RechartsPieChart>
  );
}

export function PieChart() {
  const { startDate, endDate } = useDateFilter();
  const [data, setData] = React.useState<PieData[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!startDate || !endDate) {
      setLoading(false);
      return;
    }

    setLoading(true);
    getMetrics(startDate, endDate)
      .then((metrics) => {
        setData(metrics.eventsByStatus);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching pie chart data:", error);
        setLoading(false);
      });
  }, [startDate, endDate]);

  // Transform data for Recharts with fill colors
  const chartData = React.useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((item) => ({
      status: item.status,
      count: item.count,
      fill: `var(--color-${item.status})`,
    }));
  }, [data]);

  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events by Status</CardTitle>
        <CardDescription>Distribution of events by status</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ?
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            Loading...
          </div>
        : chartData.length === 0 || total === 0 ?
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            No data available
          </div>
        : <ChartContainer
            config={chartConfig}
            className="h-[300px] w-full [&>div]:aspect-auto"
          >
            <PieChartContent data={chartData} />
          </ChartContainer>
        }
      </CardContent>
    </Card>
  );
}
