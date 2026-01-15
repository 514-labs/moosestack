"use client";

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

const funnelData = [
  { stage: "Website Visitors", count: 12500, rate: "100%" },
  { stage: "Product Views", count: 8750, rate: "70%" },
  { stage: "Add to Cart", count: 3125, rate: "25%" },
  { stage: "Checkout Started", count: 1875, rate: "15%" },
  { stage: "Purchase Complete", count: 1250, rate: "10%" },
];

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function AcquisitionFunnel() {
  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Customer Acquisition Funnel</CardTitle>
        <CardDescription>
          Journey from first visit to purchase completion
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={funnelData}
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
                  const data = payload[0].payload;
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm">
                      <div className="font-medium">{data.stage}</div>
                      <div className="text-sm text-muted-foreground">
                        {data.count.toLocaleString()} users ({data.rate})
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {funnelData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
