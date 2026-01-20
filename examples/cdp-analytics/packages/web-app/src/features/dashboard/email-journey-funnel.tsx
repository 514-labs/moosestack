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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { analyticsApi, fetchApi, type FunnelStage } from "@/lib/api";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function EmailJourneyFunnel() {
  const [data, setData] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<FunnelStage[]>(analyticsApi.funnel)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load funnel data"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Acquisition Funnel</CardTitle>
        <CardDescription>
          Email Acquired → First Visit → Engaged → Converted
        </CardDescription>
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
            No funnel data available
          </div>
        : <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" className="text-xs" />
              <YAxis
                type="category"
                dataKey="stage"
                className="text-xs"
                width={95}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-background p-2 shadow-sm">
                        <div className="font-medium">{d.stage}</div>
                        <div className="text-sm text-muted-foreground">
                          {d.count.toLocaleString()} ({d.rate})
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        }
      </CardContent>
    </Card>
  );
}
