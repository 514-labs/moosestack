"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ActivityIcon,
  TrendingUpIcon,
  CheckCircleIcon,
  DollarSignIcon,
} from "lucide-react";
import { useDateFilter } from "@/components/dashboard-date-context";
import { getMetrics } from "@/app/actions/metrics";

interface Metrics {
  totalEvents: number;
  activeEvents: number;
  completedEvents: number;
  revenue: number;
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function DashboardStats() {
  const { startDate, endDate } = useDateFilter();
  const [metrics, setMetrics] = React.useState<Metrics | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!startDate || !endDate) return;

    setLoading(true);
    getMetrics(startDate, endDate)
      .then((data) => {
        setMetrics({
          totalEvents: data.totalEvents,
          activeEvents: data.activeEvents,
          completedEvents: data.completedEvents,
          revenue: data.revenue,
        });
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching metrics:", error);
        setLoading(false);
      });
  }, [startDate, endDate]);

  if (loading || !metrics) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Events</CardTitle>
          <ActivityIcon className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatNumber(metrics.totalEvents)}
          </div>
          <p className="text-muted-foreground text-xs">
            Events in selected period
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Events</CardTitle>
          <TrendingUpIcon className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatNumber(metrics.activeEvents)}
          </div>
          <p className="text-muted-foreground text-xs">
            Count where status = &quot;active&quot;
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Status: completed
          </CardTitle>
          <CheckCircleIcon className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatNumber(metrics.completedEvents)}
          </div>
          <p className="text-muted-foreground text-xs">
            Count where status = &quot;completed&quot;
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total amount</CardTitle>
          <DollarSignIcon className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatNumber(metrics.revenue)}
          </div>
          <p className="text-muted-foreground text-xs">
            SUM(amount) in selected period
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
