"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const engagementData = [
  { day: "Mon", sessions: 1200, pageViews: 4800, avgDuration: 185 },
  { day: "Tue", sessions: 1350, pageViews: 5400, avgDuration: 192 },
  { day: "Wed", sessions: 1180, pageViews: 4720, avgDuration: 178 },
  { day: "Thu", sessions: 1420, pageViews: 5680, avgDuration: 201 },
  { day: "Fri", sessions: 1580, pageViews: 6320, avgDuration: 215 },
  { day: "Sat", sessions: 980, pageViews: 3920, avgDuration: 156 },
  { day: "Sun", sessions: 850, pageViews: 3400, avgDuration: 142 },
];

export function EngagementChart() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Engagement</CardTitle>
        <CardDescription>Sessions and page views by day</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart
            data={engagementData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="day" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm">
                      <div className="font-medium">{label}</div>
                      <div
                        className="text-sm"
                        style={{ color: "var(--chart-1)" }}
                      >
                        Sessions: {data.sessions.toLocaleString()}
                      </div>
                      <div
                        className="text-sm"
                        style={{ color: "var(--chart-2)" }}
                      >
                        Page Views: {data.pageViews.toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Avg Duration: {Math.floor(data.avgDuration / 60)}m{" "}
                        {data.avgDuration % 60}s
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="sessions"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="pageViews"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
