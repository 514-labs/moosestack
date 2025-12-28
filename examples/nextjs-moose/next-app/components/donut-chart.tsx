"use client";

import { Label, Pie, PieChart } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

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

export function ChartPieDonutText({
  data,
  totalEvents,
}: {
  data: PieData[];
  totalEvents: number;
}) {
  const chartData = ALL_STATUSES.map((status) => {
    const dataItem = data.find((item) => item.status === status);
    return {
      status,
      count: dataItem?.count ?? 0,
      fill: chartConfig[status].color,
    };
  });

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>Events by Status</CardTitle>
        <CardDescription>Distribution of event statuses</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="status"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (
                    !viewBox ||
                    !("cx" in viewBox) ||
                    !("cy" in viewBox) ||
                    typeof viewBox.cx !== "number" ||
                    typeof viewBox.cy !== "number"
                  ) {
                    return null;
                  }

                  const { cx, cy } = viewBox;

                  return (
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={cx}
                        y={cy}
                        className="fill-foreground text-3xl font-bold"
                      >
                        {totalEvents.toLocaleString()}
                      </tspan>
                      <tspan
                        x={cx}
                        y={cy + 24}
                        className="fill-muted-foreground text-sm"
                      >
                        Events
                      </tspan>
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 text-sm">
        {chartData.map((item) => (
          <div key={item.status} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: item.fill }}
            />
            <span>{item.status}</span>
            <span className="text-muted-foreground">{item.count}</span>
          </div>
        ))}
      </CardFooter>
    </Card>
  );
}
