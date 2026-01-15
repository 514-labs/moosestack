"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { analyticsApi, fetchApi, type PerformanceData } from "@/lib/api";

export function CampaignPerformance() {
  const [data, setData] = useState<PerformanceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<PerformanceData[]>(analyticsApi.performance)
      .then(setData)
      .catch((err) =>
        setError(err.message || "Failed to load performance data"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign Performance Over Time</CardTitle>
        <CardDescription>Weekly email campaign metrics</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ?
          <div className="flex items-center justify-center h-[280px] text-muted-foreground">
            Loading...
          </div>
        : error ?
          <div className="flex items-center justify-center h-[280px] text-destructive">
            {error}
          </div>
        : data.length === 0 ?
          <div className="flex items-center justify-center h-[280px] text-muted-foreground">
            No performance data available
          </div>
        : <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={data}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--chart-2)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--chart-2)"
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="colorClicked" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--chart-3)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--chart-3)"
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="colorSignups" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--chart-5)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--chart-5)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-lg border bg-background p-2 shadow-sm">
                        <div className="font-medium">{label}</div>
                        {payload.map((entry, i) => (
                          <div
                            key={i}
                            className="text-sm"
                            style={{ color: entry.color }}
                          >
                            {entry.name}: {Number(entry.value).toLocaleString()}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="opened"
                name="Opened"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorOpened)"
              />
              <Area
                type="monotone"
                dataKey="clicked"
                name="Clicked"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorClicked)"
              />
              <Area
                type="monotone"
                dataKey="signups"
                name="Signups"
                stroke="var(--chart-5)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSignups)"
              />
            </AreaChart>
          </ResponsiveContainer>
        }
      </CardContent>
    </Card>
  );
}
