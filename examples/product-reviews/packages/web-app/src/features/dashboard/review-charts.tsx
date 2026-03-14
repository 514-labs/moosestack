"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ReviewDataPoint {
  month: string;
  totalReviews: number;
  avgRating: number;
}

const reviewCountConfig = {
  totalReviews: {
    label: "Reviews",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const avgRatingConfig = {
  avgRating: {
    label: "Avg Rating",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function ReviewCharts() {
  const [data, setData] = useState<ReviewDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(
      "/api/reviews?dimensions=month&metrics=totalReviews,avgRating&limit=100",
    )
      .then((res) => res.json())
      .then((json) => {
        const rows = json.rows ?? json.data ?? json;
        const sorted = (Array.isArray(rows) ? rows : [])
          .map((r: Record<string, unknown>) => ({
            month: String(r.month),
            totalReviews: Number(r.totalReviews),
            avgRating: Number(Number(r.avgRating).toFixed(2)),
          }))
          .sort((a: ReviewDataPoint, b: ReviewDataPoint) =>
            a.month.localeCompare(b.month),
          );
        setData(sorted);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reviews Over Time</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
            Loading...
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Average Rating Over Time</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
            Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
        Failed to load chart data: {error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Reviews Over Time</CardTitle>
          <CardDescription>
            Monthly review count across all categories
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={reviewCountConfig}
            className="h-[300px] w-full"
          >
            <AreaChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) =>
                  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K`
                  : String(v)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      Number(value).toLocaleString() + " reviews"
                    }
                  />
                }
              />
              <Area
                dataKey="totalReviews"
                type="monotone"
                fill="var(--color-totalReviews)"
                fillOpacity={0.2}
                stroke="var(--color-totalReviews)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Average Rating Over Time</CardTitle>
          <CardDescription>Monthly average star rating (1–5)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={avgRatingConfig} className="h-[300px] w-full">
            <AreaChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                domain={[1, 5]}
                ticks={[1, 2, 3, 4, 5]}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => Number(value).toFixed(2) + " stars"}
                  />
                }
              />
              <Area
                dataKey="avgRating"
                type="monotone"
                fill="var(--color-avgRating)"
                fillOpacity={0.2}
                stroke="var(--color-avgRating)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
