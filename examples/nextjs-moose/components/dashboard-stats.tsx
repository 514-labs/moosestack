"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ActivityIcon,
  TrendingUpIcon,
  CheckCircleIcon,
  DollarSignIcon,
} from "lucide-react";
import { useDateFilter } from "@/lib/hooks";
import { useMetrics } from "@/lib/hooks";

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export function DashboardStats(): React.ReactElement {
  const { startDate, endDate } = useDateFilter();

  const { data: metrics, isLoading } = useMetrics(startDate, endDate);

  const stats =
    metrics ?
      [
        {
          title: "Total Events",
          value: formatNumber(metrics.totalEvents),
          isPositive: metrics.totalEvents > 0,
          description: "Events in selected period",
          icon: ActivityIcon,
          change: "+10%",
        },
        {
          title: "Active Events",
          value: formatNumber(metrics.activeEvents),
          isPositive: metrics.activeEvents > 0,
          description: 'Count where status = "active"',
          icon: TrendingUpIcon,
          change: "+10%",
        },
        {
          title: "Completed Events",
          value: formatNumber(metrics.completedEvents),
          isPositive: metrics.completedEvents > 0,
          change: "+10%",
          description: 'Count where status = "completed"',
          icon: CheckCircleIcon,
        },
        {
          title: "Total Revenue",
          value: formatNumber(metrics.revenue),
          isPositive: metrics.revenue > 0,
          change: "+10%",
          description: "Sum of all amounts",
          icon: DollarSignIcon,
        },
      ]
    : [];

  if (isLoading || !metrics) {
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 p-3 sm:p-4 lg:p-6 rounded-xl border bg-card">
      {stats.map((stat, index) => (
        <div key={stat.title} className="flex items-start">
          <div className="flex-1 space-y-2 sm:space-y-4 lg:space-y-6">
            <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground">
              <stat.icon className="size-3.5 sm:size-[18px]" />
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium truncate">
                {stat.title}
              </span>
            </div>
            <p className="text-lg sm:text-xl lg:text-[28px] font-semibold leading-tight tracking-tight">
              {stat.value}
            </p>
            <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-xs lg:text-sm font-medium">
              <span
                className={
                  stat.isPositive ? "text-emerald-600" : "text-red-600"
                }
              >
                <span className="hidden sm:inline">{stat.change}</span>
              </span>
              <span className="text-muted-foreground hidden sm:inline">
                vs Last Months
              </span>
            </div>
          </div>
          {index < stats.length - 1 && (
            <div className="hidden lg:block w-px h-full bg-border mx-4 xl:mx-6" />
          )}
        </div>
      ))}
    </div>
  );
}
